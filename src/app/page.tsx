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

    const { data: orderData, error: orderError } = await supabase
      .from('purchase_orders')
      .select('id, requester_employee_id, stage, title, kanban_column_id, notes, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (orderError) {
      console.error('Error fetching purchase orders:', orderError);
      setOrders([]);
      setItems([]);
      setEmployees([]);
      setLoading(false);
      return;
    }

    let orderList: PurchaseOrderRow[] = (orderData || []).map((r: unknown) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        requester_employee_id: String(row.requester_employee_id),
        stage: String(row.stage ?? ''),
        title: (row.title as string) ?? null,
        kanban_column_id: row.kanban_column_id ? String(row.kanban_column_id) : null,
        notes: (row.notes as string) ?? null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
      };
    });

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
      const { data: itemData, error: itemError } = await supabase
        .from('purchase_order_items')
        .select(
          'id, order_id, product_name, product_url, vendor, product_price, unit, quantity_requested, quantity_received, received_at, notes, ca_number, created_at, updated_at'
        )
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
            unit: String(row.unit ?? 'un'),
            quantity_requested: Number(row.quantity_requested ?? 0),
            quantity_received: Number(row.quantity_received || 0),
            received_at: (row.received_at as string) ?? null,
            notes: (row.notes as string) ?? null,
            ca_number: row.ca_number != null ? String(row.ca_number) : null,
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

  const patchOrder = async (
    id: string,
    patch: { notes?: string | null; requester_employee_id?: string; title?: string | null }
  ) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    const { error } = await supabase
      .from('purchase_orders')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) {
      alert(`Erro ao salvar: ${error.message}`);
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
            Colunas editáveis, tarefas rápidas e cartões arrastáveis. Configure o quadro ao lado.
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
          <div className="text-[10px] text-slate-400 font-bold">
            Arraste cartões, edite título e colunas em &quot;Editar quadro&quot;.
          </div>
        </div>

        <div className="overflow-x-auto">
          <div
            className="grid gap-4 p-4 min-w-[720px]"
            style={{
              gridTemplateColumns: `repeat(${Math.max(sortedColumns.length, 1)}, minmax(200px, 1fr))`,
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
                          <div key={i} className="h-28 bg-slate-200/50 rounded-xl border border-slate-200 animate-pulse" />
                        ))}
                    </div>
                  ) : colOrders.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-slate-400 text-xs font-bold italic border border-dashed border-slate-300 rounded-xl py-8">
                      Solte aqui
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {colOrders.map((o) => {
                        const prev = neighborColumn(o, -1);
                        const next = neighborColumn(o, 1);
                        const lineItems = itemsByOrderId.get(o.id) || [];
                        const itemCount = lineItems.length;
                        const qtyReq = lineItems.reduce((acc, it) => acc + (it.quantity_requested || 0), 0);
                        const qtyRec = lineItems.reduce((acc, it) => acc + (it.quantity_received || 0), 0);
                        const progress = qtyReq > 0 ? Math.min(100, Math.round((qtyRec / qtyReq) * 100)) : 0;
                        const displayTitle =
                          (o.title && o.title.trim()) ||
                          (itemCount ? `Pedido (${itemCount} itens)` : 'Tarefa (sem itens)');
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
                            className={`rounded-xl border border-slate-300 bg-slate-100 p-3 shadow-sm transition-all ${
                              draggingOrderId === o.id
                                ? 'opacity-60 ring-2 ring-slate-500 scale-[0.98]'
                                : 'hover:border-slate-400'
                            }`}
                          >
                            <div className="flex items-start gap-1.5">
                              <div
                                className="mt-0.5 text-slate-500 cursor-grab active:cursor-grabbing shrink-0 p-0.5"
                                title="Arrastar"
                              >
                                <GripVertical size={18} />
                              </div>
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wide block mb-0.5">
                                      Título
                                    </label>
                                    <input
                                      className="w-full bg-white/95 border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800"
                                      defaultValue={o.title ?? ''}
                                      placeholder={displayTitle}
                                      key={`t-${o.id}-${o.updated_at}`}
                                      onBlur={(e) => {
                                        const v = e.target.value.trim();
                                        const next = v || null;
                                        if (next !== (o.title ?? null)) void patchOrder(o.id, { title: next });
                                      }}
                                    />
                                    <div className="text-[11px] text-slate-600 font-medium mt-1">
                                      {itemCount > 0 ? `${qtyRec}/${qtyReq} recebidos · ${progress}%` : 'Sem linhas de item'}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void deleteRequest(o.id)}
                                    className="p-2 rounded-lg text-slate-500 hover:bg-slate-200/80 hover:text-red-600 shrink-0"
                                    title="Excluir"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>

                                <div>
                                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-wide block mb-0.5">
                                    Solicitante
                                  </label>
                                  <select
                                    className="w-full bg-white/95 border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-slate-400/40"
                                    value={o.requester_employee_id}
                                    onChange={(e) =>
                                      void patchOrder(o.id, { requester_employee_id: e.target.value })
                                    }
                                  >
                                    {employees.length === 0 ? (
                                      <option value={o.requester_employee_id}>—</option>
                                    ) : (
                                      <>
                                        {!employees.some((e) => e.id === o.requester_employee_id) ? (
                                          <option value={o.requester_employee_id}>Solicitante (fora da lista)</option>
                                        ) : null}
                                        {employees.map((emp) => (
                                          <option key={emp.id} value={emp.id}>
                                            {emp.full_name}
                                          </option>
                                        ))}
                                      </>
                                    )}
                                  </select>
                                </div>

                                <div>
                                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-wide block mb-0.5">
                                    Observações
                                  </label>
                                  <textarea
                                    defaultValue={o.notes ?? ''}
                                    rows={2}
                                    className="w-full resize-y min-h-[44px] bg-white/95 border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-slate-400/40 placeholder:text-slate-400"
                                    placeholder="Notas…"
                                    onBlur={(e) => {
                                      const v = e.target.value.trim();
                                      const next = v || null;
                                      if (next !== (o.notes ?? null)) void patchOrder(o.id, { notes: next });
                                    }}
                                  />
                                </div>

                                <div className="flex items-center justify-between gap-2 pt-0.5">
                                  <Link
                                    href={`/orders/${o.id}`}
                                    className="text-[10px] font-bold text-slate-600 hover:text-slate-900 underline underline-offset-2"
                                  >
                                    Abrir itens e detalhes
                                  </Link>
                                </div>

                                <div className="flex items-center gap-2 pt-1 border-t border-slate-300/60">
                                  <select
                                    className="flex-1 bg-white/95 border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-slate-400/40"
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
                                    className="p-2 bg-white/95 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                                    title="Coluna anterior"
                                  >
                                    <ArrowLeft size={16} />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!next}
                                    onClick={() => next && void moveToColumn(o.id, next.id)}
                                    className="p-2 bg-white/95 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                                    title="Próxima coluna"
                                  >
                                    <ArrowRight size={16} />
                                  </button>
                                </div>
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
