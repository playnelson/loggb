'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Loader2, Pencil, Save, ShieldCheck, UserMinus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTimeBR, type Workspace } from '@/lib/workspace';
import type { OrgRoleRow, PersonRow, StockAreaRow } from '@/lib/permissions';
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

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Pessoas da organização: cargo, áreas, workspaces e prazo de cada uma. */
export default function PeopleTab({
  orgId,
  myUserId,
  people,
  roles,
  areas,
  workspaces,
  loadedAt,
  onChanged,
}: {
  orgId: string;
  myUserId: string | null;
  /** Momento da última leitura: base para mostrar acessos vencidos. */
  loadedAt: number;
  people: PersonRow[];
  roles: OrgRoleRow[];
  areas: StockAreaRow[];
  workspaces: Workspace[];
  onChanged: () => Promise<void>;
}) {
  const names = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const now = loadedAt;

  const remove = async (p: PersonRow) => {
    if (!window.confirm(`Remover ${p.email} da organização? A pessoa deixa de ver os dados na hora.`)) return;
    setBusy(p.user_id);
    const { error: delErr } = await supabase
      .from('organization_members')
      .delete()
      .eq('organization_id', orgId)
      .eq('user_id', p.user_id);
    setBusy(null);
    setError(delErr ? delErr.message : null);
    await onChanged();
  };

  return (
    <div className="space-y-3">
      <ErrorBox message={error} />
      <div className="bg-white border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2">Pessoa</th>
              <th className="px-3 py-2">Cargo</th>
              <th className="px-3 py-2">Áreas do estoque</th>
              <th className="px-3 py-2 hidden md:table-cell">Workspaces</th>
              <th className="px-3 py-2 hidden lg:table-cell">Prazo</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const cargo = p.cargo_id ? roleById.get(p.cargo_id) : null;
              const expired = !!p.expires_at && new Date(p.expires_at).getTime() <= now;
              const isMe = p.user_id === myUserId;
              return (
                <tr key={p.user_id} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <span className="font-semibold text-primary break-all">{p.email}</span>
                    {isMe ? <span className="ml-1 text-[11px] text-slate-400">(você)</span> : null}
                    {p.is_creator ? <span className="block text-[11px] text-slate-500">Criou a organização</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    {p.is_adm ? (
                      <Chip tone="dark">ADM</Chip>
                    ) : cargo ? (
                      <Chip tone={cargo.permissions.length ? 'green' : 'amber'}>{cargo.name}</Chip>
                    ) : (
                      <Chip tone="amber">Sem cargo</Chip>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {p.is_adm || p.all_areas ? (
                      <span className="text-xs font-bold text-secondary">Todas as áreas</span>
                    ) : p.area_ids.length ? (
                      <span className="flex flex-wrap gap-1">
                        {p.area_ids.map((id) => (
                          <Chip key={id}>{areaById.get(id)?.name ?? 'Área removida'}</Chip>
                        ))}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Nenhuma (só consulta o estoque)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell text-xs text-slate-600">
                    {p.is_adm ? 'Todos os workspaces' : scopeText(p.workspace_scope, names)}
                  </td>
                  <td className="px-3 py-2 hidden lg:table-cell text-xs">
                    {p.expires_at ? (
                      <span className={expired ? 'font-bold text-red-600' : 'text-slate-600'}>
                        {expired ? 'Venceu em ' : 'Até '}
                        {formatDateTimeBR(p.expires_at)}
                      </span>
                    ) : (
                      <span className="text-slate-400">Sem prazo</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex justify-end gap-1.5">
                      {!p.is_creator ? (
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-primary border border-slate-300 rounded hover:bg-slate-50"
                        >
                          <Pencil size={13} />
                          Editar
                        </button>
                      ) : null}
                      {!p.is_creator && !isMe ? (
                        <button
                          type="button"
                          disabled={busy === p.user_id}
                          onClick={() => void remove(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-60"
                        >
                          {busy === p.user_id ? <Loader2 size={13} className="animate-spin" /> : <UserMinus size={13} />}
                          Remover
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        Para colocar alguém novo, use a aba <strong>Convites</strong>: a pessoa recebe um link e já entra com o cargo e as áreas
        escolhidos. Quem criou a organização é sempre ADM.
      </p>

      {editing ? (
        <PersonModal
          orgId={orgId}
          person={editing}
          isMe={editing.user_id === myUserId}
          roles={roles}
          areas={areas}
          workspaces={workspaces}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function PersonModal({
  orgId,
  person,
  isMe,
  roles,
  areas,
  workspaces,
  onClose,
  onSaved,
}: {
  orgId: string;
  person: PersonRow;
  isMe: boolean;
  roles: OrgRoleRow[];
  areas: StockAreaRow[];
  workspaces: Workspace[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const active = useMemo(() => workspaces.filter((w) => !w.archived_at), [workspaces]);
  const [isAdm, setIsAdm] = useState(person.is_adm);
  const [cargo, setCargo] = useState(person.cargo_id ?? '');
  const [allAreas, setAllAreas] = useState(person.all_areas);
  const [areaIds, setAreaIds] = useState<string[]>(person.area_ids);
  const [allWs, setAllWs] = useState(person.workspace_scope === null);
  const [wsIds, setWsIds] = useState<string[]>(person.workspace_scope ?? []);
  const [until, setUntil] = useState(toDateInput(person.expires_at));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isAdm && !cargo) {
      setError('Escolha um cargo.');
      return;
    }
    if (!isAdm && !allWs && wsIds.length === 0) {
      setError('Escolha pelo menos um workspace.');
      return;
    }
    if (isMe && !isAdm) {
      setError('Você não pode tirar o seu próprio acesso de ADM. Peça a outro ADM.');
      return;
    }
    setSaving(true);
    setError(null);
    // Prazo: até o fim do dia escolhido.
    const expires = until ? new Date(`${until}T23:59:59`).toISOString() : null;
    const { error: rpcErr } = await supabase.rpc('set_member_access', {
      p_org: orgId,
      p_user: person.user_id,
      p_is_adm: isAdm,
      p_cargo: isAdm ? null : cargo,
      p_all_areas: isAdm ? false : allAreas,
      p_area_ids: isAdm || allAreas ? [] : areaIds,
      p_scope: isAdm || allWs ? null : wsIds,
      p_expires_at: expires,
    });
    setSaving(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    await onSaved();
  };

  return (
    <OrgModal title={`Acesso de ${person.email}`} onClose={onClose} wide>
      <form onSubmit={submit} className="p-4 space-y-4">
        <ErrorBox message={error} />

        <fieldset>
          <legend className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Tipo de acesso</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label
              className={`flex items-start gap-2 p-3 border rounded cursor-pointer ${
                !isAdm ? 'border-secondary bg-secondary/5' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input type="radio" name="tipo" className="mt-1" checked={!isAdm} onChange={() => setIsAdm(false)} />
              <span>
                <span className="block text-sm font-bold text-primary">Cargo</span>
                <span className="block text-[11px] text-slate-500">Faz o que o cargo libera, nas áreas marcadas.</span>
              </span>
            </label>
            <label
              className={`flex items-start gap-2 p-3 border rounded cursor-pointer ${
                isAdm ? 'border-secondary bg-secondary/5' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input type="radio" name="tipo" className="mt-1" checked={isAdm} onChange={() => setIsAdm(true)} />
              <span>
                <span className="flex items-center gap-1 text-sm font-bold text-primary">
                  <ShieldCheck size={14} className="text-secondary" />
                  ADM
                </span>
                <span className="block text-[11px] text-slate-500">
                  Pode tudo: pessoas, cargos, áreas, workspaces e todas as áreas do estoque.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {!isAdm ? (
          <>
            <div>
              <FieldLabel htmlFor="p-cargo">Cargo</FieldLabel>
              <CargoSelect id="p-cargo" roles={roles} value={cargo} onChange={setCargo} />
            </div>
            <AreaPicker areas={areas} all={allAreas} onAllChange={setAllAreas} selected={areaIds} onSelectedChange={setAreaIds} />
            <WorkspaceScopePicker active={active} all={allWs} onAllChange={setAllWs} selected={wsIds} onSelectedChange={setWsIds} />
          </>
        ) : null}

        <div>
          <FieldLabel htmlFor="p-until">Acesso até (opcional)</FieldLabel>
          <input
            id="p-until"
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="w-full sm:w-56 p-2.5 border border-slate-300 rounded"
          />
          <p className="text-[11px] text-slate-400 mt-1">Deixe em branco para não ter prazo.</p>
        </div>

        <ModalActions
          onCancel={onClose}
          saving={saving}
          submitLabel="Salvar acesso"
          icon={saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        />
      </form>
    </OrgModal>
  );
}
