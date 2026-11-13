'use client';

/**
 * Organização e workspace atuais.
 *
 * O banco (supabase/etapa5_organizacoes_workspaces.sql) já devolve só os dados do
 * workspace em que a pessoa está, e grava as inserções nele. Aqui o app só precisa
 * saber qual é o workspace atual (para mostrar no menu) e trocar de workspace.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

export type WorkspaceKind = 'canteiro' | 'cidade' | 'sede' | 'outro';
export type OrgRole = 'dono' | 'admin' | 'gestor' | 'membro';

export const WORKSPACE_KINDS: { value: WorkspaceKind; label: string }[] = [
  { value: 'canteiro', label: 'Canteiro de obra' },
  { value: 'cidade', label: 'Cidade / região' },
  { value: 'sede', label: 'Sede / escritório' },
  { value: 'outro', label: 'Outro' },
];

export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  dono: 'Dono',
  admin: 'Administrador',
  gestor: 'Gestor',
  membro: 'Membro',
};

export function workspaceKindLabel(kind: string): string {
  return WORKSPACE_KINDS.find((k) => k.value === kind)?.label ?? 'Outro';
}

export type Organization = {
  id: string;
  name: string;
  logo_data: string | null;
  role: OrgRole;
};

export type Workspace = {
  id: string;
  organization_id: string;
  name: string;
  kind: WorkspaceKind;
  city: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
};

/**
 * loading      ainda carregando
 * ready        há um workspace atual
 * onboarding   a pessoa ainda não participa de nenhuma organização
 * no_workspace participa, mas não há workspace ativo escolhido (ex.: todos arquivados)
 * unavailable  sem login ou banco ainda sem as tabelas de workspace (o app segue como antes)
 */
export type WorkspaceStatus = 'loading' | 'ready' | 'onboarding' | 'no_workspace' | 'unavailable';

type WorkspaceContextValue = {
  status: WorkspaceStatus;
  organizations: Organization[];
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  currentOrganization: Organization | null;
  reload: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  isOrgAdmin: (organizationId: string) => boolean;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  return error.code === '42P01' || error.code === 'PGRST205' || msg.includes('could not find the table');
}

function asRole(v: unknown): OrgRole {
  return v === 'dono' || v === 'admin' || v === 'gestor' ? v : 'membro';
}

function asKind(v: unknown): WorkspaceKind {
  return v === 'cidade' || v === 'sede' || v === 'outro' ? v : 'canteiro';
}

/** Depois de trocar de workspace, volta para a tela principal do módulo (sem ids de registros do workspace antigo). */
export function pathAfterSwitch(pathname: string): string {
  const first = pathname.split('/').filter(Boolean)[0];
  return first ? `/${first}` : '/';
}

export function WorkspaceProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [status, setStatus] = useState<WorkspaceStatus>('loading');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!supabase) {
      setStatus('unavailable');
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setStatus('unavailable');
      return;
    }

    const [memRes, wsRes, stateRes] = await Promise.all([
      supabase
        .from('organization_members')
        .select('organization_id, role, organizations(id, name, logo_data)')
        .eq('user_id', user.id),
      supabase
        .from('workspaces')
        .select('id, organization_id, name, kind, city, notes, archived_at, created_at')
        .order('name', { ascending: true }),
      supabase.from('user_workspace_state').select('workspace_id').eq('user_id', user.id).maybeSingle(),
    ]);

    if (memRes.error || wsRes.error || stateRes.error) {
      const err = memRes.error || wsRes.error || stateRes.error;
      if (!isMissingSchema(err)) console.error('Falha ao carregar workspaces:', err);
      setStatus('unavailable');
      return;
    }

    const memRows = (memRes.data ?? []) as unknown[];
    const wsRows = (wsRes.data ?? []) as Record<string, unknown>[];

    const orgs: Organization[] = memRows
      .map((row: unknown) => {
        const r = row as unknown as {
          role: unknown;
          organizations: { id: string; name: string; logo_data: string | null } | null;
        };
        if (!r.organizations) return null;
        return {
          id: r.organizations.id,
          name: r.organizations.name,
          logo_data: r.organizations.logo_data,
          role: asRole(r.role),
        };
      })
      .filter((o: Organization | null): o is Organization => o !== null)
      .sort((a: Organization, b: Organization) => a.name.localeCompare(b.name, 'pt-BR'));

    const wss: Workspace[] = wsRows.map((r) => ({
      id: String(r.id),
      organization_id: String(r.organization_id),
      name: String(r.name ?? ''),
      kind: asKind(r.kind),
      city: r.city ? String(r.city) : null,
      notes: r.notes ? String(r.notes) : null,
      archived_at: r.archived_at ? String(r.archived_at) : null,
      created_at: String(r.created_at ?? ''),
    }));

    setOrganizations(orgs);
    setWorkspaces(wss);

    if (orgs.length === 0) {
      setCurrentId(null);
      setStatus('onboarding');
      return;
    }

    const active = wss.filter((w) => !w.archived_at);
    const saved = stateRes.data?.workspace_id ? String(stateRes.data.workspace_id) : null;
    let current = active.find((w) => w.id === saved) ?? null;

    // Sem workspace escolhido (ou o escolhido foi arquivado): entra no primeiro ativo.
    if (!current && active.length > 0) {
      const { error } = await supabase.rpc('set_current_workspace', { p_workspace_id: active[0].id });
      if (!error) current = active[0];
      else console.error('Falha ao escolher o workspace:', error);
    }

    setCurrentId(current?.id ?? null);
    setStatus(current ? 'ready' : 'no_workspace');
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Carregamento inicial dos dados do servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [enabled, reload]);

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    const { error } = await supabase.rpc('set_current_workspace', { p_workspace_id: workspaceId });
    if (error) throw new Error(error.message);
    // Recarrega a página inteira: todas as telas buscam de novo, já no workspace novo.
    window.location.assign(pathAfterSwitch(window.location.pathname));
  }, []);

  const value = useMemo<WorkspaceContextValue>(() => {
    const currentWorkspace = workspaces.find((w) => w.id === currentId) ?? null;
    const currentOrganization = currentWorkspace
      ? organizations.find((o) => o.id === currentWorkspace.organization_id) ?? null
      : null;
    return {
      status,
      organizations,
      workspaces,
      currentWorkspace,
      currentOrganization,
      reload,
      switchWorkspace,
      isOrgAdmin: (organizationId: string) => {
        const role = organizations.find((o) => o.id === organizationId)?.role;
        return role === 'dono' || role === 'admin';
      },
    };
  }, [status, organizations, workspaces, currentId, reload, switchWorkspace]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace precisa estar dentro de WorkspaceProvider.');
  return ctx;
}
