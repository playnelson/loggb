'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ORDENS_COMPRA_DEV_LOCAL, devLocalOrdersRead, devLocalOrdersWrite } from '@/lib/ordensCompraDevLocal';
import {
  AlertCircle,
  ArrowLeft,
  ClipboardList,
  Loader2,
  Pencil,
  Package,
  Phone,
  Plus,
  Save,
  Store,
  Trash2,
  Truck,
  User,
  CheckSquare,
  Square,
  X,
} from 'lucide-react';

interface PoHeader {
  id: string;
  oc_number: string | null;
  title: string | null;
  buyer_code: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  comprador_line: string | null;
  vendor_name: string | null;
  vendor_contact_line: string | null;
  delivery_deadline: string | null;
  source_filename: string | null;
  created_at: string;
}

function buyerFromNotes(notes: string | null | undefined): {
  code: string | null;
  name: string | null;
  phone: string | null;
  line: string | null;
} {
  const t = (notes || '').trim();
  if (!t) return { code: null, name: null, phone: null, line: null };
  const cleaned = t.replace(/^Comprador:\s*/i, '').trim();
  if (!cleaned) return { code: null, name: null, phone: null, line: null };
  const parts = cleaned.split('·').map((p) => p.trim()).filter(Boolean);
  const code = parts[0] || null;
  const name = parts[1] || null;
  const phone = parts[2] || null;
  return { code, name, phone, line: cleaned };
}

