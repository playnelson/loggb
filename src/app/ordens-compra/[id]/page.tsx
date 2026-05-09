'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ORDENS_COMPRA_DEV_LOCAL, devLocalOrdersRead, devLocalOrdersWrite } from '@/lib/ordensCompraDevLocal';
import {
  ArrowLeft,
  ClipboardList,
  Loader2,
  Package,
  Phone,
  Store,
  Truck,
  User,
  CheckSquare,
  Square,
} from 'lucide-react';

interface PoHeader {
  id: string;
  oc_number: string | null;
  title: string | null;
  buyer_code: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  vendor_name: string | null;
  vendor_phone: string | null;
  vendor_contact_name: string | null;
  delivery_deadline: string | null;
  source_filename: string | null;
  created_at: string;
}

interface PoItem {
  id: string;
  line_number: number;
  description: string;
  quantity: number | null;
  unit: string;
  delivered: boolean;
  delivered_at: string | null;
}

function formatDateBR(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function OrdemCompraDetailPage() {
  const params = useParams();
  const id = String(params.id || '');

  const [header, setHeader] = useState<PoHeader | null>(null);
  const [items, setItems] = useState<PoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);

    if (ORDENS_COMPRA_DEV_LOCAL && typeof window !== 'undefined') {
      const list = devLocalOrdersRead();
      const po = list.find((o) => o.id === id);
      if (!po) {
        setError('Ordem não encontrada (modo local).');
        setHeader(null);
        setItems([]);
        setLoading(false);
        return;
      }
      setHeader({
        id: po.id,
        oc_number: po.oc_number,
        title: po.title,
        buyer_code: po.buyer_code,
        buyer_name: po.buyer_name,
        buyer_phone: po.buyer_phone,
        vendor_name: po.vendor_name,
        vendor_phone: po.vendor_phone,
        vendor_contact_name: po.vendor_contact_name,
        delivery_deadline: po.delivery_deadline,
        source_filename: po.source_filename,
        created_at: po.created_at,
      });
      setItems(
        po.items.map((i) => ({
          id: i.id,
          line_number: i.line_number,
          description: i.description,
          quantity: i.quantity,
          unit: i.unit,
          delivered: i.delivered,
          delivered_at: i.delivered_at,
        }))
      );
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setHeader(null);
      setItems([]);
      setLoading(false);
      return;
    }

    const { data: po, error: e1 } = await supabase
      .from('purchase_orders')
      .select(
        'id, oc_number, title, buyer_code, buyer_name, buyer_phone, vendor_name, vendor_phone, vendor_contact_name, delivery_deadline, source_filename, created_at'
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (e1 || !po) {
      setError('Ordem não encontrada ou sem permissão.');
      setHeader(null);
      setItems([]);
      setLoading(false);
      return;
    }

    setHeader(po as PoHeader);

    const { data: lines, error: e2 } = await supabase
      .from('purchase_order_items')
      .select('id, line_number, description, quantity, unit, delivered, delivered_at')
      .eq('purchase_order_id', id)
      .order('line_number', { ascending: true });

    if (e2) {
      setError('Erro ao carregar itens.');
      setItems([]);
    } else {
      setItems((lines as PoItem[]) || []);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleDelivered = async (item: PoItem) => {
    const next = !item.delivered;
    setBusyId(item.id);

    if (ORDENS_COMPRA_DEV_LOCAL && typeof window !== 'undefined') {
      const list = devLocalOrdersRead();
      const po = list.find((o) => o.id === id);
      if (!po) {
        setBusyId(null);
        return;
      }
      const line = po.items.find((i) => i.id === item.id);
      if (line) {
        line.delivered = next;
        line.delivered_at = next ? new Date().toISOString() : null;
        devLocalOrdersWrite(list);
      }
      setBusyId(null);
      setItems((prev) =>
        prev.map((r) =>
          r.id === item.id
            ? { ...r, delivered: next, delivered_at: next ? new Date().toISOString() : null }
            : r
        )
      );
      return;
    }

    const { error: e } = await supabase
      .from('purchase_order_items')
      .update({
        delivered: next,
        delivered_at: next ? new Date().toISOString() : null,
      })
      .eq('id', item.id);

    setBusyId(null);
    if (e) {
      alert(`Erro ao atualizar: ${e.message}`);
      return;
    }
    setItems((prev) =>
      prev.map((r) =>
        r.id === item.id
          ? { ...r, delivered: next, delivered_at: next ? new Date().toISOString() : null }
          : r
      )
    );
  };

  const doneCount = items.filter((i) => i.delivered).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Link
          href="/ordens-compra"
          className="inline-flex items-center gap-2 text-sm font-bold text-secondary hover:underline w-fit"
        >
          <ArrowLeft size={18} />
          Voltar às ordens
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-slate-400">
          <Loader2 className="animate-spin" size={32} />
        </div>
      ) : error ? (
        <div className="p-6 rounded-xl bg-red-50 border border-red-100 text-red-800 font-medium">{error}</div>
      ) : header ? (
        <>
          {ORDENS_COMPRA_DEV_LOCAL && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-950">
              Modo local: dados só no navegador; sem sincronizar com o Supabase.
            </div>
          )}
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold text-primary flex items-center gap-2 flex-wrap">
              <ClipboardList className="text-secondary shrink-0" />
              <span>OC {header.oc_number || '—'}</span>
            </h1>
            <p className="text-slate-600 text-sm font-medium break-all">
              {header.title || 'Ordem de compra'}
            </p>
            {header.vendor_name && (
              <p className="text-slate-500 text-xs">Fornecedor: {header.vendor_name}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-border p-4 space-y-2">
              <div className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                <User size={12} /> Comprador
              </div>
              <div className="text-sm font-bold text-primary">
                {[header.buyer_code, header.buyer_name].filter(Boolean).join(' · ') || '—'}
              </div>
              {header.buyer_phone && (
                <div className="text-xs text-slate-600 flex items-center gap-1">
                  <Phone size={12} />
                  {header.buyer_phone}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-border p-4 space-y-2">
              <div className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                <Store size={12} /> Fornecedor e vendedor
              </div>
              <div className="text-sm font-bold text-primary">{header.vendor_name || '—'}</div>
              {header.vendor_contact_name && (
                <div className="text-xs text-slate-600">Vendedor: {header.vendor_contact_name}</div>
              )}
              {header.vendor_phone && (
                <div className="text-xs text-slate-600 flex items-center gap-1">
                  <Phone size={12} />
                  {header.vendor_phone}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-border p-4 space-y-2 sm:col-span-2">
              <div className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                <Truck size={12} /> Entrega
              </div>
              <div className="text-sm">
                <span className="text-slate-400 text-xs font-bold uppercase">Data de entrega</span>
                <div className="font-medium text-primary">{formatDateBR(header.delivery_deadline)}</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2">
                <Package size={18} className="text-secondary" />
                <h2 className="font-bold text-primary">Itens e entregas</h2>
              </div>
              <span className="text-xs font-bold text-slate-500">
                {doneCount}/{items.length} recebidos
              </span>
            </div>

            {items.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">Nenhum item nesta ordem.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className={`px-4 py-3 flex gap-3 items-start ${
                      it.delivered ? 'bg-emerald-50/40' : ''
                    }`}
                  >
                    <button
                      type="button"
                      disabled={busyId === it.id}
                      onClick={() => void toggleDelivered(it)}
                      className="mt-0.5 p-1 rounded-lg text-secondary hover:bg-secondary/10 disabled:opacity-50"
                      title={it.delivered ? 'Marcar como pendente' : 'Marcar como entregue'}
                    >
                      {busyId === it.id ? (
                        <Loader2 className="animate-spin" size={22} />
                      ) : it.delivered ? (
                        <CheckSquare size={22} />
                      ) : (
                        <Square size={22} />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-xs font-black text-slate-400 w-6">{it.line_number}</span>
                        <span
                          className={`text-sm font-medium ${
                            it.delivered ? 'text-slate-500 line-through' : 'text-primary'
                          }`}
                        >
                          {it.description}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {it.quantity != null ? `${it.quantity} ${it.unit}` : `— ${it.unit}`}
                        {it.delivered && it.delivered_at && (
                          <span className="ml-2 text-emerald-700 font-bold">
                            · Recebido em {new Date(it.delivered_at).toLocaleString('pt-BR')}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
