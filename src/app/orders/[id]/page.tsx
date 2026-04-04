'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Loader2, Plus, Trash2, Wand2, Link as LinkIcon, Save, Sheet, Search } from 'lucide-react';
import type { EmployeeLite, PurchaseOrderItemRow, PurchaseOrderRow } from '@/lib/purchaseOrders';
import { clampNumber } from '@/lib/purchaseOrders';
import { downloadOrdersSpreadsheet } from '@/lib/ordersExport';
import {
  ensureKanbanColumnsSeeded,
  resolveColumnIdForOrder,
  type KanbanColumnRow,
} from '@/lib/kanbanColumns';
import { fetchPurchaseOrderById, fetchPurchaseOrderItemsForOrderIdOrdered } from '@/lib/purchaseOrderQueries';
import { fetchCaEpiByNumber } from '@/lib/caEpiClient';

function OrderDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const orderId = params?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linkLoadingIdx, setLinkLoadingIdx] = useState<number | null>(null);
  const [caLoadingIdx, setCaLoadingIdx] = useState<number | null>(null);

  const [items, setItems] = useState<PurchaseOrderItemRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [columns, setColumns] = useState<KanbanColumnRow[]>([]);
  const [order, setOrder] = useState<PurchaseOrderRow | null>(null);

  const [orderColumnId, setOrderColumnId] = useState<string>('');
  const [orderTitle, setOrderTitle] = useState<string>('');
  const [requesterId, setRequesterId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const fetchAll = async () => {
    if (!orderId) return;
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      setLoading(false);
      return;
    }

    const seeded = await ensureKanbanColumnsSeeded(supabase, user.id);
    setColumns(seeded.columns);

    const { row: o, error: oErr } = await fetchPurchaseOrderById(supabase, orderId);
    if (oErr || !o) {
      alert(`Pedido não encontrado: ${oErr?.message || 'erro'}`);
      setLoading(false);
      return;
    }

    const oRow = o;
    if (String(oRow.user_id ?? '') !== user.id) {
      alert('Pedido não encontrado ou não pertence à sua conta.');
      router.push('/orders');
      setLoading(false);
      return;
    }
    const row: PurchaseOrderRow = {
      id: String(oRow.id),
      requester_employee_id: String(oRow.requester_employee_id),
      stage: String(oRow.stage ?? ''),
      title: (oRow.title as string) ?? null,
      kanban_column_id: oRow.kanban_column_id ? String(oRow.kanban_column_id) : null,
      notes: (oRow.notes as string) ?? null,
      created_at: String(oRow.created_at),
      updated_at: String(oRow.updated_at),
    };

    const { items: itemList, error: itErr } = await fetchPurchaseOrderItemsForOrderIdOrdered(
      supabase,
      orderId,
      true
    );
    if (itErr) {
      console.error('Error fetching order items:', itErr);
    }

    const { data: empData } = await supabase
      .from('employees')
      .select('id, full_name, status')
      .eq('user_id', user.id)
      .order('full_name', { ascending: true });

    const empList: EmployeeLite[] = (empData || []).map((r: unknown) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        full_name: String(row.full_name ?? ''),
        status: row.status ? String(row.status) : undefined,
      };
    });
    setEmployees(empList);
    setItems(itemList);
    setOrder(row);
    const cid = resolveColumnIdForOrder(row, seeded.columns);
    setOrderColumnId(cid || seeded.columns[0]?.id || '');
    setOrderTitle(row.title || '');
    setRequesterId(row.requester_employee_id);
    setNotes(row.notes || '');

    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll();
  }, [orderId]);

  const totals = useMemo(() => {
    const req = items.reduce((acc, it) => acc + (it.quantity_requested || 0), 0);
    const rec = items.reduce((acc, it) => acc + (it.quantity_received || 0), 0);
    const progress = req > 0 ? Math.min(100, Math.round((rec / req) * 100)) : 0;
    return { req, rec, progress };
  }, [items]);

  const saveOrderHeader = async () => {
    if (!orderId) return;
    if (!requesterId) {
      alert('Selecione um solicitante.');
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const col = columns.find((c) => c.id === orderColumnId) || columns[0];
    if (!col) {
      alert('Coluna do quadro inválida.');
      setSaving(false);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('purchase_orders')
      .update({
        requester_employee_id: requesterId,
        kanban_column_id: col.id,
        stage: col.title,
        title: orderTitle.trim() || null,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .eq('user_id', user.id);
    if (error) alert(`Erro ao salvar pedido: ${error.message}`);
    await fetchAll();
    setSaving(false);
  };

  const addItem = async () => {
    if (!orderId) return;
    const { error } = await supabase.from('purchase_order_items').insert([
      {
        order_id: orderId,
        unit: 'un',
        quantity_requested: 1,
        quantity_received: 0,
      },
    ]);
    if (error) alert(`Erro ao adicionar item: ${error.message}`);
    else await fetchAll();
  };

  const deleteItem = async (id: string) => {
    if (!confirm('Remover este item do pedido?')) return;
    const { error } = await supabase.from('purchase_order_items').delete().eq('id', id);
    if (error) alert(`Erro ao remover item: ${error.message}`);
    else setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const updateItem = async (id: string, patch: Partial<PurchaseOrderItemRow>) => {
    let dbPatch: Record<string, unknown> = { ...patch };
    setItems((prev) => {
      const cur = prev.find((x) => x.id === id);
      const nextRequested =
        typeof patch.quantity_requested === 'number' ? patch.quantity_requested : (cur?.quantity_requested ?? 0);
      const nextReceived =
        typeof patch.quantity_received === 'number' ? patch.quantity_received : (cur?.quantity_received ?? 0);

      // Ensure received_at set when quantity_received reaches requested
      if (typeof patch.quantity_received === 'number' || typeof patch.quantity_requested === 'number') {
        if (nextReceived > 0 && nextReceived >= nextRequested) {
          dbPatch = { ...dbPatch, received_at: new Date().toISOString() };
        } else if (nextReceived === 0) {
          dbPatch = { ...dbPatch, received_at: null };
        } else {
          dbPatch = { ...dbPatch, received_at: null };
        }
      }

      return prev.map((it) => (it.id === id ? { ...it, ...patch, received_at: (dbPatch.received_at as string | null) ?? it.received_at } : it));
    });
    const { error } = await supabase.from('purchase_order_items').update(dbPatch).eq('id', id);
    if (error) {
      alert(`Erro ao salvar item: ${error.message}`);
      await fetchAll();
    }
  };

  const pullFromLink = async (id: string, url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    const idx = items.findIndex((x) => x.id === id);
    if (idx === -1) return;
    setLinkLoadingIdx(idx);
    try {
      const res = await fetch(`/api/link-metadata?url=${encodeURIComponent(trimmed)}`);
      const json: unknown = await res.json();
      if (!res.ok) {
        const msg =
          typeof json === 'object' && json && 'error' in json
            ? String((json as { error?: unknown }).error ?? 'Não foi possível ler o link.')
            : 'Não foi possível ler o link.';
        alert(msg);
        return;
      }
      const payload = json as { product_name?: string | null; vendor?: string | null; product_price?: string | null };
      const cur = items[idx];
      await updateItem(id, {
        product_name: cur.product_name || (payload.product_name ?? null),
        vendor: cur.vendor || (payload.vendor ?? null),
        product_price: cur.product_price || (payload.product_price ?? null),
      });
    } finally {
      setLinkLoadingIdx(null);
    }
  };

  const pullFromCa = async (id: string, idx: number) => {
    const it = items.find((x) => x.id === id);
    const raw = (it?.ca_number || '').replace(/\D/g, '');
    if (raw.length < 4) {
      alert('Informe o CA (mín. 4 dígitos).');
      return;
    }
    setCaLoadingIdx(idx);
    try {
      const res = await fetchCaEpiByNumber(raw);
      if (!res.ok) {
        let msg = res.error ?? 'Falha na consulta.';
        if (res.hint) msg += `\n\n${res.hint}`;
        alert(msg);
        return;
      }
      if (res.label) {
        const cur = items.find((x) => x.id === id);
        await updateItem(id, {
          ca_number: raw,
          product_name: cur?.product_name || res.label,
        });
      }
    } finally {
      setCaLoadingIdx(null);
    }
  };

  if (!orderId) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-primary">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-primary">Editar Pedido</h1>
            <p className="text-slate-500 text-sm">
              {loading ? 'Carregando…' : `${totals.rec}/${totals.req} recebidos • ${totals.progress}%`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.push('/orders')}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50"
          >
            Lista
          </button>
          <button
            type="button"
            onClick={() => {
              if (!order) return;
              downloadOrdersSpreadsheet({
                orders: [order],
                items,
                employees,
                title: `Pedido ${order.id}`,
              });
            }}
            disabled={loading || !order}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2"
            title="Baixar este pedido em planilha (.xlsx)"
          >
            <Sheet size={16} />
            Baixar
          </button>
          <button
            type="button"
            onClick={() => void saveOrderHeader()}
            disabled={saving}
            className="px-4 py-2 bg-primary text-white rounded-lg font-bold hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            Salvar
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white p-8 rounded-2xl border border-border shadow-sm text-center text-slate-500">
          <Loader2 className="animate-spin inline mr-2" size={18} />
          Carregando pedido…
        </div>
      ) : (
        <>
          <div className="bg-white p-6 rounded-2xl border border-border shadow-sm space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-bold uppercase text-slate-500">Título no quadro (opcional)</label>
                <input
                  type="text"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-bold"
                  value={orderTitle}
                  onChange={(e) => setOrderTitle(e.target.value)}
                  placeholder="Ex.: Compra EPI obra norte"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-500">Solicitante (Funcionário) *</label>
                <select
                  required
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-medium"
                  value={requesterId}
                  onChange={(e) => setRequesterId(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-500">Coluna do quadro</label>
                <select
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-medium"
                  value={orderColumnId}
                  onChange={(e) => setOrderColumnId(e.target.value)}
                >
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-bold uppercase text-slate-500">Observações</label>
                <input
                  type="text"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-6 border-b bg-slate-50 flex items-center justify-between">
              <h2 className="font-bold text-primary">Itens do pedido</h2>
              <button
                type="button"
                onClick={() => void addItem()}
                className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-all font-medium text-sm"
              >
                <Plus size={16} />
                Adicionar item
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 border-b border-border">
                  <tr>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">CA</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Produto</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Fornecedor</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Un</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Qtd. pedida</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Qtd. recebida</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Preço</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-10 text-center text-slate-400 italic">
                        Nenhum item. Clique em “Adicionar item”.
                      </td>
                    </tr>
                  ) : (
                    items.map((it, idx) => (
                      <tr key={it.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 align-top w-36">
                          <div className="flex gap-1">
                            <input
                              type="text"
                              inputMode="numeric"
                              className="w-full min-w-0 p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-xs font-mono"
                              placeholder="CA"
                              value={it.ca_number || ''}
                              onChange={(e) => void updateItem(it.id, { ca_number: e.target.value || null })}
                            />
                            <button
                              type="button"
                              onClick={() => void pullFromCa(it.id, idx)}
                              disabled={caLoadingIdx === idx}
                              className="shrink-0 p-2 bg-teal-50 border border-teal-200 rounded-lg text-teal-800 disabled:opacity-50"
                              title="Nome pelo CA"
                            >
                              {caLoadingIdx === idx ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />}
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="space-y-2">
                            <input
                              type="text"
                              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-bold text-primary"
                              placeholder="Nome do produto"
                              value={it.product_name || ''}
                              onChange={(e) => void updateItem(it.id, { product_name: e.target.value })}
                            />
                            <div className="flex gap-2">
                              <input
                                type="url"
                                className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-xs font-mono"
                                placeholder="Link do produto"
                                value={it.product_url || ''}
                                onChange={(e) => void updateItem(it.id, { product_url: e.target.value })}
                              />
                              <button
                                type="button"
                                onClick={() => void pullFromLink(it.id, it.product_url || '')}
                                disabled={linkLoadingIdx === idx || !(it.product_url || '').trim()}
                                className="px-3 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2 text-xs"
                                title="Puxar nome/infos do link"
                              >
                                {linkLoadingIdx === idx ? <Loader2 className="animate-spin" size={14} /> : <Wand2 size={14} />}
                                Puxar
                              </button>
                              {it.product_url && (
                                <a
                                  href={it.product_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2 text-xs"
                                  title="Abrir link"
                                >
                                  <LinkIcon size={14} />
                                  Abrir
                                </a>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <input
                            type="text"
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                            placeholder="Fornecedor"
                            value={it.vendor || ''}
                            onChange={(e) => void updateItem(it.id, { vendor: e.target.value })}
                          />
                        </td>
                        <td className="px-6 py-4">
                          <select
                            className="w-24 p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold text-sm"
                            value={it.unit}
                            onChange={(e) => void updateItem(it.id, { unit: e.target.value })}
                            title="Unidade"
                          >
                            <option value="un">un</option>
                            <option value="par">par</option>
                            <option value="kg">kg</option>
                            <option value="g">g</option>
                            <option value="L">L</option>
                            <option value="mL">mL</option>
                            <option value="m">m</option>
                            <option value="cm">cm</option>
                            <option value="cx">cx</option>
                          </select>
                        </td>
                        <td className="px-6 py-4">
                          <input
                            type="number"
                            min={1}
                            className="w-24 p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold"
                            value={it.quantity_requested}
                            onChange={(e) =>
                              void updateItem(it.id, {
                                quantity_requested: clampNumber(Number(e.target.value), 1, 1_000_000),
                                quantity_received: clampNumber(it.quantity_received, 0, clampNumber(Number(e.target.value), 1, 1_000_000)),
                              })
                            }
                            onFocus={(e) => e.target.select()}
                          />
                        </td>
                        <td className="px-6 py-4">
                          <input
                            type="number"
                            min={0}
                            max={it.quantity_requested}
                            className="w-24 p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold"
                            value={it.quantity_received}
                            onChange={(e) =>
                              void updateItem(it.id, {
                                quantity_received: clampNumber(Number(e.target.value), 0, it.quantity_requested),
                              })
                            }
                            onFocus={(e) => e.target.select()}
                          />
                        </td>
                        <td className="px-6 py-4">
                          <input
                            type="text"
                            className="w-28 p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none font-mono text-sm"
                            placeholder="R$ 0,00"
                            value={it.product_price || ''}
                            onChange={(e) => void updateItem(it.id, { product_price: e.target.value })}
                          />
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => void deleteItem(it.id)}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-500"
                            title="Remover item"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function OrderDetailPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Carregando pedido...</div>}>
      <OrderDetailContent />
    </Suspense>
  );
}

