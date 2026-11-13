'use client';

import { useMemo, useState } from 'react';
import { IdCard, Loader2, Search, UserPlus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatEmployeeName, normalizeEmployeeNameForSave, normalizeSearchText } from '@/lib/employeeName';
import type { OrgEmployee } from '@/lib/permissions';

/**
 * Escolhe a ficha de funcionário ligada a uma pessoa com acesso.
 * Busca por nome ou função em todos os workspaces da organização e, se a
 * pessoa ainda não está cadastrada, cadastra ali mesmo (no workspace atual).
 */
export default function EmployeePicker({
  employees,
  value,
  onChange,
  onCreated,
  personUserId = null,
  allowNone = false,
  currentWorkspaceName,
}: {
  employees: OrgEmployee[];
  value: string | null;
  onChange: (id: string | null, employee: OrgEmployee | null) => void;
  /** Funcionário cadastrado aqui: entra na lista de quem chamou. */
  onCreated: (employee: OrgEmployee) => void;
  /** Pessoa que está sendo editada (não avisa que a ficha "já é dela"). */
  personUserId?: string | null;
  allowNone?: boolean;
  currentWorkspaceName: string | null;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = value ? employees.find((e) => e.id === value) ?? null : null;
  const matches = useMemo(() => {
    const q = normalizeSearchText(query);
    const list = employees.filter((e) => e.status !== 'Desligado');
    if (!q) return list.slice(0, 8);
    return list
      .filter((e) => normalizeSearchText(`${e.full_name} ${e.role ?? ''}`).includes(q))
      .slice(0, 8);
  }, [employees, query]);

  const create = async () => {
    const name = normalizeEmployeeNameForSave(newName).trim();
    if (name.length < 3) {
      setError('Escreva o nome completo.');
      return;
    }
    if (!newRole.trim()) {
      setError('Escreva a função (ex.: Técnico de segurança).');
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: insErr } = await supabase
      .from('employees')
      .insert([{ full_name: name, role: newRole.trim(), status: 'Ativo' }])
      .select('id, full_name, role, status, workspace_id')
      .single();
    setSaving(false);
    if (insErr || !data) {
      setError(insErr?.message || 'Não foi possível cadastrar.');
      return;
    }
    const row = data as { id: string; full_name: string; role: string | null; status: string | null; workspace_id: string };
    const emp: OrgEmployee = { ...row, workspace_name: currentWorkspaceName, linked_user_id: null, linked_email: null };
    onCreated(emp);
    onChange(emp.id, emp);
    setCreating(false);
    setNewName('');
    setNewRole('');
  };

  if (selected) {
    const takenByOther = selected.linked_user_id && selected.linked_user_id !== personUserId;
    return (
      <div className="space-y-1.5">
        <div className="flex items-start gap-3 p-3 border border-secondary/40 bg-secondary/5 rounded">
          <IdCard size={20} className="text-secondary shrink-0 mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-primary">{formatEmployeeName(selected.full_name)}</span>
            <span className="block text-[11px] text-slate-500">
              {selected.role || 'Sem função'}
              {selected.workspace_name ? ` · ${selected.workspace_name}` : ''}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null, null)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-primary border border-slate-300 bg-white rounded hover:bg-slate-50 shrink-0"
          >
            <X size={12} />
            Trocar
          </button>
        </div>
        {takenByOther ? (
          <p className="text-[11px] font-semibold text-amber-800">
            Esta ficha já está ligada a {selected.linked_email}. Ao salvar, ela passa para esta pessoa.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar funcionário pelo nome ou função"
          className="w-full pl-8 p-2.5 border border-slate-300 rounded text-sm"
          aria-label="Buscar funcionário"
        />
      </div>
      <ul className="max-h-56 overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100">
        {matches.length === 0 ? (
          <li className="px-3 py-3 text-sm text-slate-400">Nenhum funcionário encontrado.</li>
        ) : (
          matches.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onChange(e.id, e)}
                className="w-full text-left px-3 py-2 hover:bg-slate-50"
              >
                <span className="block text-sm font-semibold text-primary">{formatEmployeeName(e.full_name)}</span>
                <span className="block text-[11px] text-slate-500">
                  {e.role || 'Sem função'}
                  {e.workspace_name ? ` · ${e.workspace_name}` : ''}
                  {e.linked_email && e.linked_user_id !== personUserId ? (
                    <span className="text-amber-700 font-semibold"> · já tem acesso ({e.linked_email})</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
      {allowNone ? (
        <p className="text-[11px] text-slate-400">Deixe sem escolher para não ligar a nenhuma ficha.</p>
      ) : null}

      {creating ? (
        <div className="p-3 border border-slate-200 bg-slate-50 rounded space-y-2">
          <p className="text-xs font-bold text-primary">
            Cadastrar funcionário{currentWorkspaceName ? ` em ${currentWorkspaceName}` : ''}
          </p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome completo"
            className="w-full p-2.5 border border-slate-300 rounded text-sm bg-white"
            aria-label="Nome completo do funcionário"
          />
          <input
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            placeholder="Função (ex.: Técnico de segurança)"
            className="w-full p-2.5 border border-slate-300 rounded text-sm bg-white"
            aria-label="Função do funcionário"
          />
          {error ? <p className="text-xs font-bold text-red-700">{error}</p> : null}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
              className="px-3 py-2 text-xs font-bold text-slate-600 rounded hover:bg-slate-200"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void create()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-secondary rounded hover:opacity-95 disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Cadastrar e usar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setNewName(query);
          }}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-secondary hover:underline"
        >
          <UserPlus size={14} />
          Não está na lista? Cadastrar funcionário
        </button>
      )}
    </div>
  );
}
