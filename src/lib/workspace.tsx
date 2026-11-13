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
import { accessIsReadOnly, accessManagesCategory, type MyAccess, type Permission } from '@/lib/permissions';

export type WorkspaceKind = 'canteiro' | 'cidade' | 'sede' | 'outro';
export type OrgRole = 'dono' | 'admin' | 'gestor' | 'membro';

export const WORKSPACE_KINDS: { value: WorkspaceKind; label: string }[] = [
  { value: 'canteiro', label: 'Canteiro de obra' },
  { value: 'cidade', label: 'Cidade / região' },
  { value: 'sede', label: 'Sede / escritório' },
  { value: 'outro', label: 'Outro' },
];

export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  dono: 'ADM',
  admin: 'ADM',
  gestor: 'Gestor',
  membro: 'Membro',
};

/** Telas que o gestor (somente leitura) pode abrir. */
export const READ_ONLY_PATHS = ['/gestor', '/history', '/workspaces', '/convite'] as const;

export function isReadOnlyPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return READ_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function formatDateTimeBR(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function workspaceKindLabel(kind: string): string {
  return WORKSPACE_KINDS.find((k) => k.value === kind)?.label ?? 'Outro';
}

export type Organization = {
  id: string;
  name: string;
  logo_data: string | null;
  role: OrgRole;
  /** Fim do acesso da pessoa logada (gestor com convite temporário). */
  access_expires_at: string | null;
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
  /** Só consulta: não grava nada (o banco também bloqueia). */
  readOnly: boolean;
  /** Cargo e áreas da pessoa logada no workspace atual (null se o banco ainda não tem a etapa 9). */
  access: MyAccess | null;
  /** ADM da organização do workspace atual. */
  isAdm: boolean;
  /** Pode usar o módulo (colaboradores, compras...)? */
  can: (perm: Permission) => boolean;
  /** Gerencia a área deste item (pela categoria)? */
  canManageCategory: (category: string | null | undefined) => boolean;
  /** Gerencia alguma parte do estoque (pode cadastrar e movimentar itens)? */
  managesAnyArea: boolean;
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
  const [access, setAccess] = useState<MyAccess | null>(null);

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
        .select('organization_id, role, expires_at, organizations(id, name, logo_data)')
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
          expires_at: string | null;
          organizations: { id: string; name: string; logo_data: string | null } | null;
        };
        if (!r.organizations) return null;
        // Acesso vencido: a organização some (o banco também já não libera nada).
        if (r.expires_at && new Date(r.expires_at).getTime() <= Date.now()) return null;
        return {
          id: r.organizations.id,
          name: r.organizations.name,
          logo_data: r.organizations.logo_data,
          role: asRole(r.role),
          access_expires_at: r.expires_at ?? null,
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

    // Cargo e áreas no workspace atual. Sem a etapa 9 no banco, segue como antes.
    let acc: MyAccess | null = null;
    if (current) {
      const accRes = await supabase.rpc('my_access');
      if (!accRes.error && accRes.data && typeof accRes.data === 'object') {
        const d = accRes.data as Partial<MyAccess>;
        acc = {
          organization_id: String(d.organization_id ?? ''),
          is_adm: !!d.is_adm,
          cargo_id: d.cargo_id ?? null,
          cargo_name: d.cargo_name ?? null,
          permissions: Array.isArray(d.permissions) ? d.permissions : [],
          all_areas: !!d.all_areas,
          areas: Array.isArray(d.areas) ? d.areas : [],
        };
      }
    }
    setAccess(acc);

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
      readOnly: access ? accessIsReadOnly(access) : currentOrganization?.role === 'gestor',
      access,
      isAdm: access ? access.is_adm : currentOrganization?.role === 'dono' || currentOrganization?.role === 'admin',
      can: (perm: Permission) => {
        if (!access) return currentOrganization?.role !== 'gestor';
        return access.is_adm || access.permissions.includes(perm);
      },
      canManageCategory: (category: string | null | undefined) =>
        access ? accessManagesCategory(access, category) : currentOrganization?.role !== 'gestor',
      managesAnyArea: access
        ? access.is_adm || access.all_areas || access.areas.length > 0
        : currentOrganization?.role !== 'gestor',
    };
  }, [status, organizations, workspaces, currentId, reload, switchWorkspace, access]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace precisa estar dentro de WorkspaceProvider.');
  return ctx;
}