interface PoItem {
  id: string;
  line_number: number;
  description: string;
  quantity: number | null;
  unit: string;
  received_quantity: number | null;
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
  const [bulkBusy, setBulkBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [draftHeader, setDraftHeader] = useState<{
    oc_number: string;
    title: string;
    vendor_name: string;
    vendor_contact_line: string;
    delivery_deadline: string;
  }>({
    oc_number: '',
    title: '',
    vendor_name: '',
    vendor_contact_line: '',
    delivery_deadline: '',
  });
  const [draftItems, setDraftItems] = useState<PoItem[]>([]);

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
      const legacyPhone = (po as { vendor_phone?: string | null }).vendor_phone;
      setHeader({
        id: po.id,
        oc_number: po.oc_number,
        title: po.title,
        buyer_code: po.buyer_code,
        buyer_name: po.buyer_name,
        buyer_phone: po.buyer_phone,
        comprador_line:
          [po.buyer_code, po.buyer_name, po.buyer_phone].filter(Boolean).join(' · ') || null,
        vendor_name: po.vendor_name,
        vendor_contact_line:
          [po.vendor_contact_name, legacyPhone].filter(Boolean).join(' · ') || null,
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
          received_quantity:
            (i as { received_quantity?: number | null }).received_quantity ??
            (i.delivered ? i.quantity ?? 0 : 0),
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
        'id, oc_number, title, vendor_name, vendor_contact_name, delivery_deadline, source_filename, notes, created_at'
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

    const row = po as Record<string, unknown>;
    const buyerFromLegacyNotes = buyerFromNotes((row.notes as string | null) ?? null);
    setHeader({
      id: String(row.id),
      oc_number: (row.oc_number as string | null) ?? null,
      title: (row.title as string | null) ?? null,
      buyer_code: buyerFromLegacyNotes.code,
      buyer_name: buyerFromLegacyNotes.name,
      buyer_phone: buyerFromLegacyNotes.phone,
      comprador_line: buyerFromLegacyNotes.line,
      vendor_name: (row.vendor_name as string | null) ?? null,
      vendor_contact_line: (row.vendor_contact_name as string | null) ?? null,
      delivery_deadline: (row.delivery_deadline as string | null) ?? null,
      source_filename: (row.source_filename as string | null) ?? null,
      created_at: String(row.created_at ?? ''),
    });

    const withReceived = await supabase
      .from('purchase_order_items')
      .select('id, line_number, description, quantity, unit, received_quantity, delivered, delivered_at')
      .eq('purchase_order_id', id)
      .order('line_number', { ascending: true });

    let lines = withReceived.data as Record<string, unknown>[] | null;
    let e2 = withReceived.error;
    const receivedMissing =
      !!e2 &&
      /received_quantity/i.test(
        `${e2.message || ''} ${e2.details || ''} ${e2.hint || ''}`
      );

    if (receivedMissing) {
      const fallback = await supabase
        .from('purchase_order_items')
        .select('id, line_number, description, quantity, unit, delivered, delivered_at')
        .eq('purchase_order_id', id)
        .order('line_number', { ascending: true });
      lines = fallback.data as Record<string, unknown>[] | null;
      e2 = fallback.error;
    }

    if (e2) {
      setError('Erro ao carregar itens.');
      setItems([]);
    } else {
      setItems(
        (lines || []).map((r) => {
          const qty = (r.quantity as number | null) ?? null;
          const delivered = Boolean(r.delivered);
          const receivedRaw = (r.received_quantity as number | null | undefined) ?? null;
          return {
            id: String(r.id),
            line_number: Number(r.line_number || 0),
            description: String(r.description || ''),
            quantity: qty,
            unit: String(r.unit || 'un'),
            received_quantity:
              receivedRaw != null ? receivedRaw : delivered ? qty ?? 0 : 0,
            delivered,
            delivered_at: (r.delivered_at as string | null) ?? null,
          };
        })
      );
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleDelivered = async (item: PoItem) => {
    const next = !item.delivered;
    setBusyId(item.id);
    const nowIso = new Date().toISOString();
    const fullQty = item.quantity ?? 0;

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
        line.delivered_at = next ? nowIso : null;
        (line as { received_quantity?: number | null }).received_quantity = next ? fullQty : 0;
        devLocalOrdersWrite(list);
      }
      setBusyId(null);
      setItems((prev) =>
        prev.map((r) =>
          r.id === item.id
            ? {
                ...r,
                delivered: next,
                delivered_at: next ? nowIso : null,
                received_quantity: next ? fullQty : 0,
              }
            : r
        )
      );
      return;
    }

    const withReceived = await supabase
      .from('purchase_order_items')
      .update({
        delivered: next,
        delivered_at: next ? nowIso : null,
        received_quantity: next ? fullQty : 0,
      })
      .eq('id', item.id);

    let e = withReceived.error;
    const receivedMissing =
      !!e && /received_quantity/i.test(`${e.message || ''} ${e.details || ''} ${e.hint || ''}`);
    if (receivedMissing) {
      const fallback = await supabase
        .from('purchase_order_items')
        .update({
          delivered: next,
          delivered_at: next ? nowIso : null,
        })
        .eq('id', item.id);
      e = fallback.error;
    }

    setBusyId(null);
    if (e) {
      alert(`Erro ao atualizar: ${e.message}`);
      return;
    }
    setItems((prev) =>
      prev.map((r) =>
        r.id === item.id
          ? {
              ...r,
              delivered: next,
              delivered_at: next ? nowIso : null,
              received_quantity: next ? fullQty : 0,
            }
          : r
      )
    );
  };

  const promptPartialReceipt = async (item: PoItem) => {
    const current = item.received_quantity ?? 0;
    const raw = window.prompt(
      `Quantidade recebida para item ${item.line_number}:`,
      String(current)
    );
    if (raw == null) return;
    const parsed = Number(raw.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) {
      alert('Informe uma quantidade válida.');
      return;
    }
    const requested = item.quantity ?? parsed;
    const received = Math.max(0, Math.min(parsed, requested));
    const full = received >= requested;
    const nowIso = new Date().toISOString();

    if (ORDENS_COMPRA_DEV_LOCAL && typeof window !== 'undefined') {
      const list = devLocalOrdersRead();
      const po = list.find((o) => o.id === id);
      const line = po?.items.find((i) => i.id === item.id);
      if (line) {
        (line as { received_quantity?: number | null }).received_quantity = received;
        line.delivered = full;
        line.delivered_at = full ? nowIso : null;
        devLocalOrdersWrite(list);
      }
      setItems((prev) =>
        prev.map((r) =>
          r.id === item.id
            ? {
                ...r,
                received_quantity: received,
                delivered: full,
                delivered_at: full ? nowIso : null,
              }
            : r
        )
      );
      return;
    }

    const withReceived = await supabase
      .from('purchase_order_items')
      .update({
        received_quantity: received,
        delivered: full,
        delivered_at: full ? nowIso : null,
      })
      .eq('id', item.id);

    if (withReceived.error) {
      const rawErr = `${withReceived.error.message || ''} ${withReceived.error.details || ''} ${withReceived.error.hint || ''}`;
      if (/received_quantity/i.test(rawErr)) {
        alert(
          'Seu banco ainda não tem a coluna received_quantity para recebimento parcial. Posso te passar o SQL para habilitar.'
        );
        return;
      }
      alert(`Erro ao salvar recebimento parcial: ${withReceived.error.message}`);
      return;
    }

    setItems((prev) =>
      prev.map((r) =>
        r.id === item.id
          ? {
              ...r,
              received_quantity: received,
              delivered: full,
              delivered_at: full ? nowIso : null,
            }
          : r
      )
    );
  };

  const markAllAsDelivered = async () => {
    if (!items.length) return;
    if (items.every((i) => i.delivered)) return;

    setBulkBusy(true);
    const nowIso = new Date().toISOString();

    if (ORDENS_COMPRA_DEV_LOCAL && typeof window !== 'undefined') {
      const list = devLocalOrdersRead();
      const po = list.find((o) => o.id === id);
      if (!po) {
        setBulkBusy(false);
        return;
      }
      for (const line of po.items) {
        line.delivered = true;
        line.delivered_at = nowIso;
        (line as { received_quantity?: number | null }).received_quantity = line.quantity ?? 0;
      }
      devLocalOrdersWrite(list);
      setItems((prev) =>
        prev.map((r) => ({
          ...r,
          delivered: true,
          delivered_at: nowIso,
          received_quantity: r.quantity ?? 0,
        }))
      );
      setBulkBusy(false);
      return;
    }

    let e: { message?: string; details?: string; hint?: string } | null = null;
    for (const r of items.filter((x) => !x.delivered)) {
      const one = await supabase
        .from('purchase_order_items')
        .update({
          delivered: true,
          delivered_at: nowIso,
          received_quantity: r.quantity ?? 0,
        })
        .eq('id', r.id);
      if (one.error) {
        e = one.error;
        const rawErr = `${one.error.message || ''} ${one.error.details || ''} ${one.error.hint || ''}`;
        if (/received_quantity/i.test(rawErr)) {
          const fallback = await supabase
            .from('purchase_order_items')
            .update({
              delivered: true,
              delivered_at: nowIso,
            })
            .eq('id', r.id);
          if (fallback.error) e = fallback.error;
        }
      }
      if (e) break;
    }

    setBulkBusy(false);
    if (e) {
      alert(`Erro ao marcar todos: ${e.message}`);
      return;
    }

    setItems((prev) =>
      prev.map((r) => ({
        ...r,
        delivered: true,
        delivered_at: r.delivered_at || nowIso,
        received_quantity: r.quantity ?? 0,
      }))
    );
  };

  const startEdit = () => {
    if (!header) return;
    setDraftHeader({
      oc_number: header.oc_number || '',
      title: header.title || '',
      vendor_name: header.vendor_name || '',
      vendor_contact_line: header.vendor_contact_line || '',
      delivery_deadline: header.delivery_deadline || '',
    });
    setDraftItems(items.map((it) => ({ ...it })));
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraftItems([]);
    setDraftHeader({
      oc_number: '',
      title: '',
      vendor_name: '',
      vendor_contact_line: '',
      delivery_deadline: '',
    });
  };

  const updateDraftItem = (idx: number, patch: Partial<PoItem>) => {
    setDraftItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const addDraftItem = () => {
    setDraftItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        line_number: prev.length + 1,
        description: '',
        quantity: null,
        unit: 'un',
        received_quantity: 0,
        delivered: false,
        delivered_at: null,
      },
    ]);
  };

