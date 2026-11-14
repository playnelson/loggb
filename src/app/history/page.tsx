'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatProductLabelDisplay } from '@/lib/productDisplayText';
import { formatEmployeeName, normalizeSearchText } from '@/lib/employeeName';
import { useWorkspace } from '@/lib/workspace';
import {
  formatQty,
  movementReasonOf,
  MOVEMENT_REASONS,
  MOVEMENT_REASON_LABEL,
  receiptNumber,
  type MovementReason,
} from '@/lib/movements';
import { EQUIPMENT_DOC_COLUMNS, openEquipmentDoc, type EquipmentDoc } from '@/lib/equipmentDocs';
import { TagPlate } from '@/components/TagPlate';
import {
  Users,
  Paperclip,
  History,
  Search,
  Filter,
  Download,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  Loader2,
  Package,
} from 'lucide-react';

interface Movement {
  id: string;
  created_at: string;
  quantity: number;
  type: string;
  reason?: string | null;
  tag?: string | null;
  note?: string | null;
  document?: string | null;
  batch_id?: string | null;
  ca_number?: string | null;
  employee_id?: string | null;
  work_site_id?: string | null;
  performed_by?: string | null;
  items: {
    description: string;
    unit: string;
    category?: string | null;
    tag?: string | null;
  } | null;
  employees?: {
    full_name: string;
  } | null;
  work_sites?: {
    name: string;
    kind: string;
  } | null;
}

const PAGE = 1000;
const RENDER_STEP = 200;

const REASON_TONE: Record<MovementReason, string> = {
  entrada: 'bg-green-100 text-green-700',
  saida: 'bg-red-100 text-red-700',
  devolucao: 'bg-teal-100 text-teal-700',
  ajuste: 'bg-slate-200 text-slate-700',
  descarte: 'bg-orange-100 text-orange-700',
  saldo_inicial: 'bg-blue-100 text-blue-700',
  importacao: 'bg-purple-100 text-purple-700',
  inventario: 'bg-indigo-100 text-indigo-700',
};

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return isoDay(d);
}

const isEpiCategory = (c: string | null | undefined) => String(c ?? '').trim().toUpperCase().startsWith('EPI');

/** Colaborador da movimentação (vazio quando não teve colaborador). */
function movementEmployeeLabel(m: Movement): string {
  const emp = m.employees?.full_name;
  return emp ? formatEmployeeName(emp) : '';
}

/** TAG da movimentação ou, se ela não tiver (ex.: entrada/importação), a TAG do item único. */
function movementTag(m: Movement): string {
  const own = (m.tag || '').trim();
  if (own && own.toUpperCase() !== 'DESCARTE') return own;
  return (m.items?.tag || '').trim();
}

