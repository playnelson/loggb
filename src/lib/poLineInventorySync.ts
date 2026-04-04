import type { createBrowserClient } from '@supabase/ssr';
import { itemCodeFromDescription } from '@/lib/itemCode';
import { normalizeProductLabelForSave } from '@/lib/productDisplayText';
import { isLikelyMissingColumn } from '@/lib/tenantItems';
import { isMissingColumnError } from '@/lib/purchaseOrderQueries';

type SupabaseClient = ReturnType<typeof createBrowserClient>;

const PENDING_CATEGORY = 'A receber';
const PENDING_LOCATION = 'Pedido';

/**
 * Garante um registro em `items` (saldo 0) para a linha do pedido e grava `inventory_item_id`.
 * Sem nome de produto, remove o vínculo. Idempotente por descrição normalizada + user_id.
 */
export async function syncPoLineToInventory(
  supabase: SupabaseClient,
  userId: string,
  poLineId: string,
  productNameRaw: string | null | undefined,
  unitRaw: string | null | undefined
): Promise<{ ok: boolean; error: string | null }> {
  const desc = normalizeProductLabelForSave(String(productNameRaw ?? ''));
  const unit = String(unitRaw ?? 'un').trim().slice(0, 10) || 'un';

  const clearLink = async (): Promise<{ ok: boolean; error: string | null }> => {
    const { error } = await supabase
      .from('purchase_order_items')
      .update({ inventory_item_id: null, updated_at: new Date().toISOString() })
      .eq('id', poLineId);
    if (error && isMissingColumnError(error)) return { ok: true, error: null };
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  };

  if (!desc) {
    return clearLink();
  }

  const { data: existing, error: findErr } = await supabase
    .from('items')
    .select('id')
    .eq('user_id', userId)
    .eq('description', desc)
    .maybeSingle();

  if (findErr) return { ok: false, error: findErr.message };

  let itemId: string;
  if (existing?.id) {
    itemId = String(existing.id);
  } else {
    const baseRow: Record<string, unknown> = {
      description: desc,
      category: PENDING_CATEGORY,
      location: PENDING_LOCATION,
      consumable: false,
      unique_item: false,
      quantity_current: 0,
      quantity_min: 0,
      unit,
      code: itemCodeFromDescription(desc),
      user_id: userId,
    };
    let row: Record<string, unknown> = { ...baseRow, tag: null };
    let ins = await supabase.from('items').insert([row]).select('id').single();
    if (ins.error?.message && isLikelyMissingColumn(ins.error.message, 'tag')) {
      const { tag: _t, ...noTag } = row;
      row = noTag;
      ins = await supabase.from('items').insert([row]).select('id').single();
    }
    if (ins.error || !ins.data?.id) {
      return { ok: false, error: ins.error?.message || 'Falha ao criar item no almoxarifado.' };
    }
    itemId = String(ins.data.id);
  }

  const { error: linkErr } = await supabase
    .from('purchase_order_items')
    .update({ inventory_item_id: itemId, updated_at: new Date().toISOString() })
    .eq('id', poLineId);

  if (linkErr && isMissingColumnError(linkErr)) {
    return { ok: true, error: null };
  }
  if (linkErr) return { ok: false, error: linkErr.message };
  return { ok: true, error: null };
}

/** Após inserir várias linhas, sincroniza cada uma (fire-and-forget com log). */
export async function syncPoLinesToInventoryAfterInsert(
  supabase: SupabaseClient,
  userId: string,
  rows: Array<{ id: string; product_name: string | null; unit: string | null | undefined }>
): Promise<void> {
  for (const r of rows) {
    const res = await syncPoLineToInventory(supabase, userId, r.id, r.product_name, r.unit);
    if (!res.ok) console.error('syncPoLineToInventory', r.id, res.error);
  }
}
