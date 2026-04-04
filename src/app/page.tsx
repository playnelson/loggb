'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { Plus, Search, Trash2, ArrowLeft, ArrowRight, GripVertical, LayoutGrid, ClipboardList } from 'lucide-react';
import type { EmployeeLite, PurchaseOrderItemRow, PurchaseOrderRow } from '@/lib/purchaseOrders';
import { PurchaseOrderFormModal } from '@/components/PurchaseOrderFormModal';
import { KanbanBoardEditor } from '@/components/KanbanBoardEditor';
import { QuickKanbanTaskModal } from '@/components/QuickKanbanTaskModal';
import {
  ensureKanbanColumnsSeeded,
  resolveColumnIdForOrder,
  type KanbanColumnRow,
} from '@/lib/kanbanColumns';
import { fetchPurchaseOrdersForUser, fetchPurchaseOrderItemsForOrderIds } from '@/lib/purchaseOrderQueries';

/** Pedido com linhas de item — sempre amarelo post-it. */
const POSTIT_PEDIDO = {
  card: 'bg-[#fff8b0] border-[#e6d25c] shadow-[4px_4px_0_0_rgba(15,23,42,0.07)]',
  text: 'text-amber-950',
} as const;

/** Tarefa sem itens (ex.: tarefa rápida) — verde-água. */
const POSTIT_TAREFA = {
  card: 'bg-[#d6f5ef] border-[#5ec4b0] shadow-[4px_4px_0_0_rgba(15,23,42,0.07)]',
  text: 'text-teal-950',
} as const;

/** Cartões na coluna Cancelado (slug ou título) — salmão. */
const POSTIT_CANCELADO = {
  card: 'bg-[#fde8e8] border-[#e8a0a0] shadow-[4px_4px_0_0_rgba(15,23,42,0.07)]',
  text: 'text-red-950',
} as const;

function isCancelColumn(col: KanbanColumnRow): boolean {
  const s = col.slug.toLowerCase();
  const t = col.title.trim().toLowerCase();
  return s === 'cancelado' || s.includes('cancel') || t.includes('cancel');
}

