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

export type PurchaseRequestRow = {
  id: string;
  requester: string | null;
  vendor: string | null;
  product_name: string | null;
  product_url: string | null;
  product_price: string | null;
  stage: PurchaseStage;
  notes: string | null;
  created_at: string;
};

export type PurchaseDraftForm = {
  requester: string;
  product_url: string;
  product_name: string;
  vendor: string;
  product_price: string;
  stage: PurchaseStage;
  notes: string;
};

