'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Check, Copy, Link2, Loader2, MessageCircle, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTimeBR, type Workspace } from '@/lib/workspace';
import type { OrgRoleRow, StockAreaRow } from '@/lib/permissions';
import {
  AreaPicker,
  CargoSelect,
  Chip,
  ErrorBox,
  FieldLabel,
  ModalActions,
  OrgModal,
  WorkspaceScopePicker,
  scopeText,
} from '@/components/org/shared';

export type InviteRow = {
  id: string;
  token: string;
  role: string;
  cargo_id: string | null;
  all_areas: boolean;
  area_ids: string[];
  label: string | null;
  workspace_scope: string[] | null;
  invite_expires_at: string;
  access_expires_at: string | null;
  max_uses: number;
  uses: number;
  revoked_at: string | null;
  created_at: string;
};

export const INVITE_COLUMNS =
  'id, token, role, cargo_id, all_areas, area_ids, label, workspace_scope, invite_expires_at, access_expires_at, max_uses, uses, revoked_at, created_at';

const DURATIONS: { value: string; label: string; days: number | null }[] = [
  { value: '1', label: '1 dia', days: 1 },
  { value: '7', label: '7 dias', days: 7 },
  { value: '30', label: '30 dias', days: 30 },
  { value: '90', label: '90 dias', days: 90 },
  { value: 'sem', label: 'Sem prazo (até eu remover)', days: null },
];

