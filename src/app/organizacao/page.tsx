'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Boxes, Building2, Loader2, Mail, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/lib/workspace';
import type { OrgCategory, OrgRoleRow, PersonRow, StockAreaRow } from '@/lib/permissions';
import PeopleTab from '@/components/org/PeopleTab';
import AreasTab from '@/components/org/AreasTab';
import RolesTab from '@/components/org/RolesTab';
import InvitesTab, { INVITE_COLUMNS, type InviteRow } from '@/components/org/InvitesTab';

type Tab = 'pessoas' | 'areas' | 'cargos' | 'convites';

const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: 'pessoas', label: 'Pessoas', icon: Users },
  { key: 'areas', label: 'Áreas do estoque', icon: Boxes },
  { key: 'cargos', label: 'Cargos', icon: ShieldCheck },
  { key: 'convites', label: 'Convites', icon: Mail },
];

function isMissingSchema(message: string | undefined): boolean {
  return /could not find|does not exist|schema cache/i.test(String(message || ''));
}

/** Gestão da organização (só ADM): pessoas, áreas do estoque, cargos e convites. */
export default function OrganizacaoPage() {
  const { status, currentOrganization, currentWorkspace, workspaces, isAdm } = useWorkspace();
  const org = currentOrganization;
  const orgWorkspaces = useMemo(
    () => (org ? workspaces.filter((w) => w.organization_id === org.id) : []),
    [org, workspaces]
  );

  const [tab, setTab] = useState<Tab>('pessoas');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [roles, setRoles] = useState<OrgRoleRow[]>([]);
  const [areas, setAreas] = useState<StockAreaRow[]>([]);
  const [areaMembers, setAreaMembers] = useState<Map<string, string[]>>(new Map());
  const [categories, setCategories] = useState<OrgCategory[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    const [userRes, peopleRes, rolesRes, areasRes, membersRes, catRes, invRes] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc('organization_people', { p_org: org.id }),
      supabase
        .from('organization_roles')
        .select('id, organization_id, name, description, permissions, system_key, sort')
        .eq('organization_id', org.id)
        .order('sort', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('stock_areas')
        .select('id, organization_id, name, categories')
        .eq('organization_id', org.id)
        .order('name', { ascending: true }),
      supabase.from('stock_area_members').select('area_id, user_id').eq('organization_id', org.id),
      supabase.rpc('organization_categories', { p_org: org.id }),
      supabase
        .from('organization_invites')
        .select(INVITE_COLUMNS)
        .eq('organization_id', org.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    setMyUserId(userRes.data.user?.id ?? null);
    const firstErr = peopleRes.error || rolesRes.error || areasRes.error || membersRes.error || catRes.error || invRes.error;
    if (firstErr) {
      setMissing(isMissingSchema(firstErr.message));
      setError(firstErr.message);
    } else {
      setMissing(false);
      setError(null);
      setPeople((peopleRes.data ?? []) as PersonRow[]);
      setRoles((rolesRes.data ?? []) as OrgRoleRow[]);
      setAreas((areasRes.data ?? []) as StockAreaRow[]);
      const map = new Map<string, string[]>();
      for (const m of (membersRes.data ?? []) as { area_id: string; user_id: string }[]) {
        map.set(m.area_id, [...(map.get(m.area_id) ?? []), m.user_id]);
      }
      setAreaMembers(map);
      setCategories((catRes.data ?? []) as OrgCategory[]);
      setInvites((invRes.data ?? []) as InviteRow[]);
    }
    setLoadedAt(Date.now());
    setLoading(false);
  }, [org]);

  useEffect(() => {
    if (status !== 'ready' || !isAdm) return;
    // Carregamento inicial dos dados do servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [status, isAdm, load]);

  if (status === 'loading') {
    return (
      <div className="py-16 flex justify-center text-slate-400">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (!org || !isAdm) {
    return (
      <div className="bg-white border border-slate-200 p-6 max-w-xl">
        <h1 className="text-lg font-bold text-primary">Organização</h1>
        <p className="text-sm text-slate-600 mt-1">
          Só o ADM da organização acessa esta página. Se você precisa de outro cargo ou de outra área, fale com o ADM.
        </p>
      </div>
    );
  }

  const counts: Record<Tab, number> = {
    pessoas: people.length,
    areas: areas.length,
    cargos: roles.length,
    convites: invites.filter((i) => !i.revoked_at && new Date(i.invite_expires_at).getTime() > loadedAt && i.uses < i.max_uses).length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 erp-titlebar px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-[22px] font-bold tracking-tight text-primary flex items-center gap-2">
            <Building2 className="text-secondary" size={22} />
            Organização
          </h1>
          <p className="text-xs text-slate-500">
            {org.name} · quem participa, o que cada um pode fazer e qual parte do estoque cada um gerencia
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/workspaces"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-bold text-primary border border-slate-300 bg-white rounded hover:bg-slate-50"
          >
            Workspaces
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-bold text-primary border border-slate-300 bg-white rounded hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Seções da organização" className="flex gap-0 overflow-x-auto border-b border-slate-300">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-[3px] -mb-px ${
                on ? 'border-secondary text-primary bg-white' : 'border-transparent text-slate-500 hover:text-primary'
              }`}
            >
              <Icon size={15} className={on ? 'text-secondary' : ''} />
              {t.label}
              {!loading ? <span className="text-[11px] font-semibold text-slate-400">({counts[t.key]})</span> : null}
            </button>
          );
        })}
      </div>

      {missing ? (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded p-4">
          O banco ainda não tem cargos e áreas. Aplique a <strong>etapa 9</strong> (supabase/etapa9_cargos_areas.sql) no Supabase.
        </div>
      ) : error ? (
        <div className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>
      ) : null}

      {loading ? (
        <div className="py-16 flex justify-center text-slate-400">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : missing ? null : tab === 'pessoas' ? (
        <PeopleTab
          orgId={org.id}
          myUserId={myUserId}
          people={people}
          roles={roles}
          areas={areas}
          workspaces={orgWorkspaces}
          loadedAt={loadedAt}
          onChanged={load}
        />
      ) : tab === 'areas' ? (
        <AreasTab
          orgId={org.id}
          areas={areas}
          areaMembers={areaMembers}
          people={people}
          categories={categories}
          onChanged={load}
        />
      ) : tab === 'cargos' ? (
        <RolesTab orgId={org.id} roles={roles} people={people} onChanged={load} />
      ) : (
        <InvitesTab
          orgId={org.id}
          orgName={org.name}
          invites={invites}
          roles={roles}
          areas={areas}
          workspaces={orgWorkspaces}
          currentWorkspaceId={currentWorkspace?.id ?? null}
          loadedAt={loadedAt}
          onChanged={load}
        />
      )}
    </div>
  );
}