  const removeDraftItem = (idx: number) => {
    setDraftItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveEdit = async () => {
    if (!header) return;
    setSavingEdit(true);
    setError(null);
    try {
      const normalizedItems = draftItems
        .map((it, idx) => ({
          ...it,
          line_number: idx + 1,
          description: (it.description || '').trim(),
          unit: (it.unit || 'un').trim().slice(0, 10) || 'un',
        }))
        .filter((it) => it.description.length > 0);

      if (ORDENS_COMPRA_DEV_LOCAL && typeof window !== 'undefined') {
        const list = devLocalOrdersRead();
        const po = list.find((o) => o.id === id);
        if (!po) {
          throw new Error('Ordem não encontrada (modo local).');
        }
        po.oc_number = draftHeader.oc_number.trim() || null;
        po.title = draftHeader.title.trim() || null;
        po.vendor_name = draftHeader.vendor_name.trim() || null;
        po.vendor_contact_name = draftHeader.vendor_contact_line.trim() || null;
        po.delivery_deadline = draftHeader.delivery_deadline || null;
        po.items = normalizedItems.map((it) => ({
          id: it.id || crypto.randomUUID(),
          line_number: it.line_number,
          description: it.description,
          quantity: it.quantity,
          unit: it.unit || 'un',
          received_quantity: it.received_quantity ?? 0,
          delivered: it.delivered,
          delivered_at: it.delivered_at,
        }));
        devLocalOrdersWrite(list);

        setHeader((h) =>
          h
            ? {
                ...h,
                oc_number: po.oc_number,
                title: po.title,
                vendor_name: po.vendor_name,
                vendor_contact_line: po.vendor_contact_name,
                delivery_deadline: po.delivery_deadline,
              }
            : h
        );
        setItems(
          po.items.map((it) => ({
            id: it.id,
            line_number: it.line_number,
            description: it.description,
            quantity: it.quantity,
            unit: it.unit,
            received_quantity: (it as { received_quantity?: number | null }).received_quantity ?? 0,
            delivered: it.delivered,
            delivered_at: it.delivered_at,
          }))
        );
        cancelEdit();
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Sessão expirada.');

      const { error: upErr } = await supabase
        .from('purchase_orders')
        .update({
          oc_number: draftHeader.oc_number.trim() || null,
          title: draftHeader.title.trim() || null,
          vendor_name: draftHeader.vendor_name.trim() || null,
          vendor_contact_name: draftHeader.vendor_contact_line.trim() || null,
          delivery_deadline: draftHeader.delivery_deadline || null,
        })
        .eq('id', id)
        .eq('user_id', auth.user.id);
      if (upErr) throw upErr;

      const { error: delErr } = await supabase
        .from('purchase_order_items')
        .delete()
        .eq('purchase_order_id', id);
      if (delErr) throw delErr;

      if (normalizedItems.length > 0) {
        const payload = normalizedItems.map((it) => ({
          purchase_order_id: id,
          line_number: it.line_number,
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          received_quantity: it.received_quantity ?? 0,
          delivered: it.delivered,
          delivered_at: it.delivered ? it.delivered_at || new Date().toISOString() : null,
        }));
        const { error: insErr } = await supabase.from('purchase_order_items').insert(payload);
        if (insErr) throw insErr;
      }

      setHeader((h) =>
        h
          ? {
              ...h,
              oc_number: draftHeader.oc_number.trim() || null,
              title: draftHeader.title.trim() || null,
              vendor_name: draftHeader.vendor_name.trim() || null,
              vendor_contact_line: draftHeader.vendor_contact_line.trim() || null,
              delivery_deadline: draftHeader.delivery_deadline || null,
            }
          : h
      );
      setItems(normalizedItems);
      cancelEdit();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao salvar alterações da OC.';
      setError(msg);
    } finally {
      setSavingEdit(false);
    }
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
        {header && !editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <Pencil size={16} />
            Editar OC
          </button>
        )}
        {header && editing && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={savingEdit}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <X size={16} />
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={savingEdit}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-white text-sm font-bold hover:opacity-90 disabled:opacity-50"
            >
              {savingEdit ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Salvar alterações
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950">
        <div className="flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <p>
            <strong>Recurso em construção:</strong> o módulo de ordens de compra ainda está em evolução e pode sofrer ajustes.
          </p>
        </div>
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
              <span>OC {!editing ? header.oc_number || '—' : draftHeader.oc_number || '—'}</span>
            </h1>
            {editing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium"
                  value={draftHeader.oc_number}
                  placeholder="Nº da OC"
                  onChange={(e) => setDraftHeader((d) => ({ ...d, oc_number: e.target.value }))}
                />
                <input
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium"
                  value={draftHeader.title}
                  placeholder="Título"
                  onChange={(e) => setDraftHeader((d) => ({ ...d, title: e.target.value }))}
                />
              </div>
            ) : (
              <p className="text-slate-600 text-sm font-medium break-all">
                {header.title || 'Ordem de compra'}
              </p>
            )}
            {header.vendor_name && (
              <p className="text-slate-500 text-xs">Fornecedor: {header.vendor_name}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-border p-4 space-y-2">
              <div className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                <User size={12} /> Comprador
              </div>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-slate-400 text-[11px] font-bold uppercase">Codigo</span>
                  <div className="font-bold text-primary">{header.buyer_code || '—'}</div>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px] font-bold uppercase">Nome</span>
                  <div className="font-medium text-primary">{header.buyer_name || '—'}</div>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px] font-bold uppercase">Contato</span>
                  <div className="font-medium text-primary">{header.buyer_phone || '—'}</div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-border p-4 space-y-2">
              <div className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                <Store size={12} /> Fornecedor
              </div>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-slate-400 text-[11px] font-bold uppercase">Nome</span>
                  {editing ? (
                    <input
                      className="mt-1 w-full px-2 py-1 rounded border border-slate-200 text-sm font-bold text-primary"
                      value={draftHeader.vendor_name}
                      onChange={(e) =>
                        setDraftHeader((d) => ({ ...d, vendor_name: e.target.value }))
                      }
                    />
                  ) : (
                    <div className="font-bold text-primary">{header.vendor_name || '—'}</div>
                  )}
                </div>
                <div>
                  <span className="text-slate-400 text-[11px] font-bold uppercase">Vendedor/contato</span>
                  {editing ? (
                    <input
                      className="mt-1 w-full px-2 py-1 rounded border border-slate-200 text-sm font-medium text-primary"
                      value={draftHeader.vendor_contact_line}
                      onChange={(e) =>
                        setDraftHeader((d) => ({ ...d, vendor_contact_line: e.target.value }))
                      }
                    />
                  ) : (
                    <div className="font-medium text-primary flex items-start gap-1">
                      <Phone size={12} className="shrink-0 mt-1 text-slate-500" />
                      <span>{header.vendor_contact_line || '—'}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-border p-4 space-y-2 sm:col-span-2">
              <div className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                <Truck size={12} /> Entrega
              </div>
              <div className="text-sm">
                <span className="text-slate-400 text-xs font-bold uppercase">Data de entrega</span>
                {editing ? (
                  <input
                    type="date"
                    className="mt-1 w-full px-2 py-1 rounded border border-slate-200 text-sm font-medium text-primary"
                    value={draftHeader.delivery_deadline}
                    onChange={(e) =>
                      setDraftHeader((d) => ({ ...d, delivery_deadline: e.target.value }))
                    }
                  />
                ) : (
                  <div className="font-medium text-primary">{formatDateBR(header.delivery_deadline)}</div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2">
                <Package size={18} className="text-secondary" />
                <h2 className="font-bold text-primary">Itens e entregas</h2>
              </div>
              {!editing ? (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void markAllAsDelivered()}
                    disabled={bulkBusy || items.length === 0 || doneCount === items.length}
                    className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {bulkBusy ? 'Marcando...' : 'Marcar todos como recebidos'}
                  </button>
                  <span className="text-xs font-bold text-slate-500">
                    {doneCount}/{items.length} recebidos
                  </span>
                </div>
              ) : (
                <span className="text-xs font-bold text-slate-500">
                  Editando {draftItems.length} item(ns)
                </span>
              )}
            </div>

            {!editing && items.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">Nenhum item nesta ordem.</div>
            ) : !editing ? (
              <ul className="divide-y divide-slate-100">
                {items.map((it, idx) => (
                  <li
                    key={it.id}
                    className={`px-4 py-3 flex gap-3 items-start ${
                      it.delivered ? 'bg-emerald-50/40' : ''
                    }`}
                  >
                    <button
                      type="button"
                      disabled={bulkBusy || busyId === it.id}
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
                        <span className="text-xs font-black text-slate-400 w-6">{idx + 1}</span>
                        <span
                          className={`text-sm font-medium ${
                            it.delivered ? 'text-slate-500 line-through' : 'text-primary'
                          }`}
                        >
                          {it.description}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {it.quantity != null
                          ? `${it.quantity} ${it.unit} · Recebido: ${it.received_quantity ?? 0}/${it.quantity}`
                          : `— ${it.unit}`}
                        {it.delivered && it.delivered_at && (
                          <span className="ml-2 text-emerald-700 font-bold">
                            · Recebido em {new Date(it.delivered_at).toLocaleString('pt-BR')}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={bulkBusy || busyId === it.id}
                      onClick={() => void promptPartialReceipt(it)}
                      className="text-[11px] font-bold px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      title="Registrar recebimento parcial"
                    >
                      Parcial
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 space-y-3">
                <div className="border border-slate-100 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500">
                      <tr>
                        <th className="px-2 py-2 w-10">#</th>
                        <th className="px-2 py-2">Descrição</th>
                        <th className="px-2 py-2 w-24">Qtd</th>
                        <th className="px-2 py-2 w-20">Un</th>
                        <th className="px-2 py-2 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {draftItems.map((it, idx) => (
                        <tr key={`${it.id}-${idx}`} className="border-t border-slate-100">
                          <td className="px-2 py-2 text-center text-slate-600 font-bold">{idx + 1}</td>
                          <td className="px-2 py-1">
                            <input
                              className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                              value={it.description}
                              onChange={(e) => updateDraftItem(idx, { description: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                              type="number"
                              step="any"
                              value={it.quantity ?? ''}
                              onChange={(e) =>
                                updateDraftItem(idx, {
                                  quantity: e.target.value === '' ? null : parseFloat(e.target.value),
                                })
                              }
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                              value={it.unit || ''}
                              onChange={(e) => updateDraftItem(idx, { unit: e.target.value || 'un' })}
                            />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <button
                              type="button"
                              onClick={() => removeDraftItem(idx)}
                              className="text-red-500 p-1 hover:bg-red-50 rounded"
                              title="Remover item"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={addDraftItem}
                  className="inline-flex items-center gap-2 text-xs font-bold text-secondary hover:underline"
                >
                  <Plus size={14} />
                  Adicionar item
                </button>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
