'use client';

export const dynamic = 'force-dynamic';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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
  Archive,
  ArchiveRestore,
  ClipboardList,
  FileUp,
  FilterX,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
  AlertCircle,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface OrderRow {
  id: string;
  oc_number: string | null;
  title: string | null;
  vendor_name: string | null;
  buyer_name?: string | null;
  notes?: string | null;
  delivery_deadline: string | null;
  stage?: string | null;
  created_at: string;
  purchase_order_items:
    | {
        id: string;
        line_number?: number | null;
        delivered: boolean;
        delivered_at?: string | null;
        description?: string | null;
        quantity?: number | null;
        unit?: string | null;
        received_quantity?: number | null;
      }[]
    | null;
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

function withSequentialLineNumbers(items: ParsedPurchaseOrderItem[]): ParsedPurchaseOrderItem[] {
  return items.map((it, idx) => ({
    ...it,
    line_number: idx + 1,
  }));
}

function formatDateBR(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function buyerNameFromNotes(notes: string | null | undefined): string | null {
  const t = (notes || '').trim();
  if (!t) return null;
  const cleaned = t.replace(/^Comprador:\s*/i, '').trim();
  if (!cleaned) return null;
  const parts = cleaned
    .split('·')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return parts[0] || null;
}

function isOrderArchived(row: Pick<OrderRow, 'stage'>): boolean {
  const s = (row.stage || '').trim().toLowerCase();
  return s === 'arquivada' || s === 'arquivado' || s === 'archived' || s === 'archive';
}

function localTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function deadlineKind(
  iso: string | null
): 'no_deadline' | 'late' | 'today' | 'upcoming' {
  if (!iso) return 'no_deadline';
  const today = localTodayIso();
  if (iso < today) return 'late';
  if (iso === today) return 'today';
  return 'upcoming';
}

function lateDaysCount(iso: string | null): number {
  if (!iso) return 0;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const parts = iso.split('-').map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return 0;
  const dueStart = new Date(parts[0], parts[1] - 1, parts[2]);
  const diffMs = todayStart.getTime() - dueStart.getTime();
  const days = Math.floor(diffMs / 86400000);
  return days > 0 ? days : 0;
}

export default function OrdensCompraPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPending, setFilterPending] = useState<'all' | 'pending' | 'done'>('all');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'pending' | 'done' | 'no_items' | 'archived'
  >('active');
  const [deadlineFilter, setDeadlineFilter] = useState<
    'all' | 'late' | 'today' | 'upcoming' | 'no_deadline'
  >('all');

  const [importOpen, setImportOpen] = useState(false);
  const [parseLoading, setParseLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [draft, setDraft] = useState<ParsedPurchaseOrder>(() => emptyDraft());
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);
  const [parseConfidence, setParseConfidence] = useState<'high' | 'medium' | 'low'>('high');
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

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
          buyer_name: o.buyer_name || null,
          notes: null,
          delivery_deadline: o.delivery_deadline,
          stage: o.archived ? 'arquivada' : null,
          created_at: o.created_at,
          purchase_order_items: o.items.map((i) => ({
            id: i.id,
            line_number: i.line_number,
            delivered: i.delivered,
            delivered_at: i.delivered_at,
            description: i.description,
            quantity: i.quantity,
            unit: i.unit,
            received_quantity: (i as { received_quantity?: number | null }).received_quantity ?? 0,
          })),
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

    const withStage = await supabase
      .from('purchase_orders')
      .select(
        'id, oc_number, title, vendor_name, notes, delivery_deadline, stage, created_at, purchase_order_items!purchase_order_items_purchase_order_id_fkey(id, line_number, delivered, delivered_at, description, quantity, unit)'
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    const stageMissing =
      !!withStage.error &&
      /stage/i.test(
        `${withStage.error.message || ''} ${withStage.error.details || ''} ${withStage.error.hint || ''}`
      );

    let data = withStage.data;
    let error = withStage.error;

    if (stageMissing) {
      const noStage = await supabase
        .from('purchase_orders')
        .select(
          'id, oc_number, title, vendor_name, notes, delivery_deadline, created_at, purchase_order_items!purchase_order_items_purchase_order_id_fkey(id, line_number, delivered, delivered_at, description, quantity, unit)'
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      data = noStage.data;
      error = noStage.error;
    }

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
      const archived = isOrderArchived(o);
      const dKind = deadlineKind(o.delivery_deadline);
      const rowStatus: 'pending' | 'done' | 'no_items' | 'archived' =
        archived ? 'archived' : total === 0 ? 'no_items' : done === total ? 'done' : 'pending';

      if (filterPending === 'pending' && !pending) return false;
      if (filterPending === 'done' && (total === 0 || done < total)) return false;

      if (statusFilter === 'active' && archived) return false;
      if (
        statusFilter !== 'all' &&
        statusFilter !== 'active' &&
        statusFilter !== rowStatus
      ) {
        return false;
      }

      if (deadlineFilter !== 'all' && deadlineFilter !== dKind) return false;

      if (!searchLower) return true;
      const itemHay = items
        .map((i) => i.description || '')
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const hay = [
        o.oc_number,
        o.title,
        o.vendor_name,
        o.buyer_name,
        buyerNameFromNotes(o.notes),
        itemHay,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(searchLower);
    });
  }, [orders, searchLower, filterPending, statusFilter, deadlineFilter]);

  const archivedCount = useMemo(
    () => orders.filter((o) => isOrderArchived(o)).length,
    [orders]
  );

  const archiveOrder = async (row: OrderRow, archive: boolean) => {
    if (busyOrderId) return;
    setBusyOrderId(row.id);
    setParseError(null);
    try {
      if (ORDENS_COMPRA_DEV_LOCAL && typeof window !== 'undefined') {
        const list = devLocalOrdersRead();
        const next = list.map((o) => (o.id === row.id ? { ...o, archived: archive } : o));
        devLocalOrdersWrite(next);
        await fetchOrders();
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada.');

      const stageValue = archive ? 'arquivada' : 'aberta';
      const { error } = await supabase
        .from('purchase_orders')
        .update({ stage: stageValue })
        .eq('id', row.id)
        .eq('user_id', user.id);
      if (error) {
        const raw = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.trim();
        if (/stage/i.test(raw)) {
          throw new Error(
            'Seu banco não possui a coluna stage para arquivamento. Se quiser, eu preparo um SQL rápido para habilitar.'
          );
        }
        throw error;
      }

      await fetchOrders();
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Erro ao arquivar ordem.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const deleteOrder = async (row: OrderRow) => {
    if (busyOrderId) return;
    const ok = window.confirm(
      `Apagar a OC ${row.oc_number || row.title || row.id}? Essa ação não pode ser desfeita.`
    );
    if (!ok) return;

    setBusyOrderId(row.id);
    setParseError(null);
    try {
      if (ORDENS_COMPRA_DEV_LOCAL && typeof window !== 'undefined') {
        const list = devLocalOrdersRead();
        devLocalOrdersWrite(list.filter((o) => o.id !== row.id));
        await fetchOrders();
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada.');

      const { error } = await supabase
        .from('purchase_orders')
        .delete()
        .eq('id', row.id)
        .eq('user_id', user.id);
      if (error) throw error;

      await fetchOrders();
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Erro ao apagar ordem.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const openNewManual = () => {
    setDraft(emptyDraft());
    setSourceFilename(null);
    setWarnings([]);
    setParseError(null);
    setParseConfidence('high');
    setImportOpen(true);
  };

  const updateOrderItemInState = useCallback(
    (
      orderId: string,
      itemId: string,
      patch: Partial<{
        delivered: boolean;
        delivered_at: string | null;
        received_quantity: number | null;
      }>
    ) => {
      setOrders((prev) =>
        prev.map((order) => {
          if (order.id !== orderId || !order.purchase_order_items) return order;
          return {
            ...order,
            purchase_order_items: order.purchase_order_items.map((item) =>
              item.id === itemId ? { ...item, ...patch } : item
            ),
          };
        })
      );
    },
    []
  );

  const quickToggleDelivered = async (
    orderId: string,
    item: NonNullable<OrderRow['purchase_order_items']>[number]
  ) => {
    if (busyItemId || busyOrderId) return;
    const next = !item.delivered;
    const nowIso = new Date().toISOString();
    const fullQty = item.quantity ?? 0;
    setBusyItemId(item.id);
    try {
      if (ORDENS_COMPRA_DEV_LOCAL && typeof window !== 'undefined') {
        const list = devLocalOrdersRead();
        const po = list.find((o) => o.id === orderId);
        const line = po?.items.find((i) => i.id === item.id);
        if (line) {
          line.delivered = next;
          line.delivered_at = next ? nowIso : null;
          (line as { received_quantity?: number | null }).received_quantity = next ? fullQty : 0;
          devLocalOrdersWrite(list);
        }
        updateOrderItemInState(orderId, item.id, {
          delivered: next,
          delivered_at: next ? nowIso : null,
          received_quantity: next ? fullQty : 0,
        });
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

      if (e) throw e;

      updateOrderItemInState(orderId, item.id, {
        delivered: next,
        delivered_at: next ? nowIso : null,
        received_quantity: next ? fullQty : 0,
      });
    } catch (e) {
      alert(`Erro ao atualizar item: ${e instanceof Error ? e.message : 'falha desconhecida'}`);
    } finally {
      setBusyItemId(null);
    }
  };

  const quickPartialReceipt = async (
    orderId: string,
    item: NonNullable<OrderRow['purchase_order_items']>[number]
  ) => {
    if (busyItemId || busyOrderId) return;
    const current = item.received_quantity ?? 0;
    const raw = window.prompt(`Quantidade recebida para o item:`, String(current));
    if (raw == null) return;
    const parsed = Number(raw.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) {
      alert('Informe uma quantidade válida.');
      return;
    }

    const requested = item.quantity ?? parsed;
    const received = Math.max(0, Math.min(parsed, requested));
    const full = item.quantity != null ? received >= item.quantity : received > 0;
    const nowIso = new Date().toISOString();
    setBusyItemId(item.id);

    try {
      if (ORDENS_COMPRA_DEV_LOCAL && typeof window !== 'undefined') {
        const list = devLocalOrdersRead();
        const po = list.find((o) => o.id === orderId);
        const line = po?.items.find((i) => i.id === item.id);
        if (line) {
          (line as { received_quantity?: number | null }).received_quantity = received;
          line.delivered = full;
          line.delivered_at = full ? nowIso : null;
          devLocalOrdersWrite(list);
        }
        updateOrderItemInState(orderId, item.id, {
          received_quantity: received,
          delivered: full,
          delivered_at: full ? nowIso : null,
        });
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
        throw withReceived.error;
      }

      updateOrderItemInState(orderId, item.id, {
        received_quantity: received,
        delivered: full,
        delivered_at: full ? nowIso : null,
      });
    } catch (e) {
      alert(`Erro ao salvar recebimento parcial: ${e instanceof Error ? e.message : 'falha desconhecida'}`);
    } finally {
      setBusyItemId(null);
    }
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
      const parsed = json.parsed as ParsedPurchaseOrder;
      setDraft({
        ...parsed,
        items: withSequentialLineNumbers(parsed.items || []),
      });
      setWarnings((json.warnings as string[]) || []);
      setSourceFilename(file.name);
      const conf = (json.meta?.parse_confidence || 'high') as 'high' | 'medium' | 'low';
      setParseConfidence(conf);
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
      return { ...d, items: withSequentialLineNumbers(items) };
    });
  };

  const addItemRow = () => {
    setDraft((d) => ({
      ...d,
      items: withSequentialLineNumbers([
        ...d.items,
        {
          line_number: 0,
          description: '',
          quantity: null,
          unit: 'un',
        },
      ]),
    }));
  };

  const removeItemRow = (idx: number) => {
    setDraft((d) => ({
      ...d,
      items: withSequentialLineNumbers(d.items.filter((_, i) => i !== idx)),
    }));
  };

  const saveDraft = async () => {
    if (parseConfidence === 'low') {
      const proceed = window.confirm(
        'A leitura deste PDF está com confiança baixa. Confirme fornecedor, data de entrega e todos os itens antes de salvar. Deseja continuar mesmo assim?'
      );
      if (!proceed) return;
    }
    setSaveLoading(true);
    setParseError(null);
    try {
      if (ORDENS_COMPRA_DEV_LOCAL && typeof window !== 'undefined') {
        const existing = devLocalOrdersRead();
        const newId = devLocalNewId();
        const items = draft.items
          .map((it, i) => ({
            id: devLocalNewId(),
            line_number: i + 1,
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
          title:
            draft.title?.trim() ||
            (sourceFilename?.trim() ? titleFromSourceFilename(sourceFilename) : null),
          vendor_name: draft.vendor_name?.trim() || null,
          buyer_code: draft.buyer_code?.trim() || null,
          buyer_name: draft.buyer_name?.trim() || null,
          buyer_phone: draft.buyer_phone?.trim() || null,
          vendor_contact_name: draft.vendor_contact_name?.trim() || null,
          delivery_deadline: draft.delivery_deadline || null,
          source_filename: sourceFilename,
          created_at: new Date().toISOString(),
          archived: false,
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

      const baseRow: Record<string, string | null> = {
        // Mantem comprador/fornecedor acessiveis no detalhe mesmo em schemas reduzidos.
        user_id: user.id,
        oc_number: draft.oc_number?.trim() || null,
        title:
          draft.title?.trim() ||
          (sourceFilename?.trim() ? titleFromSourceFilename(sourceFilename) : null),
        vendor_name: draft.vendor_name?.trim() || null,
        vendor_contact_name: draft.vendor_contact_name?.trim() || null,
        notes:
          [draft.buyer_code, draft.buyer_name, draft.buyer_phone]
            .map((v) => (v || '').trim())
            .filter(Boolean).length > 0
            ? `Comprador: ${[draft.buyer_code, draft.buyer_name, draft.buyer_phone]
                .map((v) => (v || '').trim())
                .filter(Boolean)
                .join(' · ')}`
            : null,
        delivery_deadline: draft.delivery_deadline || null,
        source_filename: sourceFilename,
      };

      let { data: po, error: poErr } = await supabase
        .from('purchase_orders')
        .insert([baseRow])
        .select('id')
        .single();

      if (poErr) throw poErr;
      const pid = String(po.id);

      const lines = draft.items
        .map((it, i) => ({
          purchase_order_id: pid,
          line_number: i + 1,
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
      const raw = `${(e as { message?: string }).message || ''} ${(e as { details?: string }).details || ''} ${(e as { hint?: string }).hint || ''}`.trim();
      if (/requester_employee_id/i.test(raw)) {
        setParseError(
          'Banco legado detectado: a coluna requester_employee_id está obrigatória em purchase_orders. Este módulo de OC é isolado e não usa employees. Ajuste o schema para tornar requester_employee_id opcional (ou remova a coluna) e tente novamente.'
        );
        return;
      }
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
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950">
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <p>
                <strong>Recurso em construção:</strong> o módulo de ordens de compra ainda está em evolução e pode sofrer ajustes.
              </p>
            </div>
          </div>
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
          <div className="w-full lg:w-48">
            <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Status</label>
            <select
              className="w-full px-3 py-3 rounded-xl border border-slate-200 text-sm font-medium bg-white min-h-[48px]"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target.value as
                    | 'all'
                    | 'active'
                    | 'pending'
                    | 'done'
                    | 'no_items'
                    | 'archived'
                )
              }
            >
              <option value="active">Ativas</option>
              <option value="all">Todas</option>
              <option value="pending">Em andamento</option>
              <option value="done">Concluídas</option>
              <option value="no_items">Sem itens</option>
              <option value="archived">Arquivadas</option>
            </select>
          </div>
          <div className="w-full lg:w-48">
            <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Prazo</label>
            <select
              className="w-full px-3 py-3 rounded-xl border border-slate-200 text-sm font-medium bg-white min-h-[48px]"
              value={deadlineFilter}
              onChange={(e) =>
                setDeadlineFilter(
                  e.target.value as 'all' | 'late' | 'today' | 'upcoming' | 'no_deadline'
                )
              }
            >
              <option value="all">Todos</option>
              <option value="late">Atrasadas</option>
              <option value="today">Vence hoje</option>
              <option value="upcoming">No prazo</option>
              <option value="no_deadline">Sem prazo</option>
            </select>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 min-h-[48px] lg:mb-0"
            onClick={() => {
              setSearch('');
              setFilterPending('all');
              setStatusFilter('active');
              setDeadlineFilter('all');
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

      <div className="bg-white rounded-xl border border-border shadow-sm p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400">Consulta</p>
            <p className="text-sm font-bold text-primary">
              Arquivadas: {archivedCount}
            </p>
            <p className="text-xs text-slate-500">
              Use este atalho para consultar apenas lançamentos arquivados.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStatusFilter('archived')}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <Archive size={16} />
            Ver arquivadas
          </button>
        </div>
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
                  <th className="px-2 py-3 w-10" />
                  <th className="px-4 py-3">OC</th>
                  <th className="px-4 py-3">Fornecedor / título</th>
                  <th className="px-4 py-3">Comprador</th>
                  <th className="px-4 py-3">Prazo</th>
                  <th className="px-4 py-3">Entrega</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 w-56" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const items = o.purchase_order_items || [];
                  const total = items.length;
                  const done = items.filter((i) => i.delivered).length;
                  const archived = isOrderArchived(o);
                  const rowBusy = busyOrderId === o.id;
                  const dKind = deadlineKind(o.delivery_deadline);
                  const lateDays = lateDaysCount(o.delivery_deadline);
                  const rowStatus: 'Em andamento' | 'Concluída' | 'Sem itens' | 'Arquivada' =
                    archived ? 'Arquivada' : total === 0 ? 'Sem itens' : done === total ? 'Concluída' : 'Em andamento';
                  const expanded = expandedOrderId === o.id;
                  return (
                    <Fragment key={o.id}>
                      <tr
                        className={`border-b border-slate-50 hover:bg-slate-50/80 cursor-pointer ${archived ? 'bg-slate-50/80' : ''}`}
                        onClick={() => setExpandedOrderId((prev) => (prev === o.id ? null : o.id))}
                      >
                        <td className="px-2 py-3 text-slate-500">
                          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </td>
                        <td className="px-4 py-3 font-bold text-primary whitespace-nowrap">
                          {o.oc_number || '—'}
                        </td>
                        <td className="px-4 py-3 min-w-[180px]">
                          <div className="font-medium text-primary truncate max-w-[240px] sm:max-w-md">
                            {o.title || o.vendor_name || 'Sem título'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 min-w-[180px]">
                          <span className="text-xs font-medium">
                            {o.buyer_name || buyerNameFromNotes(o.notes) || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          <div className="font-medium text-primary">{formatDateBR(o.delivery_deadline)}</div>
                          {!archived && total > 0 && done < total && dKind === 'late' && (
                            <div className="text-[11px] font-bold text-red-600">
                              Atrasada {lateDays === 1 ? 'há 1 dia' : `há ${lateDays} dias`}
                            </div>
                          )}
                          {!archived && total > 0 && done < total && dKind === 'today' && (
                            <div className="text-[11px] font-bold text-amber-700">Vence hoje</div>
                          )}
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
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-bold ${
                              rowStatus === 'Arquivada'
                                ? 'bg-slate-200 text-slate-700'
                                : rowStatus === 'Concluída'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : rowStatus === 'Sem itens'
                                    ? 'bg-slate-100 text-slate-600'
                                    : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {rowStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-3">
                            <Link
                              href={`/ordens-compra/${o.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-secondary font-bold hover:underline text-xs sm:text-sm"
                            >
                              Abrir
                            </Link>
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={(e) => {
                                e.stopPropagation();
                                void archiveOrder(o, !archived);
                              }}
                              className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:underline disabled:opacity-50"
                              title={archived ? 'Desarquivar ordem' : 'Arquivar ordem'}
                            >
                              {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                              {archived ? 'Desarquivar' : 'Arquivar'}
                            </button>
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={(e) => {
                                e.stopPropagation();
                                void deleteOrder(o);
                              }}
                              className="inline-flex items-center gap-1 text-xs font-bold text-red-600 hover:underline disabled:opacity-50"
                              title="Apagar ordem"
                            >
                              <Trash2 size={13} />
                              Apagar
                            </button>
                          </div>
                        </td>
                      </tr>

                      {expanded && (
                        <tr className="border-b border-slate-100 bg-slate-50/50">
                          <td colSpan={8} className="px-4 py-3">
                            {items.length === 0 ? (
                              <p className="text-xs text-slate-500">Esta OC não possui itens.</p>
                            ) : (
                              <div className="space-y-2">
                                {items.map((item, idx) => {
                                  const qty = item.quantity ?? null;
                                  const received = item.received_quantity ?? (item.delivered ? qty ?? 0 : 0);
                                  const lineNo = item.line_number || idx + 1;
                                  const itemBusy = busyItemId === item.id;
                                  return (
                                    <div
                                      key={item.id}
                                      className={`rounded-lg border px-3 py-2 flex flex-col md:flex-row md:items-center md:justify-between gap-2 ${
                                        item.delivered
                                          ? 'border-emerald-200 bg-emerald-50/60'
                                          : 'border-slate-200 bg-white'
                                      }`}
                                    >
                                      <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-700">
                                          Item {lineNo}
                                        </p>
                                        <p
                                          className={`text-sm ${
                                            item.delivered ? 'text-slate-500 line-through' : 'text-primary'
                                          }`}
                                        >
                                          {item.description || 'Sem descrição'}
                                        </p>
                                        <p className="text-[11px] text-slate-500">
                                          {qty != null
                                            ? `${qty} ${item.unit || 'un'} · Recebido: ${received}/${qty}`
                                            : `Recebido: ${received} ${item.unit || 'un'}`}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          disabled={itemBusy || !!busyOrderId}
                                          onClick={() => void quickPartialReceipt(o.id, item)}
                                          className="text-[11px] font-bold px-2.5 py-1.5 rounded border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                        >
                                          Parcial
                                        </button>
                                        <button
                                          type="button"
                                          disabled={itemBusy || !!busyOrderId}
                                          onClick={() => void quickToggleDelivered(o.id, item)}
                                          className={`text-[11px] font-bold px-2.5 py-1.5 rounded border disabled:opacity-50 ${
                                            item.delivered
                                              ? 'border-amber-200 text-amber-800 bg-amber-50 hover:bg-amber-100'
                                              : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                                          }`}
                                        >
                                          {itemBusy ? 'Salvando...' : item.delivered ? 'Desfazer' : 'Receber tudo'}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    value={draft.title || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value || null }))}
                  />
                </label>
                {sourceFilename ? (
                  <p className="md:col-span-2 text-[10px] text-slate-500 -mt-2">
                    Título sugerido automaticamente pelo arquivo importado; você pode editar se quiser.
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
                          <td className="px-2 py-2 align-top text-center text-slate-600 font-bold">
                            {idx + 1}
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
