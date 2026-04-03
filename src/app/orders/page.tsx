'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Search, Loader2, Trash2, ExternalLink, Download, FileUp, Sheet } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { EmployeeLite, PurchaseOrderItemRow, PurchaseOrderRow } from '@/lib/purchaseOrders';
import { PurchaseOrderFormModal } from '@/components/PurchaseOrderFormModal';
import { PurchaseOrderImportModal, downloadOrdersTemplate } from '@/components/PurchaseOrderImportModal';
import { downloadOrdersSpreadsheet } from '@/lib/ordersExport';
import {
  ensureKanbanColumnsSeeded,
  resolveColumnIdForOrder,
  type KanbanColumnRow,
} from '@/lib/kanbanColumns';

function OrdersContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState<KanbanColumnRow[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [items, setItems] = useState<PurchaseOrderItemRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [columnFilter, setColumnFilter] = useState<'Todos' | string>('Todos');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.sort_order - b.sort_order),
    [columns]
  );

  const fetchOrders = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setOrders([]);
      setItems([]);
      setEmployees([]);
      setColumns([]);
      setLoading(false);
      return;
    }

    const seeded = await ensureKanbanColumnsSeeded(supabase, user.id);
    setColumns(seeded.columns);

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

    const orderList: PurchaseOrderRow[] = (orderData || []).map((r: unknown) => {
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
        console.error('Error fetching order items:', itemError);
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
            quantity_received: Number(row.quantity_received ?? 0),
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
  };

  useEffect(() => {
    void fetchOrders();
  }, []);

  useEffect(() => {
    const onFocus = () => void fetchOrders();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchOrders();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    setSearch(searchParams.get('q') || '');
  }, [searchParams]);

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

  const updateOrderColumn = async (id: string, columnId: string) => {
    const col = sortedColumns.find((c) => c.id === columnId);
    if (!col) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, kanban_column_id: columnId, stage: col.title } : o))
    );
    const { error } = await supabase
      .from('purchase_orders')
      .update({
        kanban_column_id: columnId,
        stage: col.title,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) {
      alert(`Erro ao atualizar coluna: ${error.message}`);
      void fetchOrders();
    }
  };

  const deleteOrder = async (id: string) => {
    if (!confirm('Excluir este pedido? (Não apaga itens do almoxarifado)')) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('purchase_orders').delete().eq('id', id).eq('user_id', user.id);
    if (error) alert(`Erro ao excluir: ${error.message}`);
    else {
      setOrders((prev) => prev.filter((o) => o.id !== id));
      setItems((prev) => prev.filter((it) => it.order_id !== id));
    }
  };

  const defaultCol = sortedColumns[0]?.id ?? '';

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">Pedidos</h1>
          <p className="text-slate-500 text-sm">Lista alinhada às colunas do quadro; use o dashboard para editar o quadro.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/ca-consulta"
            className="flex items-center gap-2 bg-white text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 font-medium text-sm"
          >
            Consulta CA
          </Link>
          <button
            type="button"
            onClick={downloadOrdersTemplate}
            className="flex items-center gap-2 bg-white text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-all font-medium text-sm"
            title="Baixar planilha modelo"
          >
            <Download size={16} />
            Modelo
          </button>
          <button
            type="button"
            onClick={() =>
              downloadOrdersSpreadsheet({
                orders: filtered,
                items,
                employees,
                title: 'Pedidos (lista filtrada)',
              })
            }
            className="flex items-center gap-2 bg-white text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-all font-medium text-sm"
            title="Baixar pedidos em planilha (.xlsx)"
          >
            <Sheet size={16} />
            Baixar
          </button>
          <button
            type="button"
            onClick={() => setIsImportOpen(true)}
            className="flex items-center gap-2 bg-slate-100 text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-200 transition-all font-medium text-sm"
            title="Importar planilha e criar pedido"
          >
            <FileUp size={16} className="text-secondary" />
            Importar
          </button>
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
            placeholder="Buscar por título, solicitante, produto, CA, link…"
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/50 outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Coluna</span>
          <select
            className="bg-transparent border-none text-sm focus:ring-0 outline-none font-medium text-slate-600 max-w-[180px]"
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
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Produto</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Solicitante</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Fornecedor</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Preço</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Coluna</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <Loader2 className="animate-spin inline mr-2 text-secondary" size={20} />
                    Carregando pedidos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    Nenhum pedido encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((o) => {
                  const lineItems = itemsByOrderId.get(o.id) || [];
                  const itemCount = lineItems.length;
                  const qtyReq = lineItems.reduce((acc, it) => acc + (it.quantity_requested || 0), 0);
                  const qtyRec = lineItems.reduce((acc, it) => acc + (it.quantity_received || 0), 0);
                  const requesterName = employeeNameById.get(o.requester_employee_id) || '—';
                  const lineTitle = lineItems[0]?.product_name || '';
                  const title =
                    (o.title && o.title.trim()) ||
                    lineTitle ||
                    (itemCount ? `Pedido (${itemCount} itens)` : 'Tarefa');
                  return (
                    <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-bold text-primary text-sm">{title}</div>
                        <div className="text-[10px] text-slate-400 font-bold mt-1">
                          {itemCount} itens • {qtyRec}/{qtyReq} recebidos
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-medium">{requesterName}</td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-medium">{lineItems[0]?.vendor || '—'}</td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-mono">{lineItems[0]?.product_price || '—'}</td>
                      <td className="px-6 py-4">
                        <select
                          className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 outline-none max-w-[140px]"
                          value={resolveColumnIdForOrder(o, sortedColumns) ?? ''}
                          onChange={(e) => void updateOrderColumn(o.id, e.target.value)}
                        >
                          {sortedColumns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/orders/${o.id}`}
                          className="inline-flex items-center gap-2 mr-2 text-primary bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-50"
                          title="Abrir pedido"
                        >
                          <ExternalLink size={14} />
                          Abrir
                        </Link>
                        <button
                          type="button"
                          onClick={() => deleteOrder(o.id)}
                          className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-500"
                          title="Excluir pedido"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PurchaseOrderFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialKanbanColumnId={defaultCol}
        onSaved={() => void fetchOrders()}
      />

      <PurchaseOrderImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSaved={() => void fetchOrders()}
      />
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Carregando pedidos...</div>}>
      <OrdersContent />
    </Suspense>
  );
}
