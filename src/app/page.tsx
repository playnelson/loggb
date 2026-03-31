'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { Plus, Search, Trash2, ArrowLeft, ArrowRight } from 'lucide-react';
import type { EmployeeLite, PurchaseOrderItemRow, PurchaseOrderRow, PurchaseStage } from '@/lib/purchaseOrders';
import { PURCHASE_STAGES, isPurchaseStage } from '@/lib/purchaseOrders';
import { PurchaseOrderFormModal } from '@/components/PurchaseOrderFormModal';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [items, setItems] = useState<PurchaseOrderItemRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'Todos' | PurchaseStage>('Todos');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const parseStageFilter = (v: string): 'Todos' | PurchaseStage => (v === 'Todos' ? 'Todos' : (v as PurchaseStage));

  const fetchOrders = async () => {
    setLoading(true);
    const { data: orderData, error: orderError } = await supabase
      .from('purchase_orders')
      .select('id, requester_employee_id, stage, notes, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (orderError) {
      console.error('Error fetching purchase orders:', orderError);
      setOrders([]);
      setItems([]);
      setEmployees([]);
      setLoading(false);
      return;
    }

    const orderList: PurchaseOrderRow[] = (orderData || []).map((r: unknown) => {
      const row = r as Record<string, unknown>;
      const stageRaw = String(row.stage ?? '');
      return {
        id: String(row.id),
        requester_employee_id: String(row.requester_employee_id),
        stage: isPurchaseStage(stageRaw) ? stageRaw : 'Rascunho',
        notes: (row.notes as string) ?? null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
      };
    });
    setOrders(orderList);

    const ids = orderList.map((o) => o.id);
    if (ids.length === 0) {
      setItems([]);
    } else {
      const { data: itemData, error: itemError } = await supabase
        .from('purchase_order_items')
        .select('id, order_id, product_name, product_url, vendor, product_price, quantity_requested, quantity_received, received_at, notes, created_at, updated_at')
        .in('order_id', ids);
      if (itemError) {
        console.error('Error fetching purchase order items:', itemError);
        setItems([]);
      } else {
        const itemList: PurchaseOrderItemRow[] = (itemData || []).map((r: unknown) => {
          const row = r as Record<string, unknown>;
          return {
            id: String(row.id),
            order_id: String(row.order_id),
            product_name: (row.product_name as string) ?? null,
            product_url: (row.product_url as string) ?? null,
            vendor: (row.vendor as string) ?? null,
            product_price: (row.product_price as string) ?? null,
            quantity_requested: Number(row.quantity_requested ?? 0),
            quantity_received: Number(row.quantity_received ?? 0),
            received_at: (row.received_at as string) ?? null,
            notes: (row.notes as string) ?? null,
            created_at: String(row.created_at),
            updated_at: String(row.updated_at),
          };
        });
        setItems(itemList);
      }
    }

    const { data: empData, error: empError } = await supabase
      .from('employees')
      .select('id, full_name, status')
      .order('full_name', { ascending: true });
    if (empError) {
      console.error('Error fetching employees:', empError);
      setEmployees([]);
    } else {
      const list: EmployeeLite[] = (empData || []).map((r: unknown) => {
        const row = r as Record<string, unknown>;
        return {
          id: String(row.id),
          full_name: String(row.full_name ?? ''),
          status: row.status ? String(row.status) : undefined,
        };
      });
      setEmployees(list);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchOrders();
  }, []);

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach((e) => map.set(e.id, e.full_name));
    return map;
  }, [employees]);

  const itemsByOrderId = useMemo(() => {
    const map = new Map<string, PurchaseOrderItemRow[]>();
    items.forEach((it) => {
      const bucket = map.get(it.order_id) || [];
      bucket.push(it);
      map.set(it.order_id, bucket);
    });
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return orders.filter((o) => {
      const matchesStage = stageFilter === 'Todos' || o.stage === stageFilter;
      if (!s) return matchesStage;
      const requesterName = employeeNameById.get(o.requester_employee_id) || '';
      const lineItems = itemsByOrderId.get(o.id) || [];
      const itemBlob = lineItems
        .flatMap((it) => [it.product_name, it.vendor, it.product_url, it.product_price, it.notes])
        .filter(Boolean)
        .join(' ');
      const blob = [
        requesterName,
        o.stage,
        o.notes,
        itemBlob,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return matchesStage && blob.includes(s);
    });
  }, [orders, search, stageFilter, employeeNameById, itemsByOrderId]);

  const byStage = useMemo(() => {
    const map = new Map<PurchaseStage, PurchaseOrderRow[]>();
    PURCHASE_STAGES.forEach((s) => map.set(s, []));
    filtered.forEach((o) => {
      const bucket = map.get(o.stage) || [];
      bucket.push(o);
      map.set(o.stage, bucket);
    });
    return map;
  }, [filtered]);

  const updateStage = async (id: string, next: PurchaseStage) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, stage: next } : o)));
    const { error } = await supabase.from('purchase_orders').update({ stage: next }).eq('id', id);
    if (error) {
      alert(`Erro ao atualizar estágio: ${error.message}`);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      fetchOrders();
    }
  };

  const deleteRequest = async (id: string) => {
    if (!confirm('Excluir este pedido? (Não apaga itens do almoxarifado)')) return;
    const { error } = await supabase.from('purchase_orders').delete().eq('id', id);
    if (error) alert(`Erro ao excluir: ${error.message}`);
    else {
      setOrders((prev) => prev.filter((o) => o.id !== id));
      setItems((prev) => prev.filter((it) => it.order_id !== id));
    }
  };

  const nextStageOf = (stage: PurchaseStage): PurchaseStage | null => {
    const idx = PURCHASE_STAGES.indexOf(stage);
    return idx >= 0 && idx < PURCHASE_STAGES.length - 1 ? PURCHASE_STAGES[idx + 1] : null;
  };

  const prevStageOf = (stage: PurchaseStage): PurchaseStage | null => {
    const idx = PURCHASE_STAGES.indexOf(stage);
    return idx > 0 ? PURCHASE_STAGES[idx - 1] : null;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">Quadro de Pedidos</h1>
          <p className="text-slate-500 text-sm">Kanban por estágio com rascunhos e atualização rápida.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-all font-medium text-sm"
          >
            <Plus size={16} />
            Novo Pedido
          </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-border shadow-sm flex flex-col lg:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Buscar por solicitante, produto, link, fornecedor..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/50 outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Estágio</span>
          <select
            className="bg-transparent border-none text-sm focus:ring-0 outline-none font-medium text-slate-600"
            value={stageFilter}
            onChange={(e) => setStageFilter(parseStageFilter(e.target.value))}
          >
            <option value="Todos">Todos</option>
            {PURCHASE_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Link
          href="/orders"
          className="flex items-center justify-center gap-2 bg-white text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-all font-medium text-sm"
          title="Ver em lista"
        >
          Ver lista
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            {loading ? 'Carregando…' : `${filtered.length} pedidos`}
          </div>
          <div className="text-[10px] text-slate-400 font-bold">
            Dica: use o dropdown do card para mudar de coluna.
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[1100px] grid grid-cols-6 gap-4 p-4">
            {PURCHASE_STAGES.map((stage) => {
              const items = byStage.get(stage) || [];
              return (
                <div key={stage} className="bg-slate-50/60 border border-slate-100 rounded-2xl p-3 flex flex-col min-h-[420px]">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[11px] font-black text-primary uppercase tracking-tight">{stage}</div>
                    <div className="text-[10px] font-bold text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                      {items.length}
                    </div>
                  </div>

                  {loading ? (
                    <div className="space-y-3">
                      {Array(3)
                        .fill(0)
                        .map((_, i) => (
                          <div key={i} className="h-24 bg-white/60 rounded-xl border border-slate-100 animate-pulse" />
                        ))}
                    </div>
                  ) : items.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-slate-300 text-xs font-bold italic">
                      Vazio
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {items.map((o) => {
                        const prev = prevStageOf(o.stage);
                        const next = nextStageOf(o.stage);
                        const lineItems = itemsByOrderId.get(o.id) || [];
                        const itemCount = lineItems.length;
                        const qtyReq = lineItems.reduce((acc, it) => acc + (it.quantity_requested || 0), 0);
                        const qtyRec = lineItems.reduce((acc, it) => acc + (it.quantity_received || 0), 0);
                        const progress = qtyReq > 0 ? Math.min(100, Math.round((qtyRec / qtyReq) * 100)) : 0;
                        const requesterName = employeeNameById.get(o.requester_employee_id) || '—';
                        const title = `Pedido (${itemCount} itens)`;
                        const subtitle = `${requesterName} • ${qtyRec}/${qtyReq} recebidos`;
                        return (
                          <div
                            key={o.id}
                            className="bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-bold text-primary text-sm truncate">{title}</div>
                                <div className="text-[11px] text-slate-500 font-medium truncate">
                                  {subtitle || '—'}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void deleteRequest(o.id)}
                                className="p-2 hover:bg-slate-50 rounded-lg text-slate-300 hover:text-red-500 shrink-0"
                                title="Excluir pedido"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>

                            <div className="mt-2 flex items-center justify-between gap-2">
                              <div className="text-[11px] font-mono text-slate-500">
                                {progress}% recebido
                              </div>
                              <div className="flex items-center gap-2">
                                <Link
                                  href={`/orders/${o.id}`}
                                  className="text-[10px] text-slate-400 font-bold hover:text-secondary hover:underline"
                                  title="Abrir na lista de pedidos"
                                >
                                  Abrir
                                </Link>
                              </div>
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                              <select
                                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 outline-none"
                                value={o.stage}
                                onChange={(e) => void updateStage(o.id, e.target.value as PurchaseStage)}
                              >
                                {PURCHASE_STAGES.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={!prev}
                                onClick={() => prev && void updateStage(o.id, prev)}
                                className="p-2 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-primary disabled:opacity-40"
                                title="Voltar estágio"
                              >
                                <ArrowLeft size={16} />
                              </button>
                              <button
                                type="button"
                                disabled={!next}
                                onClick={() => next && void updateStage(o.id, next)}
                                className="p-2 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-primary disabled:opacity-40"
                                title="Avançar estágio"
                              >
                                <ArrowRight size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <PurchaseOrderFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaved={() => {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          fetchOrders();
        }}
      />
    </div>
  );
}
