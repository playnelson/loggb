import type { createBrowserClient } from '@supabase/ssr';
import type { PurchaseOrderItemRow, PurchaseOrderRow } from '@/lib/purchaseOrders';

type SupabaseClient = ReturnType<typeof createBrowserClient>;

/** PostgREST / Postgres when a selected column is not in the schema yet. */
export function isMissingColumnError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code ?? '');
  const msg = String(err.message ?? '').toLowerCase();
  if (code === '42703' || code === 'PGRST204') return true;
  if (msg.includes('could not find') && msg.includes('column')) return true;
  if (msg.includes('schema cache') && msg.includes('column')) return true;
  return false;
}

const PO_LIST_WITH_KANBAN =
  'id, requester_employee_id, stage, title, kanban_column_id, notes, created_at, updated_at';
const PO_LIST_FULL = `${PO_LIST_WITH_KANBAN.replace(/updated_at$/, 'oc_number, updated_at')}`;
const PO_LIST_LEGACY = 'id, requester_employee_id, stage, notes, created_at, updated_at';

const PO_DETAIL_WITH_KANBAN =
  'id, user_id, requester_employee_id, stage, title, kanban_column_id, notes, created_at, updated_at';
const PO_DETAIL_FULL = `${PO_DETAIL_WITH_KANBAN.replace(/updated_at$/, 'oc_number, updated_at')}`;
const PO_DETAIL_LEGACY = 'id, user_id, requester_employee_id, stage, notes, created_at, updated_at';

const ITEMS_WITHOUT_INVENTORY_LINK =
  'id, order_id, product_name, product_url, vendor, product_price, unit, quantity_requested, quantity_received, received_at, notes, created_at, updated_at';
const ITEMS_FULL = `${ITEMS_WITHOUT_INVENTORY_LINK.replace(/updated_at$/, 'inventory_item_id, updated_at')}`;

function mapOrderRow(r: Record<string, unknown>): PurchaseOrderRow {
  return {
    id: String(r.id),
    requester_employee_id: String(r.requester_employee_id),
    stage: String(r.stage ?? ''),
    title: (r.title as string) ?? null,
    oc_number: r.oc_number != null && String(r.oc_number).trim() !== '' ? String(r.oc_number).trim() : null,
    kanban_column_id: r.kanban_column_id ? String(r.kanban_column_id) : null,
    notes: (r.notes as string) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function mapItemRow(r: Record<string, unknown>): PurchaseOrderItemRow {
  return {
    id: String(r.id),
    order_id: String(r.order_id),
    inventory_item_id: r.inventory_item_id ? String(r.inventory_item_id) : null,
    product_name: (r.product_name as string) ?? null,
    product_url: (r.product_url as string) ?? null,
    vendor: (r.vendor as string) ?? null,
    product_price: (r.product_price as string) ?? null,
    unit: String(r.unit ?? 'un'),
    quantity_requested: Number(r.quantity_requested ?? 0),
    quantity_received: Number(r.quantity_received ?? 0),
    received_at: (r.received_at as string) ?? null,
    notes: (r.notes as string) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function fetchPurchaseOrdersForUser(
  supabase: SupabaseClient,
  userId: string,
  ascending: boolean
): Promise<{ rows: PurchaseOrderRow[]; error: { message: string } | null }> {
  const first = await supabase
    .from('purchase_orders')
    .select(PO_LIST_FULL)
    .eq('user_id', userId)
    .order('created_at', { ascending });
  if (first.error && isMissingColumnError(first.error)) {
    const second = await supabase
      .from('purchase_orders')
      .select(PO_LIST_WITH_KANBAN)
      .eq('user_id', userId)
      .order('created_at', { ascending });
    if (second.error && isMissingColumnError(second.error)) {
      const third = await supabase
        .from('purchase_orders')
        .select(PO_LIST_LEGACY)
        .eq('user_id', userId)
        .order('created_at', { ascending });
      if (third.error) return { rows: [], error: { message: third.error.message } };
      return {
        rows: (third.data || []).map((r: unknown) => mapOrderRow(r as Record<string, unknown>)),
        error: null,
      };
    }
    if (second.error) return { rows: [], error: { message: second.error.message } };
    return {
      rows: (second.data || []).map((r: unknown) => mapOrderRow(r as Record<string, unknown>)),
      error: null,
    };
  }
  if (first.error) return { rows: [], error: { message: first.error.message } };
  return {
    rows: (first.data || []).map((r: unknown) => mapOrderRow(r as Record<string, unknown>)),
    error: null,
  };
}

export async function fetchPurchaseOrderById(
  supabase: SupabaseClient,
  orderId: string
): Promise<{ row: Record<string, unknown> | null; error: { message: string } | null }> {
  const first = await supabase.from('purchase_orders').select(PO_DETAIL_FULL).eq('id', orderId).maybeSingle();
  if (first.error && isMissingColumnError(first.error)) {
    const second = await supabase
      .from('purchase_orders')
      .select(PO_DETAIL_WITH_KANBAN)
      .eq('id', orderId)
      .maybeSingle();
    if (second.error && isMissingColumnError(second.error)) {
      const third = await supabase.from('purchase_orders').select(PO_DETAIL_LEGACY).eq('id', orderId).maybeSingle();
      if (third.error) return { row: null, error: { message: third.error.message } };
      return { row: (third.data as Record<string, unknown>) ?? null, error: null };
    }
    if (second.error) return { row: null, error: { message: second.error.message } };
    return { row: (second.data as Record<string, unknown>) ?? null, error: null };
  }
  if (first.error) return { row: null, error: { message: first.error.message } };
  return { row: (first.data as Record<string, unknown>) ?? null, error: null };
}

export async function fetchPurchaseOrderItemsForOrderIds(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<{ items: PurchaseOrderItemRow[]; error: { message: string } | null }> {
  if (orderIds.length === 0) return { items: [], error: null };
  const first = await supabase.from('purchase_order_items').select(ITEMS_FULL).in('order_id', orderIds);
  if (first.error && isMissingColumnError(first.error)) {
    const second = await supabase
      .from('purchase_order_items')
      .select(ITEMS_WITHOUT_INVENTORY_LINK)
      .in('order_id', orderIds);
    if (second.error) return { items: [], error: { message: second.error.message } };
    return {
      items: (second.data || []).map((r: unknown) => mapItemRow(r as Record<string, unknown>)),
      error: null,
    };
  }
  if (first.error) return { items: [], error: { message: first.error.message } };
  return {
    items: (first.data || []).map((r: unknown) => mapItemRow(r as Record<string, unknown>)),
    error: null,
  };
}

export async function fetchPurchaseOrderItemsForOrderIdOrdered(
  supabase: SupabaseClient,
  orderId: string,
  ascending: boolean
): Promise<{ items: PurchaseOrderItemRow[]; error: { message: string } | null }> {
  const first = await supabase
    .from('purchase_order_items')
    .select(ITEMS_FULL)
    .eq('order_id', orderId)
    .order('created_at', { ascending });
  if (first.error && isMissingColumnError(first.error)) {
    const second = await supabase
      .from('purchase_order_items')
      .select(ITEMS_WITHOUT_INVENTORY_LINK)
      .eq('order_id', orderId)
      .order('created_at', { ascending });
    if (second.error) return { items: [], error: { message: second.error.message } };
    return {
      items: (second.data || []).map((r: unknown) => mapItemRow(r as Record<string, unknown>)),
      error: null,
    };
  }
  if (first.error) return { items: [], error: { message: first.error.message } };
  return {
    items: (first.data || []).map((r: unknown) => mapItemRow(r as Record<string, unknown>)),
    error: null,
  };
}
