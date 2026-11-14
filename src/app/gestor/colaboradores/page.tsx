'use client';

export const dynamic = 'force-dynamic';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, Loader2, Paperclip, Printer, RefreshCw, Search, Users } from 'lucide-react';
import { buildEpiFichaHtml, buildFerramentasFichaHtml, formatCpf, loadCompanyInfo, openPrintable } from '@/lib/printDocs';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/lib/workspace';
import { EQUIPMENT_DOC_COLUMNS, type EquipmentDoc } from '@/lib/equipmentDocs';
import { EquipmentDocRow } from '@/components/EquipmentDocuments';

import { TagPlate } from '@/components/TagPlate';
type PossessionItem = { description: string; unit: string | null; tag?: string | null; category?: string | null };

type PossessionRow = {
  quantity: number;
  items: PossessionItem | PossessionItem[] | null;
};

type EmployeeRow = {
  id: string;
  full_name: string;
  cpf: string | null;
  role: string | null;
  department: string | null;
  status: string | null;
  possession: PossessionRow[] | null;
};

const STATUS_OPTIONS = ['Todos', 'Ativo', 'Afastado', 'Desligado'] as const;

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function itemOf(p: PossessionRow) {
  return Array.isArray(p.items) ? p.items[0] ?? null : p.items;
}

