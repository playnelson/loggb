import type { createBrowserClient } from '@supabase/ssr';

type SupabaseClient = ReturnType<typeof createBrowserClient>;

export type MovementType = 'IN' | 'OUT';

/** Motivo da movimentação (coluna movements.reason). */
export type MovementReason =
  | 'entrada'
  | 'saida'
  | 'devolucao'
  | 'ajuste'
  | 'descarte'
  | 'saldo_inicial'
  | 'importacao'
  | 'inventario';

export const MOVEMENT_REASON_LABEL: Record<MovementReason, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  devolucao: 'Devolução',
  ajuste: 'Ajuste',
  descarte: 'Descarte',
  saldo_inicial: 'Saldo inicial',
  importacao: 'Importação',
  inventario: 'Inventário',
};

export const MOVEMENT_REASONS = Object.keys(MOVEMENT_REASON_LABEL) as MovementReason[];

/** Motivo de uma linha do histórico; linhas antigas sem `reason` são deduzidas do tipo. */
export function movementReasonOf(m: {
  reason?: string | null;
  type?: string | null;
  employee_id?: string | null;
  work_site_id?: string | null;
  tag?: string | null;
}): MovementReason {
  if (m.reason && m.reason in MOVEMENT_REASON_LABEL) return m.reason as MovementReason;
  const hasParty = Boolean(m.employee_id || m.work_site_id);
  if (m.type === 'OUT') return hasParty ? 'saida' : 'ajuste';
  if (String(m.tag || '').toUpperCase().includes('DESCARTE')) return 'descarte';
  return hasParty ? 'devolucao' : 'entrada';
}

/** Quantidade no padrão brasileiro (até 3 casas decimais, vírgula). */
export function formatQty(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

/** Lê quantidade digitada (aceita vírgula) e arredonda em 3 casas. */
export function parseQty(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

export type RegisterMovementInput = {
  item_id: string;
  type: MovementType;
  /** Motivo; se omitido, o banco deduz (saída, devolução, entrada, ajuste, descarte). */
  reason?: MovementReason;
  /** Quantidade registrada no histórico (sempre positiva). */
  quantity: number;
  employee_id?: string | null;
  work_site_id?: string | null;
  tag?: string | null;
  /** Variação do saldo do almoxarifado (items.quantity_current). Ex.: saída = -quantidade. */
  stock_delta?: number;
  /** Variação da carteira do colaborador (exige employee_id). */
  possession_delta?: number;
  /** Variação do saldo no canteiro/sede (exige work_site_id). */
  site_delta?: number;
  /** Se true, carteira insuficiente é zerada em vez de dar erro. */
  possession_clamp?: boolean;
  /** Observação livre (até 500 caracteres). */
  note?: string | null;
  /** Documento de referência: requisição, OS, NF (até 120 caracteres). */
  document?: string | null;
  /** Agrupa as linhas de uma mesma retirada (um recibo). */
  batch_id?: string | null;
  /** CA do EPI entregue (preenchido na entrega). Vazio = usa o CA do cadastro do item. */
  ca_number?: string | null;
};

export type RegisterMovementResult =
  | { ok: true; quantity_current: number | null; movement_id: string | null }
  | { ok: false; message: string };

/** Limites dos campos de texto da movimentação (iguais aos do banco). */
export const MOVEMENT_NOTE_MAX = 500;
export const MOVEMENT_DOCUMENT_MAX = 120;

/** Identificador novo para agrupar linhas de uma retirada. */
export function newBatchId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Navegadores antigos: UUID v4 a partir de Math.random (suficiente para agrupar linhas).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Número curto do recibo (8 primeiros caracteres do lote, em maiúsculas). */
export function receiptNumber(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/**
 * Registra movimentação + saldo do almoxarifado + carteira + saldo no local numa ÚNICA transação
 * (função `register_movement` no Postgres — ver supabase/register_movement.sql).
 * Se qualquer parte falhar, nada é gravado.
 */
export async function registerMovement(
  supabase: SupabaseClient,
  input: RegisterMovementInput
): Promise<RegisterMovementResult> {
  const { data, error } = await supabase.rpc('register_movement', {
    p_item_id: input.item_id,
    p_type: input.type,
    p_quantity: input.quantity,
    p_employee_id: input.employee_id ?? null,
    p_work_site_id: input.work_site_id ?? null,
    p_tag: input.tag ?? null,
    p_stock_delta: input.stock_delta ?? 0,
    p_possession_delta: input.possession_delta ?? 0,
    p_site_delta: input.site_delta ?? 0,
    p_possession_clamp: input.possession_clamp ?? false,
    p_reason: input.reason ?? null,
    p_note: input.note?.trim() || null,
    p_document: input.document?.trim() || null,
    p_batch_id: input.batch_id ?? null,
    ...(input.ca_number?.trim() ? { p_ca_number: input.ca_number.trim() } : {}),
  });

  if (error) {
    const msg = error.message || '';
    if (error.code === 'PGRST202' || /could not find the function/i.test(msg)) {
      return {
        ok: false,
        message:
          'A função register_movement não existe no banco. Execute o script supabase/register_movement.sql no Supabase.',
      };
    }
    return { ok: false, message: msg || 'Erro ao registrar movimentação.' };
  }

  const out = data as { quantity_current?: unknown; movement_id?: unknown } | null;
  const qc = out?.quantity_current;
  return {
    ok: true,
    quantity_current: qc == null ? null : Number(qc),
    movement_id: out?.movement_id ? String(out.movement_id) : null,
  };
}

