'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import {
  titleFromSourceFilename,
  type ParsedPurchaseOrder,
  type ParsedPurchaseOrderItem,
} from '@/lib/purchaseOrderParse';
import {
  ORDENS_COMPRA_DEV_LOCAL,
  devLocalNewId,
  devLocalOrdersRead,
  devLocalOrdersWrite,
  type DevLocalPurchaseOrder,
} from '@/lib/ordensCompraDevLocal';
import {
  ClipboardList,
  FileUp,
  FilterX,
  Loader2,
  Plus,
  Search,
  X,
  AlertCircle,
  CheckCircle2,
  Circle,
} from 'lucide-react';

interface OrderRow {
  id: string;
  oc_number: string | null;
  title: string | null;
  vendor_name: string | null;
  delivery_deadline: string | null;
  created_at: string;
  purchase_order_items: { id: string; delivered: boolean }[] | null;
}

const emptyDraft = (): ParsedPurchaseOrder => ({
  oc_number: null,
  buyer_code: null,
  buyer_name: null,
  buyer_phone: null,
  vendor_name: null,
  vendor_contact_name: null,
  delivery_deadline: null,
  title: null,
  items: [],
});

function formatDateBR(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function OrdensCompraPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPending, setFilterPending] = useState<'all' | 'pending' | 'done'>('all');

  const [importOpen, setImportOpen] = useState(false);
  const [parseLoading, setParseLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [draft, setDraft] = useState<ParsedPurchaseOrder>(() => emptyDraft());
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    if (ORDENS_COMPRA_DEV_LOCAL && typeof window !== 'undefined') {
      const list = devLocalOrdersRead();
      setOrders(
        list.map((o) => ({
          id: o.id,
          oc_number: o.oc_number,
          title: o.title,
          vendor_name: o.vendor_name,
          delivery_deadline: o.delivery_deadline,
          created_at: o.created_at,
          purchase_order_items: o.items.map((i) => ({ id: i.id, delivered: i.delivered })),
        }))
      );
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setOrders([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('purchase_orders')
      .select('id, oc_number, title, vendor_name, delivery_deadline, created_at, purchase_order_items(id, delivered)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      setOrders([]);
    } else {
      setOrders((data as OrderRow[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const searchLower = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const items = o.purchase_order_items || [];
      const total = items.length;
      const done = items.filter((i) => i.delivered).length;
      const pending = total > 0 && done < total;

      if (filterPending === 'pending' && !pending) return false;
      if (filterPending === 'done' && (total === 0 || done < total)) return false;

      if (!searchLower) return true;
      const hay = [
        o.oc_number,
        o.title,
        o.vendor_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(searchLower);
    });
  }, [orders, searchLower, filterPending]);

  const openNewManual = () => {
    setDraft(emptyDraft());
    setSourceFilename(null);
    setWarnings([]);
    setParseError(null);
    setImportOpen(true);
  };

  const onPickPdf = async (file: File | null) => {
    if (!file) return;
    setParseError(null);
    setWarnings([]);
    setParseLoading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/purchase-orders/parse', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        setParseError(json.error || 'Falha ao analisar o PDF.');
        setDraft(emptyDraft());
        return;
      }
      setDraft(json.parsed as ParsedPurchaseOrder);
      setWarnings((json.warnings as string[]) || []);
      setSourceFilename(file.name);
      setImportOpen(true);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Erro de rede.');
    } finally {
      setParseLoading(false);
    }
  };

  const updateItem = (idx: number, patch: Partial<ParsedPurchaseOrderItem>) => {
    setDraft((d) => {
      const items = [...d.items];
      items[idx] = { ...items[idx], ...patch };
      return { ...d, items };
    });
  };

  const addItemRow = () => {
    setDraft((d) => ({
      ...d,
      items: [
        ...d.items,
        {
          line_number: (d.items[d.items.length - 1]?.line_number || 0) + 1,
          description: '',
          quantity: null,
          unit: 'un',
        },
      ],
    }));
  };

  const removeItemRow = (idx: number) => {
    setDraft((d) => ({
      ...d,
      items: d.items.filter((_, i) => i !== idx),
    }));
  };

  const saveDraft = async () => {
    setSaveLoading(true);
    setParseError(null);
    try {
      if (ORDENS_COMPRA_DEV_LOCAL && typeof window !== 'undefined') {
        const existing = devLocalOrdersRead();
        const newId = devLocalNewId();
        const items = draft.items
          .map((it, i) => ({
            id: devLocalNewId(),
            line_number: it.line_number || i + 1,
            description: it.description.trim() || `Item ${i + 1}`,
            quantity: it.quantity,
            unit: (it.unit || 'un').slice(0, 10),
            delivered: false,
            delivered_at: null,
          }))
          .filter((l) => l.description.length > 0);

        const row: DevLocalPurchaseOrder = {
          id: newId,
          oc_number: draft.oc_number?.trim() || null,
          title: sourceFilename?.trim()
            ? titleFromSourceFilename(sourceFilename)
            : draft.title?.trim() || null,
          vendor_name: draft.vendor_name?.trim() || null,
          buyer_code: null,
          buyer_name: null,
          buyer_phone: null,
          vendor_contact_name: null,
          delivery_deadline: draft.delivery_deadline || null,
          source_filename: sourceFilename,
          created_at: new Date().toISOString(),
          items,
        };

        devLocalOrdersWrite([row, ...existing]);
        setImportOpen(false);
        setDraft(emptyDraft());
        setSourceFilename(null);
        await fetchOrders();
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada.');

      const row = {
        user_id: user.id,
        oc_number: draft.oc_number?.trim() || null,
        title: sourceFilename?.trim()
          ? titleFromSourceFilename(sourceFilename)
          : draft.title?.trim() || null,
        vendor_name: draft.vendor_name?.trim() || null,
        delivery_deadline: draft.delivery_deadline || null,
        source_filename: sourceFilename,
      };

      const { data: po, error: poErr } = await supabase
        .from('purchase_orders')
        .insert([row])
        .select('id')
        .single();

      if (poErr) throw poErr;
      const pid = String(po.id);

      const lines = draft.items
        .map((it, i) => ({
          purchase_order_id: pid,
          line_number: it.line_number || i + 1,
          description: it.description.trim() || `Item ${i + 1}`,
          quantity: it.quantity,
          unit: (it.unit || 'un').slice(0, 10),
          delivered: false,
        }))
        .filter((l) => l.description.length > 0);

      if (lines.length) {
        const { error: liErr } = await supabase.from('purchase_order_items').insert(lines);
        if (liErr) throw liErr;
      }

      setImportOpen(false);
      setDraft(emptyDraft());
      await fetchOrders();
    } catch (e) {
      console.error(e);
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? [
              String((e as { message?: unknown }).message || ''),
              (e as { details?: string }).details,
              (e as { hint?: string }).hint,
            ]
              .filter(Boolean)
              .join(' — ')
          : '';
      setParseError(msg || (e instanceof Error ? e.message : 'Erro ao salvar.'));
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <ClipboardList className="text-secondary" />
            Ordens de compra
          </h1>
          <p className="text-slate-500 text-sm">
            Envie o PDF da OC; o sistema preenche fornecedor, data de entrega e itens. Marque entregas na página do pedido.
          </p>
          {ORDENS_COMPRA_DEV_LOCAL && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950">
              <strong className="font-bold">Modo local (dev):</strong> sem login ou Supabase. Dados só neste navegador (
              <code className="text-[10px]">localStorage</code>). Ative com{' '}
              <code className="text-[10px]">NEXT_PUBLIC_ORDENS_COMPRA_DEV_LOCAL=1</code> no{' '}
              <code className="text-[10px]">.env.local</code>.
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          <label className="flex flex-1 sm:flex-initial items-center justify-center gap-2 bg-white text-primary border border-slate-200 px-4 py-3 sm:py-2 rounded-lg hover:bg-slate-50 cursor-pointer font-medium text-sm min-h-[48px]">
            {parseLoading ? <Loader2 className="animate-spin" size={18} /> : <FileUp size={18} className="text-secondary" />}
            Importar PDF
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={parseLoading}
              onChange={(e) => void onPickPdf(e.target.files?.[0] || null)}
            />
          </label>
          <button
            type="button"
            onClick={openNewManual}
            className="flex flex-1 sm:flex-initial items-center justify-center gap-2 bg-primary text-white px-4 py-3 sm:py-2 rounded-lg font-medium text-sm min-h-[48px]"
          >
            <Plus size={18} />
            Nova OC manual
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm p-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
          <div className="flex-1 min-w-0">
            <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Busca</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                className="w-full pl-10 pr-3 py-3 rounded-xl border border-slate-200 text-sm font-medium text-primary outline-none focus:ring-2 focus:ring-secondary/30 min-h-[48px]"
                placeholder="Nº OC, fornecedor, título…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="w-full lg:w-52">
            <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Entrega</label>
            <select
              className="w-full px-3 py-3 rounded-xl border border-slate-200 text-sm font-medium bg-white min-h-[48px]"
              value={filterPending}
              onChange={(e) => setFilterPending(e.target.value as 'all' | 'pending' | 'done')}
            >
              <option value="all">Todas</option>
              <option value="pending">Com itens pendentes</option>
              <option value="done">Totalmente recebidas</option>
            </select>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 min-h-[48px] lg:mb-0"
            onClick={() => {
              setSearch('');
              setFilterPending('all');
            }}
          >
            <FilterX size={18} />
            Limpar filtros
          </button>
        </div>
        {!loading && (
          <p className="text-[11px] font-bold text-slate-400">
            Mostrando {filtered.length} de {orders.length} ordens
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center text-slate-400">
            <Loader2 className="animate-spin" size={28} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            Nenhuma ordem encontrada. Importe um PDF ou cadastre manualmente.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-left text-[10px] font-black uppercase text-slate-500">
                  <th className="px-4 py-3">OC</th>
                  <th className="px-4 py-3">Fornecedor / título</th>
                  <th className="px-4 py-3">Prazo</th>
                  <th className="px-4 py-3">Entrega</th>
                  <th className="px-4 py-3 w-24" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const items = o.purchase_order_items || [];
                  const total = items.length;
                  const done = items.filter((i) => i.delivered).length;
                  return (
                    <tr key={o.id} className="border-b border-slate-50 hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-bold text-primary whitespace-nowrap">
                        {o.oc_number || '—'}
                      </td>
                      <td className="px-4 py-3 min-w-[180px]">
                        <div className="font-medium text-primary truncate max-w-[240px] sm:max-w-md">
                          {o.title || o.vendor_name || 'Sem título'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {formatDateBR(o.delivery_deadline)}
                      </td>
                      <td className="px-4 py-3">
                        {total === 0 ? (
                          <span className="text-slate-400 text-xs">Sem itens</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-bold ${
                              done === total ? 'text-emerald-600' : 'text-amber-700'
                            }`}
                          >
                            {done === total ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                            {done}/{total}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/ordens-compra/${o.id}`}
                          className="text-secondary font-bold hover:underline text-xs sm:text-sm"
                        >
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {importOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col animate-in zoom-in duration-200 my-4">
            <div className="p-5 border-b bg-slate-50 flex items-start justify-between gap-3 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-primary">Revisar ordem de compra</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Ajuste os campos antes de salvar. A leitura do PDF é automática e pode exigir correções.
                </p>
              </div>
              <button
                type="button"
                className="p-2 rounded-full hover:bg-slate-200 text-slate-500"
                onClick={() => setImportOpen(false)}
                aria-label="Fechar"
              >
                <X size={22} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {(parseError || warnings.length > 0) && (
                <div className="space-y-2">
                  {parseError && (
                    <div className="flex gap-2 p-3 rounded-xl bg-red-50 border border-red-100 text-red-800 text-sm">
                      <AlertCircle className="shrink-0" size={18} />
                      {parseError}
                    </div>
                  )}
                  {warnings.map((w) => (
                    <div key={w} className="flex gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-900 text-xs font-medium">
                      <AlertCircle className="shrink-0" size={16} />
                      {w}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block text-xs font-bold text-slate-600">
                  Nº da OC
                  <input
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    value={draft.oc_number || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, oc_number: e.target.value || null }))}
                  />
                </label>
                <label className="block text-xs font-bold text-slate-600">
                  Título (nome do arquivo)
                  <input
                    className={`mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm ${
                      sourceFilename ? 'bg-slate-50 text-slate-700' : ''
                    }`}
                    readOnly={Boolean(sourceFilename)}
                    value={
                      sourceFilename
                        ? titleFromSourceFilename(sourceFilename) || ''
                        : draft.title || ''
                    }
                    onChange={
                      sourceFilename
                        ? undefined
                        : (e) => setDraft((d) => ({ ...d, title: e.target.value || null }))
                    }
                  />
                </label>
                {sourceFilename ? (
                  <p className="md:col-span-2 text-[10px] text-slate-500 -mt-2">
                    O título segue o arquivo importado e não pode ser alterado aqui.
                  </p>
                ) : null}
                <label className="block text-xs font-bold text-slate-600">
                  Fornecedor
                  <input
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    value={draft.vendor_name || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, vendor_name: e.target.value || null }))}
                  />
                </label>
                <label className="block text-xs font-bold text-slate-600 md:col-span-2">
                  Data de entrega
                  <input
                    type="date"
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    value={draft.delivery_deadline || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, delivery_deadline: e.target.value || null }))}
                  />
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-primary">Itens</h3>
                  <button
                    type="button"
                    onClick={addItemRow}
                    className="text-xs font-bold text-secondary hover:underline"
                  >
                    + linha
                  </button>
                </div>
                <div className="border border-slate-100 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500">
                      <tr>
                        <th className="px-2 py-2 w-10">#</th>
                        <th className="px-2 py-2">Descrição</th>
                        <th className="px-2 py-2 w-20">Qtd</th>
                        <th className="px-2 py-2 w-16">Un</th>
                        <th className="px-2 py-2 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {draft.items.map((it, idx) => (
                        <tr key={`${it.line_number}-${idx}`} className="border-t border-slate-100">
                          <td className="px-2 py-1 align-top">
                            <input
                              className="w-full px-1 py-1 border border-slate-200 rounded"
                              type="number"
                              value={it.line_number}
                              onChange={(e) =>
                                updateItem(idx, { line_number: parseInt(e.target.value, 10) || 0 })
                              }
                            />
                          </td>
                          <td className="px-2 py-1 align-top">
                            <input
                              className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                              value={it.description}
                              onChange={(e) => updateItem(idx, { description: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-1 align-top">
                            <input
                              className="w-full px-1 py-1 border border-slate-200 rounded"
                              type="number"
                              step="any"
                              value={it.quantity ?? ''}
                              onChange={(e) =>
                                updateItem(idx, {
                                  quantity: e.target.value === '' ? null : parseFloat(e.target.value),
                                })
                              }
                            />
                          </td>
                          <td className="px-2 py-1 align-top">
                            <input
                              className="w-full px-1 py-1 border border-slate-200 rounded"
                              value={it.unit || ''}
                              onChange={(e) => updateItem(idx, { unit: e.target.value || null })}
                            />
                          </td>
                          <td className="px-1 py-1 align-top">
                            <button
                              type="button"
                              className="text-red-500 p-1"
                              onClick={() => removeItemRow(idx)}
                              aria-label="Remover"
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-4 border-t bg-slate-50 flex flex-wrap gap-2 justify-end shrink-0">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-600"
                onClick={() => setImportOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saveLoading}
                onClick={() => void saveDraft()}
                className="px-5 py-2 rounded-lg bg-secondary text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2"
              >
                {saveLoading && <Loader2 className="animate-spin" size={16} />}
                Salvar no sistema
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