function num(v: number): string {
  return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

/**
 * Lista de colaboradores do workspace só para consulta.
 * É a mesma lista que a equipe usa em Cadastros › Colaboradores.
 */
export default function GestorColaboradoresPage() {
  const { currentWorkspace } = useWorkspace();
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>('Ativo');
  const [open, setOpen] = useState<string | null>(null);
  const [docs, setDocs] = useState<EquipmentDoc[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from('employees')
      .select('id, full_name, cpf, role, department, status, possession ( quantity, items ( description, unit, tag, category ) )')
      .order('full_name', { ascending: true });
    if (qErr) setError(qErr.message);
    else setRows((data ?? []) as EmployeeRow[]);
    // Documentos anexados (termos de entrega e devolução). Se a etapa 8 ainda não existir, só não mostra.
    const docRes = await supabase
      .from('equipment_documents')
      .select(EQUIPMENT_DOC_COLUMNS)
      .not('employee_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5000);
    setDocs(docRes.error ? [] : ((docRes.data ?? []) as unknown as EquipmentDoc[]));
    setLoading(false);
  }, []);

  useEffect(() => {
    // Carregamento inicial dos dados do servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const docsByEmployee = useMemo(() => {
    const map = new Map<string, EquipmentDoc[]>();
    for (const d of docs) {
      if (!d.employee_id) continue;
      const list = map.get(d.employee_id) ?? [];
      list.push(d);
      map.set(d.employee_id, list);
    }
    return map;
  }, [docs]);

  const filtered = useMemo(() => {
    const q = normalize(search.trim());
    return rows.filter((r) => {
      if (status !== 'Todos' && (r.status || 'Ativo') !== status) return false;
      if (!q) return true;
      const items = (r.possession ?? []).map((p) => `${itemOf(p)?.description ?? ''} ${itemOf(p)?.tag ?? ''}`).join(' ');
      return normalize(`${r.full_name} ${r.cpf ?? ''} ${r.role ?? ''} ${r.department ?? ''} ${items}`).includes(q);
    });
  }, [rows, search, status]);

  const totals = useMemo(() => {
    let active = 0;
    let withItems = 0;
    for (const r of rows) {
      if ((r.status || 'Ativo') === 'Ativo') active++;
      if ((r.possession ?? []).some((p) => Number(p.quantity) > 0)) withItems++;
    }
    return { all: rows.length, active, withItems };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 erp-titlebar px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-[22px] font-bold tracking-tight text-primary flex items-center gap-2">
            <Users className="text-secondary" size={22} />
            Colaboradores
          </h1>
          <p className="text-xs text-slate-500">
            {currentWorkspace?.name ?? 'Workspace'} · {loading ? '…' : `${totals.active} ativos de ${totals.all}`} ·{' '}
            {loading ? '…' : `${totals.withItems} com itens em posse`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded">
            <Eye size={14} />
            Somente leitura
          </span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-bold text-primary border border-slate-200 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 p-3 flex flex-col sm:flex-row gap-3">
        <label className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, CPF, função, setor, item ou TAG"
            className="w-full pl-9 pr-3 py-2 text-sm"
          />
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])}
          className="px-3 py-2 text-sm sm:w-44"
          aria-label="Situação"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 'Todos' ? 'Todas as situações' : s}
            </option>
          ))}
        </select>
      </div>

      {error ? <div className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 p-3">{error}</div> : null}

      <div className="bg-white border border-slate-200 overflow-x-auto">
        {loading ? (
          <div className="py-16 flex justify-center text-slate-400">
            <Loader2 className="animate-spin" size={28} />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">Nenhum colaborador encontrado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="w-8 px-2 py-2" aria-label="Abrir" />
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2 hidden lg:table-cell">CPF</th>
                <th className="px-3 py-2 hidden sm:table-cell">Função</th>
                <th className="px-3 py-2 hidden md:table-cell">Setor</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2 text-right">Itens em posse</th>
                <th className="px-3 py-2 text-right">Documentos</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const held = (r.possession ?? []).filter((p) => Number(p.quantity) > 0);
                const empDocs = docsByEmployee.get(r.id) ?? [];
                const isOpen = open === r.id;
                const st = r.status || 'Ativo';
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="border-b border-slate-100 cursor-pointer"
                      onClick={() => setOpen(isOpen ? null : r.id)}
                    >
                      <td className="px-2 py-2 text-slate-400">
                        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </td>
                      <td className="px-3 py-2 font-semibold text-primary">
                        {r.full_name}
                        <span className="block sm:hidden text-[11px] font-normal text-slate-500">{r.role || '—'}</span>
                      </td>
                      <td className="px-3 py-2 hidden lg:table-cell text-slate-600 whitespace-nowrap font-mono text-xs">{formatCpf(r.cpf) || '—'}</td>
                      <td className="px-3 py-2 hidden sm:table-cell text-slate-600">{r.role || '—'}</td>
                      <td className="px-3 py-2 hidden md:table-cell text-slate-600">{r.department || '—'}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded border text-[11px] font-bold ${
                            st === 'Ativo'
                              ? 'bg-green-50 text-green-700 border-green-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {st}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-primary">{held.length}</td>
                      <td className="px-3 py-2 text-right">
                        {empDocs.length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-secondary font-semibold">
                            <Paperclip size={13} />
                            {empDocs.length}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <td />
                        <td colSpan={7} className="px-3 py-2 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-slate-500 lg:hidden">CPF: {formatCpf(r.cpf) || '—'}</span>
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void openPrintable(`Ficha de EPI - ${r.full_name}`, () =>
                                  buildEpiFichaHtml(
                                    supabase,
                                    { id: r.id, full_name: r.full_name, cpf: r.cpf, role: r.role, department: r.department },
                                    loadCompanyInfo()
                                  )
                                );
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary border border-slate-200 bg-white rounded hover:bg-slate-100"
                            >
                              <Printer size={14} />
                              Ficha de EPI
                            </button>
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void openPrintable(`Ferramentas e equipamentos - ${r.full_name}`, () =>
                                  buildFerramentasFichaHtml(
                                    supabase,
                                    { id: r.id, full_name: r.full_name, cpf: r.cpf, role: r.role, department: r.department },
                                    loadCompanyInfo()
                                  )
                                );
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary border border-slate-200 bg-white rounded hover:bg-slate-100"
                            >
                              <Printer size={14} />
                              Ficha de ferramentas e equipamentos
                            </button>
                          </div>
                          {held.length > 0 ? (
                          <ul className="grid gap-1 sm:grid-cols-2 text-xs text-slate-600">
                            {held.map((p, i) => {
                              const it = itemOf(p);
                              return (
                                <li key={i} className="flex justify-between gap-3 border-b border-slate-200/70 py-1">
                                  <span className="truncate">
                                    {it?.description ?? 'Item removido'}
                                    {it?.tag ? <TagPlate size="xs" className="ml-1">{it.tag}</TagPlate> : null}
                                  </span>
                                  <span className="font-semibold text-primary whitespace-nowrap">
                                    {num(p.quantity)} {it?.unit ?? ''}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                          ) : null}
                          {empDocs.length > 0 ? (
                            <div>
                              <p className="text-[11px] font-bold uppercase text-slate-500 flex items-center gap-1">
                                <Paperclip size={12} />
                                Documentos anexados
                              </p>
                              <ul className="divide-y divide-slate-200">
                                {empDocs.map((d) => (
                                  <EquipmentDocRow key={d.id} doc={d} showItem canDelete={false} />
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
