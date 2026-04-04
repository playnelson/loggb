'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { formatProductLabelDisplay } from '@/lib/productDisplayText';
import { ArrowLeft, Loader2, Search } from 'lucide-react';

type ReceivedRow = {
  id: string;
  received_at: string;
  quantity_received: number;
  quantity_requested: number;
  unit: string;
  product_name: string | null;
  product_url: string | null;
  vendor: string | null;
  product_price: string | null;
  order: {
    id: string;
    stage: string;
    notes: string | null;
    requester_employee_id: string;
  } | null;
  requester: { full_name: string } | { full_name: string }[] | null;
};

function toISOStart(date: string): string {
  return `${date}T00:00:00.000Z`;
}
function toISOEnd(date: string): string {
  return `${date}T23:59:59.999Z`;
}

export default function ReceivedReportPage() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReceivedRow[]>([]);

  const fetchReceived = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setRows([]);
      setLoading(false);
      return;
    }

    const { data: orderRows, error: orderErr } = await supabase
      .from('purchase_orders')
      .select('id')
      .eq('user_id', user.id);
    if (orderErr) {
      console.error('Error fetching orders for received report:', orderErr);
      setRows([]);
      setLoading(false);
      return;
    }
    const orderIds = (orderRows || []).map((r: { id: string }) => r.id);
    if (orderIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    const selectBlock = `
        id,
        received_at,
        quantity_received,
        quantity_requested,
        unit,
        product_name,
        product_url,
        vendor,
        product_price,
        purchase_orders:order_id (
          id,
          stage,
          notes,
          requester_employee_id,
          employees:requester_employee_id ( full_name )
        )
      `;

    const chunkSize = 80;
    const merged: unknown[] = [];
    for (let i = 0; i < orderIds.length; i += chunkSize) {
      const slice = orderIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select(selectBlock)
        .in('order_id', slice)
        .not('received_at', 'is', null)
        .gt('quantity_received', 0)
        .gte('received_at', toISOStart(from))
        .lte('received_at', toISOEnd(to));
      if (error) {
        console.error('Error fetching received:', error);
        setRows([]);
        setLoading(false);
        return;
      }
      merged.push(...(data || []));
    }

    merged.sort(
      (a: any, b: any) =>
        new Date(String(b.received_at)).getTime() - new Date(String(a.received_at)).getTime()
    );

    const list: ReceivedRow[] = merged.map((r: any) => ({
      id: String(r.id),
      received_at: String(r.received_at),
      quantity_received: Number(r.quantity_received ?? 0),
      quantity_requested: Number(r.quantity_requested ?? 0),
      unit: String(r.unit ?? 'un'),
      product_name: r.product_name ?? null,
      product_url: r.product_url ?? null,
      vendor: r.vendor ?? null,
      product_price: r.product_price ?? null,
      order: r.purchase_orders
        ? {
            id: String(r.purchase_orders.id),
            stage: String(r.purchase_orders.stage ?? ''),
            notes: r.purchase_orders.notes ?? null,
            requester_employee_id: String(r.purchase_orders.requester_employee_id ?? ''),
          }
        : null,
      requester: r.purchase_orders?.employees ?? null,
    }));
    setRows(list);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchReceived();
  }, [from, to]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const requesterName = Array.isArray(r.requester) ? r.requester[0]?.full_name : (r.requester as any)?.full_name;
      const blob = [
        r.product_name,
        r.vendor,
        r.product_url,
        r.product_price,
        r.unit,
        requesterName,
        r.order?.notes,
        r.order?.stage,
        r.order?.id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(s);
    });
  }, [rows, q]);

  const totalReceived = useMemo(() => filtered.reduce((acc, r) => acc + (r.quantity_received || 0), 0), [filtered]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-3">
        <Link href="/" className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-primary">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-primary">Recebidos</h1>
          <p className="text-slate-500 text-sm">Relatório de itens recebidos por período (quantidade e unidade).</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-border shadow-sm flex flex-col lg:flex-row gap-4">
        <div className="flex gap-3 flex-wrap">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase">De</label>
            <input
              type="date"
              className="p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-medium"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase">Até</label>
            <input
              type="date"
              className="p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-medium"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Buscar por produto, fornecedor, unidade, solicitante, observação..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/50 outline-none"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-center text-xs font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          {loading ? '…' : `${filtered.length} linhas • Total recebido: ${totalReceived}`}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Data</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Produto</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Solicitante</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Qtd.</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Un</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Pedido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <Loader2 className="animate-spin inline mr-2 text-secondary" size={20} />
                    Carregando recebidos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">Nenhum recebido no período.</td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const requesterName = Array.isArray(r.requester) ? r.requester[0]?.full_name : (r.requester as any)?.full_name;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-sm text-slate-600 font-mono">
                        {new Date(r.received_at).toLocaleString('pt-BR')}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-primary text-sm">
                          {r.product_name ? (
                            formatProductLabelDisplay(r.product_name)
                          ) : (
                            <span className="text-slate-300 italic font-medium">Sem nome</span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-bold">
                          {r.vendor || '—'} {r.product_price ? `• ${r.product_price}` : ''}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-medium">{requesterName || '—'}</td>
                      <td className="px-6 py-4 text-sm font-black text-primary">{r.quantity_received}</td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-500">{r.unit}</td>
                      <td className="px-6 py-4">
                        {r.order?.id ? (
                          <Link
                            href={`/orders/${r.order.id}`}
                            className="text-secondary text-xs font-bold hover:underline"
                            title={r.order.notes || ''}
                          >
                            Abrir pedido
                          </Link>
                        ) : (
                          '—'
                        )}
                        {r.order?.notes && (
                          <div className="text-[10px] text-slate-400 font-bold truncate max-w-[260px]">
                            {r.order.notes}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

