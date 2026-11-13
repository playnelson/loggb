'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Workspace } from '@/lib/workspace';
import { PERMISSION_LABEL, type OrgRoleRow, type StockAreaRow } from '@/lib/permissions';

/** Janela padrão das telas da organização. */
export function OrgModal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-primary/40 z-[80] flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white rounded-lg border border-slate-300 shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} my-4 overflow-hidden`}
      >
        <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between">
          <h2 className="text-base font-bold text-primary">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-slate-200 rounded" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
      {children}
    </label>
  );
}

export function Chip({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'dark' }) {
  const cls = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    green: 'bg-secondary/10 text-secondary border-secondary/30',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    dark: 'bg-primary text-white border-primary',
  }[tone];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-bold whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

export function ModalActions({
  onCancel,
  saving,
  submitLabel,
  icon,
}: {
  onCancel: () => void;
  saving: boolean;
  submitLabel: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-slate-100">
      <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded font-bold text-slate-600 hover:bg-slate-100">
        Cancelar
      </button>
      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center justify-center gap-2 bg-secondary text-white px-5 py-2.5 rounded font-bold hover:opacity-95 disabled:opacity-60"
      >
        {icon}
        {submitLabel}
      </button>
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded p-3">{message}</div>;
}

/** Escolha de workspaces: todos ou alguns. */
export function WorkspaceScopePicker({
  active,
  all,
  onAllChange,
  selected,
  onSelectedChange,
}: {
  active: Workspace[];
  all: boolean;
  onAllChange: (v: boolean) => void;
  selected: string[];
  onSelectedChange: (v: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Workspaces liberados</legend>
      <label className="flex items-center gap-2 text-sm font-bold text-primary">
        <input type="checkbox" checked={all} onChange={(e) => onAllChange(e.target.checked)} />
        Todos os workspaces da organização
      </label>
      {!all ? (
        <div className="mt-2 max-h-40 overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100">
          {active.map((w) => (
            <label key={w.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                checked={selected.includes(w.id)}
                onChange={(e) =>
                  onSelectedChange(e.target.checked ? [...selected, w.id] : selected.filter((id) => id !== w.id))
                }
              />
              <span className="font-medium text-primary">{w.name}</span>
              {w.city ? <span className="text-xs text-slate-400">· {w.city}</span> : null}
            </label>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

/** Escolha das áreas do estoque que a pessoa gerencia. */
export function AreaPicker({
  areas,
  all,
  onAllChange,
  selected,
  onSelectedChange,
}: {
  areas: StockAreaRow[];
  all: boolean;
  onAllChange: (v: boolean) => void;
  selected: string[];
  onSelectedChange: (v: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
        Áreas do estoque que gerencia
      </legend>
      <p className="text-[11px] text-slate-500 mb-2">
        A pessoa só vê e mexe nos itens das áreas marcadas (entrada, entrega, devolução, cadastro e edição); o resto do estoque fica escondido para ela. Sem nenhuma área marcada, ela vê o estoque todo, só para consulta.
      </p>
      <label className="flex items-center gap-2 text-sm font-bold text-primary">
        <input type="checkbox" checked={all} onChange={(e) => onAllChange(e.target.checked)} />
        Todas as áreas (almoxarife geral)
      </label>
      {!all ? (
        areas.length === 0 ? (
          <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
            Ainda não há áreas. Crie as áreas na aba <strong>Áreas do estoque</strong> (ex.: EPIs, Ferramentas).
          </p>
        ) : (
          <div className="mt-2 max-h-48 overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100">
            {areas.map((a) => (
              <label key={a.id} className="flex items-start gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.includes(a.id)}
                  onChange={(e) =>
                    onSelectedChange(e.target.checked ? [...selected, a.id] : selected.filter((id) => id !== a.id))
                  }
                />
                <span className="min-w-0">
                  <span className="font-bold text-primary">{a.name}</span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    Categorias: {a.categories.length ? a.categories.join(', ') : 'nenhuma'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )
      ) : null}
    </fieldset>
  );
}

/** Seleção de cargo com a descrição e o que ele libera. */
export function CargoSelect({
  roles,
  value,
  onChange,
  id,
}: {
  roles: OrgRoleRow[];
  value: string;
  onChange: (v: string) => void;
  id?: string;
}) {
  const current = roles.find((r) => r.id === value) ?? null;
  return (
    <div>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-2.5 bg-white border border-slate-300 rounded font-medium"
      >
        <option value="">Escolha o cargo…</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      {current ? (
        <p className="mt-1 text-[11px] text-slate-500">
          {current.description ? `${current.description} ` : ''}
          <span className="font-bold text-slate-600">
            Libera: {current.permissions.length ? current.permissions.map((p) => PERMISSION_LABEL[p]).join(', ') : 'só consulta'}.
          </span>
        </p>
      ) : null}
    </div>
  );
}

export function scopeText(scope: string[] | null, names: Map<string, string>): string {
  if (!scope) return 'Todos os workspaces';
  const list = scope.map((id) => names.get(id)).filter(Boolean);
  return list.length ? list.join(', ') : 'Workspace removido';
}
