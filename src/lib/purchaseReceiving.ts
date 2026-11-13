/**
 * Recebimento de pedido de compra com entrada no estoque.
 * A gravação é feita pela função `receive_po_item` (supabase/etapa3_recebimento_inventario.sql):
 * recebimento + movimentação de entrada + saldo numa única transação.
 */
import type { createBrowserClient } from '@supabase/ssr';
import { itemCodeFromDescription } from '@/lib/itemCode';
import { normalizeProductLabelForSave } from '@/lib/productDisplayText';
import { normalizeSearchText } from '@/lib/employeeName';

type SupabaseClient = ReturnType<typeof createBrowserClient>;

export type ReceivePoItemInput = {
  lineId: string;
  /** Total recebido da linha (não a diferença). */
  received: number;
  /** Liga (ou troca) o item do almoxarifado. */
  itemId?: string | null;
  /** true: a linha não entra no estoque (serviço, frete…). */
  stockSkip?: boolean | null;
  batchId?: string | null;
};

export type ReceivePoItemResult =
  | {
      ok: true;
      received_quantity: number;
      stocked_quantity: number;
      stock_delta: number;
      inventory_item_id: string | null;
      stock_skip: boolean;
      delivered: boolean;
    }
  | { ok: false; message: string };

export async function receivePoItem(supabase: SupabaseClient, input: ReceivePoItemInput): Promise<ReceivePoItemResult> {
  const { data, error } = await supabase.rpc('receive_po_item', {
    p_line_id: input.lineId,
    p_received: Math.round(input.received * 1000) / 1000,
    p_item_id: input.itemId ?? null,
    p_stock_skip: input.stockSkip ?? null,
    p_batch_id: input.batchId ?? null,
  });
  if (error) {
    if (error.code === 'PGRST202' || /could not find the function/i.test(error.message || '')) {
      return { ok: false, message: 'A função receive_po_item não existe no banco. Execute supabase/etapa3_recebimento_inventario.sql.' };
    }
    return { ok: false, message: error.message || 'Erro ao registrar recebimento.' };
  }
  const d = (data || {}) as Record<string, unknown>;
  return {
    ok: true,
    received_quantity: Number(d.received_quantity ?? 0),
    stocked_quantity: Number(d.stocked_quantity ?? 0),
    stock_delta: Number(d.stock_delta ?? 0),
    inventory_item_id: d.inventory_item_id ? String(d.inventory_item_id) : null,
    stock_skip: Boolean(d.stock_skip),
    delivered: Boolean(d.delivered),
  };
}

/** Linha de pedido com os campos de estoque. */
export type PoLineStock = {
  quantity: number | null;
  received_quantity: number | null;
  stocked_quantity?: number | null;
  inventory_item_id?: string | null;
  stock_skip?: boolean | null;
};

/** Recebido que ainda não entrou no estoque (linha sem item ligado). */
export function pendingStockQty(line: PoLineStock): number {
  if (line.stock_skip) return 0;
  const pending = Number(line.received_quantity ?? 0) - Number(line.stocked_quantity ?? 0);
  return pending > 0 ? Math.round(pending * 1000) / 1000 : 0;
}

export type ReceivableItem = {
  id: string;
  code: string | null;
  description: string;
  unit: string;
  category: string;
  quantity_current: number;
};

/** Itens ativos da conta (para ligar linhas do pedido). */
export async function loadReceivableItems(supabase: SupabaseClient, userId: string): Promise<ReceivableItem[]> {
  const out: ReceivableItem[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await supabase
      .from('items')
      .select('id, code, description, unit, category, quantity_current')
      .is('archived_at', null)
      .order('description', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const chunk = (data || []) as Array<Record<string, unknown>>;
    for (const r of chunk) {
      out.push({
        id: String(r.id),
        code: (r.code as string | null) ?? null,
        description: String(r.description ?? ''),
        unit: String(r.unit ?? 'un'),
        category: String(r.category ?? ''),
        quantity_current: Number(r.quantity_current ?? 0),
      });
    }
    if (chunk.length < 1000) break;
  }
  return out;
}

/** Item com exatamente a mesma descrição (mesmo código interno), se existir. */
export function exactItemForDescription(description: string, items: ReceivableItem[]): ReceivableItem | null {
  const norm = normalizeProductLabelForSave(description);
  if (!norm) return null;
  const code = itemCodeFromDescription(norm);
  return items.find((i) => i.code === code || normalizeProductLabelForSave(i.description) === norm) ?? null;
}

function tokens(s: string): string[] {
  return normalizeSearchText(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** Sugestões de item para a descrição do pedido (palavras em comum). */
export function suggestItems(description: string, items: ReceivableItem[], limit = 6): ReceivableItem[] {
  const want = new Set(tokens(description));
  if (want.size === 0) return [];
  return items
    .map((it) => {
      const have = tokens(it.description);
      let score = 0;
      for (const t of have) if (want.has(t)) score += t.length >= 4 ? 2 : 1;
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.it.description.localeCompare(b.it.description))
    .slice(0, limit)
    .map((x) => x.it);
}

/**
 * Cria o item no almoxarifado a partir da linha do pedido (saldo 0 — a entrada vem do recebimento).
 * Se já existir item com a mesma descrição, devolve o existente.
 */
export async function createItemForPoLine(
  supabase: SupabaseClient,
  userId: string,
  input: { description: string; unit: string; category: string; consumable: boolean }
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const description = normalizeProductLabelForSave(input.description);
  if (!description) return { ok: false, message: 'Informe a descrição do item.' };
  const code = itemCodeFromDescription(description);
  const { data, error } = await supabase
    .from('items')
    .insert([
      {
        description,
        code,
        category: input.category || 'Consumível',
        unit: (input.unit || 'un').trim().slice(0, 10) || 'un',
        location: '',
        consumable: input.consumable,
        unique_item: false,
        quantity_current: 0,
        quantity_min: 0,
        user_id: userId,
      },
    ])
    .select('id')
    .single();
  if (!error && data?.id) return { ok: true, id: String(data.id) };
  if (error?.code === '23505') {
    const { data: existing } = await supabase
      .from('items')
      .select('id, archived_at')
      .eq('code', code)
      .maybeSingle();
    if (existing?.archived_at) {
      return { ok: false, message: 'Já existe um item ARQUIVADO com esta descrição. Reative-o no Almoxarifado e tente de novo.' };
    }
    if (existing?.id) return { ok: true, id: String(existing.id) };
  }
  return { ok: false, message: error?.message || 'Erro ao criar o item.' };
}