export default function HistoryPage() {
  const { readOnly } = useWorkspace();
  const [movements, setMovements] = useState<Movement[]>([]);
  /** Cautelas / termos assinados anexados a cada movimentação. */
  const [docsByMovement, setDocsByMovement] = useState<Map<string, EquipmentDoc[]>>(new Map());
  /** Nome de quem registrou cada movimentação (performed_by → nome). */
  const [actorNames, setActorNames] = useState<Map<string, string>>(new Map());
  const actorOf = (m: Movement) => (m.performed_by ? actorNames.get(m.performed_by) ?? '' : '');
  const openDoc = async (doc: EquipmentDoc) => {
    const err = await openEquipmentDoc(supabase, doc);
    if (err) alert(err);
  };

  /** CA do EPI informado depois da entrega. */
  const editCa = async (m: Movement) => {
    const v = window.prompt('Nº do CA desta entrega (deixe vazio para tirar):', m.ca_number ?? '');
    if (v === null) return;
    const ca = v.trim().slice(0, 40) || null;
    const { data, error } = await supabase.from('movements').update({ ca_number: ca }).eq('id', m.id).select('id');
    if (error || !data?.length) {
      alert(`Não foi possível salvar o CA${error ? `: ${error.message}` : ' (sem permissão).'}`);
      return;
    }
    setMovements((prev) => prev.map((x) => (x.id === m.id ? { ...x, ca_number: ca } : x)));
  };
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [reasonFilter, setReasonFilter] = useState<'ALL' | MovementReason>('ALL');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(defaultFromDate);
  const [dateTo, setDateTo] = useState('');
  const [renderLimit, setRenderLimit] = useState(RENDER_STEP);
  const searchLower = useMemo(() => normalizeSearchText(searchTerm), [searchTerm]);

  /** Lê TODAS as páginas do período (a API devolve no máximo 1000 linhas por vez). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (cancelled) return;
    if (!user) {
      setMovements([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);

    const all: Movement[] = [];
    for (let from = 0; from < 200_000; from += PAGE) {
      let q = supabase
        .from('movements')
        .select(
          'id, created_at, quantity, type, reason, tag, note, document, batch_id, ca_number, employee_id, work_site_id, performed_by, items(description, unit, category, tag), employees(full_name), work_sites(name, kind)'
        )
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (reasonFilter !== 'ALL') q = q.eq('reason', reasonFilter);
      if (dateFrom) q = q.gte('created_at', new Date(`${dateFrom}T00:00:00`).toISOString());
      if (dateTo) q = q.lte('created_at', new Date(`${dateTo}T23:59:59.999`).toISOString());

      const { data, error } = await q.range(from, from + PAGE - 1);
      if (cancelled) return; // filtro mudou no meio: resposta antiga
      if (error) {
        console.error('Error fetching history:', error);
        setLoadError(error.message);
        break;
      }
      const chunk = ((data as unknown) as Movement[]) || [];
      all.push(...chunk);
      if (chunk.length < PAGE) break;
    }

    setMovements(all);
    setRenderLimit(RENDER_STEP);
    setLoading(false);

    // Documentos anexados (cautela assinada etc.) das movimentações com colaborador ou local.
    const ids = all.filter((m) => m.employee_id || m.work_site_id).map((m) => m.id);
    const docs = new Map<string, EquipmentDoc[]>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data: docRows, error: docErr } = await supabase
        .from('equipment_documents')
        .select(EQUIPMENT_DOC_COLUMNS)
        .in('movement_id', ids.slice(i, i + 100));
      if (cancelled) return;
      if (docErr) break; // documentos não ativados: só não mostra
      for (const d of (docRows ?? []) as unknown as EquipmentDoc[]) {
        if (!d.movement_id) continue;
        docs.set(d.movement_id, [...(docs.get(d.movement_id) ?? []), d]);
      }
    }
    setDocsByMovement(docs);

    const actorIds = [...new Set(all.map((m) => m.performed_by).filter((v): v is string => !!v))];
    if (actorIds.length) {
      const { data: actorRows } = await supabase.rpc('movement_actor_names', { p_ids: actorIds });
      if (cancelled) return;
      setActorNames(
        new Map(((actorRows ?? []) as { user_id: string; name: string }[]).map((r) => [r.user_id, formatEmployeeName(r.name)]))
      );
    }
    })();
    return () => {
      cancelled = true;
    };
  }, [reasonFilter, dateFrom, dateTo]);

  const employeeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of movements) if (m.employee_id && m.employees?.full_name) map.set(m.employee_id, formatEmployeeName(m.employees.full_name));
    return [...map].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [movements]);

  const filteredMovements = useMemo(() => {
    const base = employeeFilter ? movements.filter((m) => m.employee_id === employeeFilter) : movements;
    if (!searchLower) return base;
    return base.filter((m) => {
      const item = normalizeSearchText(m.items?.description || '');
      const emp = normalizeSearchText(m.employees?.full_name || '');
      const site = normalizeSearchText(`${m.work_sites?.name || ''} ${actorOf(m)}`);
      const tag = normalizeSearchText(movementTag(m));
      const extra = normalizeSearchText(
        `${m.document || ''} ${m.note || ''} ${m.batch_id ? receiptNumber(m.batch_id) : ''}`
      );
      return (
        item.includes(searchLower) ||
        emp.includes(searchLower) ||
        site.includes(searchLower) ||
        tag.includes(searchLower) ||
        extra.includes(searchLower)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movements, searchLower, employeeFilter, actorNames]);

  const visibleMovements = filteredMovements.slice(0, renderLimit);

  const csvCell = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    const escaped = s.replace(/"/g, '""');
    return /[",;\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const downloadCSV = () => {
    const headers = [
      'Data',
      'Motivo',
      'Direção',
      'Material',
      'Colaborador',
      'Quantidade',
      'Unidade',
      'TAG',
      'Nº CA',
      'Documento',
      'Observação',
      'Recibo',
      'Registrado por',
    ];
    const rows = filteredMovements.map((m) => [
      new Date(m.created_at).toLocaleString('pt-BR'),
      MOVEMENT_REASON_LABEL[movementReasonOf(m)],
      m.type === 'IN' ? 'Entrada no almoxarifado' : 'Saída do almoxarifado',
      m.items?.description,
      movementEmployeeLabel(m),
      formatQty(m.quantity),
      m.items?.unit,
      movementTag(m),
      m.ca_number || '',
      m.document || '',
      m.note || '',
      m.employee_id || m.work_site_id ? receiptNumber(m.batch_id || m.id) : '',
      actorOf(m),
    ]);

    // ";" e BOM: abre certo no Excel em português (vírgula é separador decimal).
    const csvContent = '﻿' + [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `historico_movimentacoes_${isoDay(new Date())}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 erp-titlebar px-4 py-3 sm:px-5">
        <div>
          <h1 className="text-xl sm:text-[22px] font-bold tracking-tight text-primary flex items-center gap-2">
            <History className="text-secondary" />
            Histórico Completo
          </h1>
          <p className="text-slate-500 text-sm">Todas as movimentações do período, com o motivo de cada uma.</p>
        </div>
        <button
          onClick={downloadCSV}
          disabled={loading || filteredMovements.length === 0}
          className="flex items-center justify-center gap-2 bg-white border border-border px-4 py-2 rounded-lg text-primary font-bold text-sm hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
        >
          <Download size={16} />
          Exportar CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl border border-border shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Buscar por material, colaborador, local, TAG, documento ou nº do recibo..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/50 outline-none transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1">
              <Filter size={14} className="text-slate-400" />
              <select
                className="bg-transparent border-none text-sm font-bold text-slate-600 focus:ring-0 outline-none"
                value={reasonFilter}
                onChange={(e) => setReasonFilter(e.target.value as 'ALL' | MovementReason)}
              >
                <option value="ALL">Todos os motivos</option>
                {MOVEMENT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {MOVEMENT_REASON_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1">
              <Users size={14} className="text-slate-400" />
              <select
                className="bg-transparent border-none text-sm font-bold text-slate-600 focus:ring-0 outline-none max-w-[220px]"
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
              >
                <option value="">Todos os colaboradores</option>
                {employeeOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1">
              <Calendar size={14} className="text-slate-400" />
              <span className="text-[11px] font-bold text-slate-400">De</span>
              <input
                type="date"
                className="bg-transparent border-none text-sm font-bold text-slate-600 focus:ring-0 outline-none"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <span className="text-[11px] font-bold text-slate-400">até</span>
              <input
                type="date"
                className="bg-transparent border-none text-sm font-bold text-slate-600 focus:ring-0 outline-none"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            {dateFrom || dateTo ? (
              <button
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="text-xs font-bold text-secondary hover:underline px-1"
              >
                Todo o período
              </button>
            ) : null}
          </div>
        </div>
        {!loading ? (
          <p className="text-[11px] font-bold text-slate-400">
            {filteredMovements.length} movimentação(ões)
            {dateFrom || dateTo
              ? ` · ${dateFrom ? new Date(`${dateFrom}T12:00:00`).toLocaleDateString('pt-BR') : 'início'} a ${
                  dateTo ? new Date(`${dateTo}T12:00:00`).toLocaleDateString('pt-BR') : 'hoje'
                }`
              : ' · todo o período'}
          </p>
        ) : null}
        {loadError ? (
          <p className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            Erro ao carregar o histórico: {loadError}
          </p>
        ) : null}
      </div>

      {/* History Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Data / Hora</th>
                <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Motivo</th>
                <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Material</th>
                <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Colaborador</th>
                <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Qtd.</th>
                <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Cautela</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    <Loader2 className="animate-spin inline mr-2 text-secondary" size={20} />
                    Carregando histórico...
                  </td>
                </tr>
              ) : filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-300 italic font-medium">
                    Nenhuma movimentação encontrada com estes filtros.
                  </td>
                </tr>
              ) : (
                visibleMovements.map((move) => {
                  const reason = movementReasonOf(move);
                  return (
                    <tr key={move.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="text-xs font-bold text-primary font-mono bg-slate-50 inline-block px-2 py-1 rounded">
                          {new Date(move.created_at).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                        {actorOf(move) ? (
                          <div className="mt-1 text-[10px] font-medium text-slate-400" title="Quem registrou a movimentação">
                            por {actorOf(move)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter ${REASON_TONE[reason]}`}
                        >
                          {move.type === 'IN' ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
                          {MOVEMENT_REASON_LABEL[reason]}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-white transition-colors">
                            <Package size={14} className="text-slate-400" />
                          </div>
                          <div className="flex flex-col">
                            <p className="text-sm font-bold text-primary leading-tight">
                              {formatProductLabelDisplay(move.items?.description)}
                            </p>
                            {movementTag(move) ? (
                              <TagPlate size="xs">{movementTag(move)}</TagPlate>
                            ) : null}
                            {readOnly ? (
                              move.ca_number ? <span className="text-[10px] font-mono text-slate-400">CA {move.ca_number}</span> : null
                            ) : move.ca_number || (move.employee_id && isEpiCategory(move.items?.category)) ? (
                              <button
                                type="button"
                                onClick={() => void editCa(move)}
                                title="Corrigir o CA desta entrega"
                                className="self-start text-[10px] font-mono text-slate-400 hover:text-secondary hover:underline"
                              >
                                {move.ca_number ? `CA ${move.ca_number}` : '+ informar CA'}
                              </button>
                            ) : null}
                            {move.document || move.note ? (
                              <span className="text-[11px] text-slate-500 max-w-xs">
                                {move.document ? <span className="font-bold">Doc. {move.document}</span> : null}
                                {move.document && move.note ? ' · ' : null}
                                {move.note}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {movementEmployeeLabel(move) ? (
                          <button
                            type="button"
                            onClick={() => setEmployeeFilter(move.employee_id ?? '')}
                            title="Ver só as movimentações deste colaborador"
                            className="flex items-center gap-2 text-left hover:underline"
                          >
                            <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold text-secondary">
                              {movementEmployeeLabel(move).charAt(0)}
                            </div>
                            <span className="text-sm font-medium text-slate-600">{movementEmployeeLabel(move)}</span>
                          </button>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <span className={`text-sm font-bold ${move.type === 'IN' ? 'text-green-600' : 'text-red-600'}`}>
                          {move.type === 'IN' ? '+' : '−'}
                          {formatQty(move.quantity)}
                        </span>
                        <span className="ml-1 text-[10px] font-bold text-slate-400 lowercase">{move.items?.unit}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        {(docsByMovement.get(move.id) ?? []).map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => void openDoc(doc)}
                            className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-secondary/40 bg-secondary/5 text-[11px] font-bold text-secondary hover:bg-secondary/10"
                            title={`Abrir ${doc.file_name}`}
                          >
                            <Paperclip size={12} />
                            {doc.kind === 'entrega' ? 'Cautela' : doc.kind === 'devolucao' ? 'Termo dev.' : 'Documento'}
                          </button>
                        ))}
                        {docsByMovement.get(move.id)?.length ? null : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && filteredMovements.length > visibleMovements.length ? (
          <div className="p-4 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={() => setRenderLimit((n) => n + RENDER_STEP)}
              className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-primary hover:bg-slate-50"
            >
              Mostrar mais ({visibleMovements.length} de {filteredMovements.length})
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