function postitThemeForCard(col: KanbanColumnRow, itemCount: number) {
  if (isCancelColumn(col)) return POSTIT_CANCELADO;
  if (itemCount > 0) return POSTIT_PEDIDO;
  return POSTIT_TAREFA;
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [columns, setColumns] = useState<KanbanColumnRow[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [items, setItems] = useState<PurchaseOrderItemRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [search, setSearch] = useState('');
  const [columnFilter, setColumnFilter] = useState<'Todos' | string>('Todos');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [boardEditorOpen, setBoardEditorOpen] = useState(false);
  const [quickTaskOpen, setQuickTaskOpen] = useState(false);
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null);
  const [dropTargetColumnId, setDropTargetColumnId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setOrders([]);
      setItems([]);
      setEmployees([]);
      setColumns([]);
      setBoardError(null);
      setLoading(false);
      return;
    }

    const seeded = await ensureKanbanColumnsSeeded(supabase, user.id);
    if (seeded.error) {
      setBoardError(seeded.error);
      setColumns([]);
    } else if (seeded.columns.length === 0) {
      setBoardError('Nenhuma coluna do quadro. Verifique o script SQL kanban_and_ca.sql no Supabase.');
      setColumns([]);
    } else {
      setBoardError(null);
      setColumns(seeded.columns);
    }

    const colList = seeded.columns;

    const { rows: orderList, error: orderError } = await fetchPurchaseOrdersForUser(
      supabase,
      user.id,
      false
    );

    if (orderError) {
      console.error('Error fetching purchase orders:', orderError);
      setOrders([]);
      setItems([]);
      setEmployees([]);
      setLoading(false);
      return;
    }

    if (colList.length > 0) {
      for (const o of orderList) {
        if (o.kanban_column_id) continue;
        const cid = resolveColumnIdForOrder(o, colList);
        if (!cid) continue;
        const { error: upErr } = await supabase
          .from('purchase_orders')
          .update({ kanban_column_id: cid, updated_at: new Date().toISOString() })
          .eq('id', o.id)
          .eq('user_id', user.id);
        if (!upErr) o.kanban_column_id = cid;
      }
    }

    setOrders(orderList);

    const ids = orderList.map((o) => o.id);
    if (ids.length === 0) {
      setItems([]);
    } else {
      const { items: itemList, error: itemError } = await fetchPurchaseOrderItemsForOrderIds(supabase, ids);
      if (itemError) {
        console.error('Error fetching purchase order items:', itemError);
        setItems([]);
      } else {
        setItems(itemList);
      }
    }

    const { data: empData, error: empError } = await supabase
      .from('employees')
      .select('id, full_name, status')
      .eq('user_id', user.id)
      .order('full_name', { ascending: true });
    if (empError) {
      console.error('Error fetching employees:', empError);
      setEmployees([]);
    } else {
      setEmployees(
        (empData || []).map((r: unknown) => {
          const row = r as Record<string, unknown>;
          return {
            id: String(row.id),
            full_name: String(row.full_name ?? ''),
            status: row.status ? String(row.status) : undefined,
          };
        })
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

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

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.sort_order - b.sort_order),
    [columns]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return orders.filter((o) => {
      const cid = resolveColumnIdForOrder(o, sortedColumns);
      const matchesCol = columnFilter === 'Todos' || cid === columnFilter;
      if (!s) return matchesCol;
      const requesterName = employeeNameById.get(o.requester_employee_id) || '';
      const lineItems = itemsByOrderId.get(o.id) || [];
      const itemBlob = lineItems
        .flatMap((it) => [it.product_name, it.vendor, it.product_url, it.product_price, it.notes, it.ca_number])
        .filter(Boolean)
        .join(' ');
      const blob = [requesterName, o.stage, o.title, o.notes, itemBlob].filter(Boolean).join(' ').toLowerCase();
      return matchesCol && blob.includes(s);
    });
  }, [orders, search, columnFilter, employeeNameById, itemsByOrderId, sortedColumns]);

  const byColumn = useMemo(() => {
    const map = new Map<string, PurchaseOrderRow[]>();
    sortedColumns.forEach((c) => map.set(c.id, []));
    filtered.forEach((o) => {
      const cid = resolveColumnIdForOrder(o, sortedColumns);
      if (!cid) return;
      const bucket = map.get(cid) || [];
      bucket.push(o);
      map.set(cid, bucket);
    });
    return map;
  }, [filtered, sortedColumns]);

  const moveToColumn = async (orderId: string, columnId: string) => {
    const col = sortedColumns.find((c) => c.id === columnId);
    if (!col) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, kanban_column_id: columnId, stage: col.title } : o
      )
    );
    const { error } = await supabase
      .from('purchase_orders')
      .update({
        kanban_column_id: columnId,
        stage: col.title,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .eq('user_id', user.id);
    if (error) {
      alert(`Erro ao mover cartão: ${error.message}`);
      void fetchOrders();
    }
  };

  const deleteRequest = async (id: string) => {
    if (!confirm('Excluir este pedido/tarefa? (Não apaga itens do almoxarifado)')) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('purchase_orders').delete().eq('id', id).eq('user_id', user.id);
    if (error) alert(`Erro ao excluir: ${error.message}`);
    else {
      setOrders((prev) => prev.filter((o) => o.id !== id));
      setItems((prev) => prev.filter((it) => it.order_id !== id));
    }
  };

  const neighborColumn = (order: PurchaseOrderRow, dir: -1 | 1): KanbanColumnRow | null => {
    const cid = resolveColumnIdForOrder(order, sortedColumns);
    const idx = sortedColumns.findIndex((c) => c.id === cid);
    if (idx < 0) return null;
    const j = idx + dir;
    if (j < 0 || j >= sortedColumns.length) return null;
    return sortedColumns[j];
  };

  const defaultColumnIdForModals = sortedColumns[0]?.id ?? '';

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">Quadro de Pedidos</h1>
          <p className="text-slate-500 text-sm">
            Cartões estilo post-it (somente leitura aqui). Edite título, itens e solicitante na aba Pedidos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setQuickTaskOpen(true)}
            disabled={sortedColumns.length === 0 || employees.length === 0}
            className="flex items-center gap-2 bg-secondary text-white px-4 py-2 rounded-lg hover:opacity-95 transition-all font-medium text-sm disabled:opacity-50"
          >
            <ClipboardList size={16} />
            Nova tarefa
          </button>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-all font-medium text-sm"
          >
            <Plus size={16} />
            Novo pedido
          </button>
          <button
            type="button"
            onClick={() => setBoardEditorOpen(true)}
            disabled={sortedColumns.length === 0}
            className="flex items-center gap-2 bg-white text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 font-medium text-sm disabled:opacity-50"
          >
            <LayoutGrid size={16} />
            Editar quadro
          </button>
        </div>
      </div>

      {boardError && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm">
          <strong>Quadro:</strong> {boardError}
        </div>
      )}

      <div className="bg-white p-4 rounded-xl border border-border shadow-sm flex flex-col lg:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Buscar por título, solicitante, produto, CA, link…"
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/50 outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Coluna</span>
          <select
            className="bg-transparent border-none text-sm focus:ring-0 outline-none font-medium text-slate-600 max-w-[160px]"
            value={columnFilter}
            onChange={(e) => setColumnFilter(e.target.value === 'Todos' ? 'Todos' : e.target.value)}
          >
            <option value="Todos">Todas</option>
            {sortedColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <Link
          href="/ca-consulta"
          className="flex items-center justify-center gap-2 bg-white text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-all font-medium text-sm"
        >
          Consulta CA
        </Link>
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
            {loading ? 'Carregando…' : `${filtered.length} no quadro`}
          </div>
          <div className="text-[10px] text-slate-500 font-bold text-right max-w-xl leading-relaxed">
            <span className="inline-block w-2 h-2 rounded-sm bg-[#fff8b0] border border-[#e6d25c] align-middle mr-1" />{' '}
            Amarelo = pedido com itens ·{' '}
            <span className="inline-block w-2 h-2 rounded-sm bg-[#d6f5ef] border border-[#5ec4b0] align-middle mx-0.5" />{' '}
            Verde-água = tarefa ·{' '}
            <span className="inline-block w-2 h-2 rounded-sm bg-[#fde8e8] border border-[#e8a0a0] align-middle mx-0.5" />{' '}
            Salmão = coluna cancelado · Arraste entre colunas · Editar em Pedidos
          </div>
        </div>

        <div className="overflow-x-auto">
          <div
            className="grid gap-4 p-4 min-w-[720px]"
            style={{
              gridTemplateColumns: `repeat(${Math.max(sortedColumns.length, 1)}, minmax(220px, 1fr))`,
            }}
          >
            {sortedColumns.map((col) => {
              const colOrders = byColumn.get(col.id) || [];
              const isDropTarget = dropTargetColumnId === col.id;
              return (
                <div
                  key={col.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropTargetColumnId(col.id);
                  }}
                  onDragLeave={() => setDropTargetColumnId((cur) => (cur === col.id ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTargetColumnId(null);
                    const id =
                      e.dataTransfer.getData('application/loggb-order-id') || e.dataTransfer.getData('text/plain');
                    if (!id) return;
                    void moveToColumn(id, col.id);
                  }}
                  className={`rounded-2xl p-3 flex flex-col min-h-[420px] border-2 transition-colors ${
                    isDropTarget
                      ? 'bg-slate-200/80 border-slate-500 ring-2 ring-slate-400/50'
                      : 'bg-slate-50 border-slate-200/90'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[11px] font-black text-slate-700 uppercase tracking-tight truncate pr-1">
                      {col.title}
                    </div>
                    <div className="text-[10px] font-bold text-slate-600 bg-slate-200/90 border border-slate-300 px-2 py-0.5 rounded-full shrink-0">
                      {colOrders.length}
                    </div>
                  </div>

                  {loading ? (
                    <div className="space-y-3">
                      {Array(3)
                        .fill(0)
                        .map((_, i) => (
                          <div
                            key={i}
                            className="aspect-square w-full max-w-[240px] mx-auto bg-slate-200/50 rounded-sm border-2 border-slate-200 animate-pulse"
                          />
                        ))}
                    </div>
                  ) : colOrders.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-slate-400 text-xs font-bold italic border border-dashed border-slate-300 rounded-xl py-8">
                      Solte aqui
                    </div>
                  ) : (
                    <div className="space-y-4 flex flex-col items-stretch">
                      {colOrders.map((o) => {
                        const prev = neighborColumn(o, -1);
                        const next = neighborColumn(o, 1);
                        const lineItems = itemsByOrderId.get(o.id) || [];
                        const itemCount = lineItems.length;
                        const qtyReq = lineItems.reduce((acc, it) => acc + (it.quantity_requested || 0), 0);
                        const qtyRec = lineItems.reduce((acc, it) => acc + (it.quantity_received || 0), 0);
                        const progress = qtyReq > 0 ? Math.min(100, Math.round((qtyRec / qtyReq) * 100)) : 0;
                        const lineTitle = lineItems[0]?.product_name?.trim() || '';
                        const displayTitle =
                          (o.title && o.title.trim()) ||
                          lineTitle ||
                          (itemCount ? `Pedido (${itemCount} itens)` : 'Tarefa');
                        const requesterName = employeeNameById.get(o.requester_employee_id) || '—';
                        const theme = postitThemeForCard(col, itemCount);
                        return (
                          <div
                            key={o.id}
                            draggable
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDropTargetColumnId(null);
                              const draggedId =
                                e.dataTransfer.getData('application/loggb-order-id') ||
                                e.dataTransfer.getData('text/plain');
                              if (!draggedId) return;
                              void moveToColumn(draggedId, col.id);
                            }}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/loggb-order-id', o.id);
                              e.dataTransfer.setData('text/plain', o.id);
                              e.dataTransfer.effectAllowed = 'move';
                              setDraggingOrderId(o.id);
                            }}
                            onDragEnd={() => {
                              setDraggingOrderId(null);
                              setDropTargetColumnId(null);
                            }}
                            className={`w-full max-w-[240px] mx-auto aspect-square rounded-sm border-2 p-2.5 flex flex-col ${theme.card} ${theme.text} transition-all ${
                              draggingOrderId === o.id
                                ? 'opacity-70 ring-2 ring-slate-600 scale-[0.97] rotate-1'
                                : 'hover:brightness-[1.02]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 shrink-0">
                              <div
                                className="text-slate-700/80 cursor-grab active:cursor-grabbing p-0.5"
                                title="Arrastar"
                              >
                                <GripVertical size={16} />
                              </div>
                              <button
                                type="button"
                                onClick={() => void deleteRequest(o.id)}
                                className="p-1.5 rounded-md text-slate-700/70 hover:bg-black/10 hover:text-red-700"
                                title="Excluir"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>

                            <div className="flex-1 min-h-0 flex flex-col pt-1">
                              <p className="text-[11px] font-black leading-snug line-clamp-5 break-words">
                                {displayTitle}
                              </p>
                              <p className="text-[9px] font-bold opacity-75 mt-1.5 truncate" title={requesterName}>
                                {requesterName}
                              </p>
                              <p className="text-[9px] font-bold opacity-70 mt-auto pt-2">
                                {itemCount > 0 ? `${qtyRec}/${qtyReq} · ${progress}%` : 'Sem itens'}
                              </p>
                            </div>

                            <div className="shrink-0 pt-2 mt-1 border-t border-black/10 space-y-1.5">
                              <Link
                                href={`/orders/${o.id}`}
                                className="block text-center text-[9px] font-black uppercase tracking-wide bg-black/10 hover:bg-black/15 rounded py-1.5"
                              >
                                Editar em Pedidos
                              </Link>
                              <div className="flex items-center gap-1">
                                <select
                                  className="flex-1 min-w-0 bg-white/50 border border-black/15 rounded px-1 py-1 text-[9px] font-bold outline-none"
                                  value={resolveColumnIdForOrder(o, sortedColumns) ?? ''}
                                  onChange={(e) => void moveToColumn(o.id, e.target.value)}
                                >
                                  {sortedColumns.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.title}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={!prev}
                                  onClick={() => prev && void moveToColumn(o.id, prev.id)}
                                  className="p-1 bg-white/50 border border-black/15 rounded text-slate-800 disabled:opacity-35"
                                  title="Coluna anterior"
                                >
                                  <ArrowLeft size={12} />
                                </button>
                                <button
                                  type="button"
                                  disabled={!next}
                                  onClick={() => next && void moveToColumn(o.id, next.id)}
                                  className="p-1 bg-white/50 border border-black/15 rounded text-slate-800 disabled:opacity-35"
                                  title="Próxima coluna"
                                >
                                  <ArrowRight size={12} />
                                </button>
                              </div>
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
        initialKanbanColumnId={defaultColumnIdForModals}
        onSaved={() => void fetchOrders()}
      />

      <KanbanBoardEditor
        isOpen={boardEditorOpen}
        columns={sortedColumns}
        onClose={() => setBoardEditorOpen(false)}
        onSaved={() => void fetchOrders()}
      />

      <QuickKanbanTaskModal
        isOpen={quickTaskOpen}
        onClose={() => setQuickTaskOpen(false)}
        columns={sortedColumns}
        employees={employees}
        defaultColumnId={defaultColumnIdForModals}
        onSaved={() => void fetchOrders()}
      />
    </div>
  );
}
