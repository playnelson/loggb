'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { FuelSource, FuelVehicle } from '@/lib/fuel';

/** Dados comuns às abas do módulo. */
export type FuelData = {
  vehicles: FuelVehicle[];
  sources: FuelSource[];
  employees: { id: string; full_name: string; role: string | null }[];
  reload: () => Promise<void>;
};

export const inputCls =
  'mt-1 w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm focus:border-secondary';
export const thCls = 'px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider';
export const btnPrimary =
  'inline-flex items-center justify-center gap-2 bg-secondary text-white px-4 py-2 rounded-lg font-medium text-sm hover:opacity-95 disabled:opacity-50';
export const btnGhost =
  'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-primary border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase text-slate-400">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-slate-500 mt-1">{hint}</span> : null}
    </label>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[92vh] flex flex-col`}>
        <div className="p-4 border-b bg-slate-50 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold text-primary">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function ModalActions({ onCancel, saving, label = 'Salvar' }: { onCancel: () => void; saving: boolean; label?: string }) {
  return (
    <div className="flex gap-2 pt-3">
      <button type="button" onClick={onCancel} className="flex-1 py-2.5 border border-slate-200 rounded-xl font-bold text-slate-500">
        Cancelar
      </button>
      <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-primary text-white rounded-xl font-bold disabled:opacity-50">
        {saving ? 'Salvando…' : label}
      </button>
    </div>
  );
}

export function dbError(e: { message?: string; code?: string } | null): string {
  if (!e) return '';
  if (e.code === '23503') return 'Não dá para excluir: já existem lançamentos ligados a este cadastro. Desative em vez de excluir.';
  if (e.code === '23505') return 'Já existe um cadastro com este código.';
  if (e.code === '42501' || /row-level security/i.test(e.message || '')) return 'Sem permissão (módulo liberado só para ADM).';
  return e.message || 'Erro ao salvar.';
}
