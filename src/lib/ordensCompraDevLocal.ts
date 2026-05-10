/**
 * Modo desenvolvimento: testar ordens de compra sem login/Supabase/internet (dados só no navegador).
 * Ative em .env.local: NEXT_PUBLIC_ORDENS_COMPRA_DEV_LOCAL=1
 * Use apenas em npm run dev — não use em produção.
 */

export const ORDENS_COMPRA_DEV_LOCAL =
  process.env.NODE_ENV === 'development' &&
  process.env.NEXT_PUBLIC_ORDENS_COMPRA_DEV_LOCAL === '1';

const STORAGE_KEY = 'loggb.ordens_compra.dev.v1';

export interface DevLocalPoItem {
  id: string;
  line_number: number;
  description: string;
  quantity: number | null;
  unit: string;
  delivered: boolean;
  delivered_at: string | null;
}

export interface DevLocalPurchaseOrder {
  id: string;
  oc_number: string | null;
  title: string | null;
  buyer_code: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  vendor_name: string | null;
  vendor_contact_name: string | null;
  delivery_deadline: string | null;
  source_filename: string | null;
  created_at: string;
  archived?: boolean;
  items: DevLocalPoItem[];
}

function safeParse(raw: string | null): DevLocalPurchaseOrder[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || !('orders' in v)) return [];
    const orders = (v as { orders: unknown }).orders;
    return Array.isArray(orders) ? (orders as DevLocalPurchaseOrder[]) : [];
  } catch {
    return [];
  }
}

export function devLocalOrdersRead(): DevLocalPurchaseOrder[] {
  if (typeof window === 'undefined') return [];
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export function devLocalOrdersWrite(orders: DevLocalPurchaseOrder[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ orders }));
}

export function devLocalNewId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
