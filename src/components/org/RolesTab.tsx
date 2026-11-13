'use client';

import { useState, type FormEvent } from 'react';
import { Check, Loader2, Minus, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PERMISSIONS, type OrgRoleRow, type Permission, type PersonRow } from '@/lib/permissions';
import { ErrorBox, FieldLabel, ModalActions, OrgModal } from '@/components/org/shared';

/** Cargos da organização e o que cada um libera. */
export default function RolesTab({
  orgId,
  roles,
  people,
  onChanged,
}: {
  orgId: string;
  roles: OrgRoleRow[];
  people: PersonRow[];
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<OrgRoleRow | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usage = (id: string) => people.filter((p) => !p.is_adm && p.cargo_id === id).length;

  const remove = async (r: OrgRoleRow) => {
    const n = usage(r.id);
    if (n > 0) {
      setError(`O cargo "${r.name}" está em uso por ${n} pessoa(s). Troque o cargo delas na aba Pessoas antes de apagar.`);
      return;
    }
    if (!window.confirm(`Apagar o cargo "${r.name}"?`)) return;
    const { error: delErr } = await supabase.from('organization_roles').delete().eq('id', r.id);
    setError(delErr ? delErr.message : null);
    await onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-xs text-slate-600 max-w-2xl">
          O cargo diz o que a pessoa pode fazer. O estoque é liberado pelas <strong>áreas</strong>; os itens fora das áreas da
          pessoa ficam só para consulta. O <strong>ADM</strong> pode tudo e não precisa de cargo.
        </p>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-bold text-white bg-secondary rounded hover:opacity-95 shrink-0"
        >
          <Plus size={16} />
          Novo cargo
        </button>
      </div>

      <ErrorBox message={error} />

      <div className="bg-white border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2">Cargo</th>
              {PERMISSIONS.map((p) => (
                <th key={p.key} className="px-2 py-2 text-center" title={p.hint}>
                  {p.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Pessoas</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="px-3 py-2">
                  <span className="font-semibold text-primary">{r.name}</span>
                  {r.description ? <span className="block text-[11px] text-slate-500 max-w-[260px]">{r.description}</span> : null}
                </td>
                {PERMISSIONS.map((p) => (
                  <td key={p.key} className="px-2 py-2 text-center">
                    {r.permissions.includes(p.key) ? (
                      <Check size={16} className="inline text-secondary" aria-label="Sim" />
                    ) : (
                      <Minus size={14} className="inline text-slate-300" aria-label="Não" />
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold text-primary">{usage(r.id)}</td>
                <td className="px-3 py-2">
                  <span className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-primary border border-slate-300 rounded hover:bg-slate-50"
                    >
                      <Pencil size={12} />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(r)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-red-600 border border-red-200 rounded hover:bg-red-50"
                      aria-label={`Apagar o cargo ${r.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        Quem tem &quot;Aprovar exclusões&quot; exclui na hora e decide os pedidos dos outros na página Aprovações. Os demais só
        pedem a exclusão.
      </p>

      {editing ? (
        <RoleModal
          orgId={orgId}
          role={editing === 'new' ? null : editing}
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

function RoleModal({
  orgId,
  role,
  onClose,
  onSaved,
}: {
  orgId: string;
  role: OrgRoleRow | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<Permission[]>(role?.permissions ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      setError('Dê um nome para o cargo.');
      return;
    }
    setSaving(true);
    setError(null);
    const row = {
      name: n,
      description: description.trim() || null,
      permissions: PERMISSIONS.map((p) => p.key).filter((k) => perms.includes(k)),
      updated_at: new Date().toISOString(),
    };
    const { error: saveErr } = role
      ? await supabase.from('organization_roles').update(row).eq('id', role.id)
      : await supabase.from('organization_roles').insert([{ ...row, organization_id: orgId }]);
    setSaving(false);
    if (saveErr) {
      setError(/duplicate|unique/i.test(saveErr.message) ? 'Já existe um cargo com esse nome.' : saveErr.message);
      return;
    }
    await onSaved();
  };

  return (
    <OrgModal title={role ? `Cargo: ${role.name}` : 'Novo cargo'} onClose={onClose}>
      <form onSubmit={submit} className="p-4 space-y-4">
        <ErrorBox message={error} />
        <div>
          <FieldLabel htmlFor="r-name">Nome do cargo</FieldLabel>
          <input
            id="r-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Encarregado"
            maxLength={60}
            className="w-full p-2.5 border border-slate-300 rounded"
            autoFocus
          />
        </div>
        <div>
          <FieldLabel htmlFor="r-desc">Descrição (opcional)</FieldLabel>
          <input
            id="r-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            className="w-full p-2.5 border border-slate-300 rounded"
          />
        </div>
        <fieldset>
          <legend className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">O que este cargo libera</legend>
          <div className="rounded border border-slate-200 divide-y divide-slate-100">
            {PERMISSIONS.map((p) => (
              <label key={p.key} className="flex items-start gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={perms.includes(p.key)}
                  onChange={(e) => setPerms((prev) => (e.target.checked ? [...prev, p.key] : prev.filter((k) => k !== p.key)))}
                />
                <span>
                  <span className="font-bold text-primary">{p.label}</span>
                  <span className="block text-[11px] text-slate-500">{p.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Sem nada marcado e sem áreas, a pessoa fica só consultando.</p>
        </fieldset>
        <ModalActions
          onCancel={onClose}
          saving={saving}
          submitLabel={role ? 'Salvar cargo' : 'Criar cargo'}
          icon={saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        />
      </form>
    </OrgModal>
  );
}
