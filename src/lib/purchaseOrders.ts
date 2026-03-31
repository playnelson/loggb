export type PurchaseStage =
  | 'Rascunho'
  | 'Cotando'
  | 'Aprovado'
  | 'Comprado'
  | 'Recebido'
  | 'Cancelado';

export const PURCHASE_STAGES: PurchaseStage[] = [
  'Rascunho',
  'Cotando',
  'Aprovado',
  'Comprado',
  'Recebido',
  'Cancelado',
];

export function isPurchaseStage(v: string): v is PurchaseStage {
  return (PURCHASE_STAGES as readonly string[]).includes(v);
}

export type PurchaseOrderRow = {
  id: string;
  requester_employee_id: string;
  stage: PurchaseStage;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrderItemRow = {
  id: string;
  order_id: string;
  product_name: string | null;
  product_url: string | null;
  vendor: string | null;
  product_price: string | null;
  quantity_requested: number;
  quantity_received: number;
  received_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeLite = {
  id: string;
  full_name: string;
  status?: string;
};

export type NewOrderForm = {
  requester_employee_id: string;
  stage: PurchaseStage;
  notes: string;
  items: Array<{
    product_url: string;
    product_name: string;
    vendor: string;
    product_price: string;
    quantity_requested: number;
    notes: string;
  }>;
};

export function clampNumber(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