function inviteLink(token: string): string {
  return `${window.location.origin}/convite/${token}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt('Copie o link:', text);
    return false;
  }
}

function CopyLinkButton({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(inviteLink(token))) {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        }
      }}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary border border-slate-300 rounded hover:bg-slate-50"
    >
      {done ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
      {done ? 'Copiado' : 'Copiar link'}
    </button>
  );
}

/** Convites em aberto e criação de convite com cargo e áreas. */
export default function InvitesTab({
  orgId,
  orgName,
  invites,
  roles,
  areas,
  workspaces,
  currentWorkspaceId,
  loadedAt,
  onChanged,
}: {
  orgId: string;
  orgName: string;
  invites: InviteRow[];
  roles: OrgRoleRow[];
  areas: StockAreaRow[];
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  loadedAt: number;
  onChanged: () => Promise<void>;
}) {
  const names = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const active = useMemo(() => workspaces.filter((w) => !w.archived_at), [workspaces]);
  const [formOpen, setFormOpen] = useState(false);
  const [created, setCreated] = useState<InviteRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = invites.filter(
    (i) => !i.revoked_at && new Date(i.invite_expires_at).getTime() > loadedAt && i.uses < i.max_uses
  );

  const cargoName = (inv: InviteRow) => {
    if (inv.cargo_id) return roleById.get(inv.cargo_id)?.name ?? 'Cargo removido';
    return inv.role === 'gestor' ? 'Consulta' : 'Almoxarife';
  };

  const revokeInvite = async (inv: InviteRow) => {
    if (!window.confirm('Cancelar este convite? O link deixa de funcionar.')) return;
    const { error: upErr } = await supabase
      .from('organization_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', inv.id);
    setError(upErr ? upErr.message : null);
    await onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-xs text-slate-600 max-w-2xl">
          O convite é um link para <strong>1 pessoa</strong>. Ela entra (ou cria a conta) e já começa com o cargo, as áreas e os
          workspaces que você escolher. Depois dá para mudar tudo na aba Pessoas.
        </p>
        <button
          type="button"
          onClick={() => {
            setCreated(null);
            setFormOpen(true);
          }}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-bold text-white bg-secondary rounded hover:opacity-95 shrink-0"
        >
          <UserPlus size={16} />
          Convidar pessoa
        </button>
      </div>

      <ErrorBox message={error} />

      <div className="bg-white border border-slate-200">
        <p className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200 bg-[var(--table-head)]">
          Convites aguardando ({pending.length})
        </p>
        {pending.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">Nenhum convite em aberto.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending.map((inv) => (
              <li key={inv.id} className="px-3 py-2.5 space-y-1.5">
                <span className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="text-sm font-bold text-primary truncate">{inv.label || 'Convite sem nome'}</span>
                  <Chip tone="green">{cargoName(inv)}</Chip>
                  {inv.all_areas ? (
                    <Chip>Todas as áreas</Chip>
                  ) : (
                    inv.area_ids.map((id) => <Chip key={id}>{areaById.get(id)?.name ?? 'Área removida'}</Chip>)
                  )}
                </span>
                <span className="block text-[11px] text-slate-500">
                  {scopeText(inv.workspace_scope, names)} · acesso{' '}
                  {inv.access_expires_at ? `até ${formatDateTimeBR(inv.access_expires_at)}` : 'sem prazo'} · link vale até{' '}
                  {formatDateTimeBR(inv.invite_expires_at)}
                </span>
                <span className="flex flex-wrap gap-2">
                  <CopyLinkButton token={inv.token} />
                  <button
                    type="button"
                    onClick={() => void revokeInvite(inv)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-500 border border-slate-300 rounded hover:bg-slate-50"
                  >
                    <Trash2 size={14} />
                    Cancelar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {formOpen ? (
        <InviteModal
          orgId={orgId}
          orgName={orgName}
          active={active}
          roles={roles}
          areas={areas}
          defaultWorkspaceId={
            currentWorkspaceId && active.some((w) => w.id === currentWorkspaceId) ? currentWorkspaceId : active[0]?.id ?? null
          }
          created={created}
          cargoName={created ? cargoName(created) : ''}
          onCreated={(row) => {
            setCreated(row);
            void onChanged();
          }}
          onClose={() => {
            setFormOpen(false);
            setCreated(null);
          }}
        />
      ) : null}
    </div>
  );
}

function InviteModal({
  orgId,
  orgName,
  active,
  roles,
  areas,
  defaultWorkspaceId,
  created,
  cargoName,
  onCreated,
  onClose,
}: {
  orgId: string;
  orgName: string;
  active: Workspace[];
  roles: OrgRoleRow[];
  areas: StockAreaRow[];
  defaultWorkspaceId: string | null;
  created: InviteRow | null;
  cargoName: string;
  onCreated: (row: InviteRow) => void;
  onClose: () => void;
}) {
  const [cargo, setCargo] = useState('');
  const [allAreas, setAllAreas] = useState(false);
  const [areaIds, setAreaIds] = useState<string[]>([]);
  const [label, setLabel] = useState('');
  const [allWs, setAllWs] = useState(false);
  const [selected, setSelected] = useState<string[]>(defaultWorkspaceId ? [defaultWorkspaceId] : []);
  const [duration, setDuration] = useState('sem');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cargo) {
      setError('Escolha o cargo da pessoa.');
      return;
    }
    if (!allWs && selected.length === 0) {
      setError('Escolha pelo menos um workspace.');
      return;
    }
    setSaving(true);
    setError(null);
    const days = DURATIONS.find((d) => d.value === duration)?.days ?? null;
    const accessUntil = days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
    // O link vale 7 dias para ser aberto (ou menos, se o acesso for mais curto).
    const linkDays = days ? Math.min(days, 7) : 7;
    const { data, error: insErr } = await supabase
      .from('organization_invites')
      .insert([
        {
          organization_id: orgId,
          role: 'membro',
          cargo_id: cargo,
          all_areas: allAreas,
          area_ids: allAreas ? [] : areaIds,
          label: label.trim() || null,
          workspace_scope: allWs ? null : selected,
          access_expires_at: accessUntil,
          invite_expires_at: new Date(Date.now() + linkDays * 86_400_000).toISOString(),
          max_uses: 1,
        },
      ])
      .select(INVITE_COLUMNS)
      .single();
    setSaving(false);
    if (insErr || !data) {
      setError(insErr?.message || 'Não foi possível criar o convite.');
      return;
    }
    onCreated(data as InviteRow);
  };

  const link = created ? inviteLink(created.token) : '';
  const whatsappText = created ? `Convite para usar o LoggB com a equipe de ${orgName} (${cargoName}): ${link}` : '';

  return (
    <OrgModal title={created ? 'Convite criado' : 'Convidar pessoa'} onClose={onClose} wide>
      {created ? (
        <div className="p-4 space-y-4">
          <p className="text-sm text-slate-600">
            Envie este link para a pessoa. Ela entra (ou cria a conta) como <strong>{cargoName}</strong>. O link funciona para{' '}
            <strong>1 pessoa</strong> e vale até {formatDateTimeBR(created.invite_expires_at)}.
          </p>
          <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded">
            <Link2 size={16} className="text-slate-400 shrink-0" />
            <code className="text-xs text-primary break-all flex-1">{link}</code>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={async () => {
                if (await copyText(link)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2.5 rounded font-bold hover:opacity-90"
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Copiado' : 'Copiar link'}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded font-bold hover:opacity-90"
            >
              <MessageCircle size={18} />
              Enviar no WhatsApp
            </a>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="p-4 space-y-4">
          <ErrorBox message={error} />
          <div>
            <FieldLabel htmlFor="inv-label">Para quem é (opcional)</FieldLabel>
            <input
              id="inv-label"
              className="w-full p-2.5 border border-slate-300 rounded"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex.: Gabriel – técnico de segurança"
              maxLength={120}
              autoFocus
            />
          </div>
          <div>
            <FieldLabel htmlFor="inv-cargo">Cargo</FieldLabel>
            <CargoSelect id="inv-cargo" roles={roles} value={cargo} onChange={setCargo} />
          </div>
          <AreaPicker areas={areas} all={allAreas} onAllChange={setAllAreas} selected={areaIds} onSelectedChange={setAreaIds} />
          <WorkspaceScopePicker active={active} all={allWs} onAllChange={setAllWs} selected={selected} onSelectedChange={setSelected} />
          <div>
            <FieldLabel htmlFor="inv-duration">Acesso válido por</FieldLabel>
            <select
              id="inv-duration"
              className="w-full p-2.5 bg-white border border-slate-300 rounded font-medium"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            >
              {DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <ModalActions
            onCancel={onClose}
            saving={saving}
            submitLabel="Gerar link"
            icon={saving ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
          />
        </form>
      )}
    </OrgModal>
  );
}
