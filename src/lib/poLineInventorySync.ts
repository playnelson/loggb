import type { createBrowserClient } from '@supabase/ssr';
import { itemCodeFromDescription } from '@/lib/itemCode';
import { normalizeProductLabelForSave } from '@/lib/productDisplayText';
import { isLikelyMissingColumn } from '@/lib/tenantItems';
import { isMissingColumnError } from '@/lib/purchaseOrderQueries';

type SupabaseClient = ReturnType<typeof createBrowserClient>;

const PENDING_CATEGORY = 'A receber';
const PENDING_LOCATION = 'Pedido';

type SyncInput = {
  inventoryItemId: string | null | undefined;
  productNameRaw: string | null | undefined;
  unitRaw: string | null | undefined;
  quantityRequested: number;
};

/**
 * Ação manual por item do pedido:
 * - sem vínculo: cria (ou reaproveita) item em `items` e vincula em `inventory_item_id`;
 * - com vínculo: atualiza nome/unidade/estoque do item já vinculado.
 */
export async function syncPoLineToInventoryManual(
  supabase: SupabaseClient,
  userId: string,
  poLineId: string,
  input: SyncInput
): Promise<{ ok: boolean; error: string | null }> {
  const desc = normalizeProductLabelForSave(String(input.productNameRaw ?? ''));
  const unit = String(input.unitRaw ?? 'un').trim().slice(0, 10) || 'un';
  const qty = Number.isFinite(input.quantityRequested) ? Math.max(0, Math.floor(input.quantityRequested)) : 0;
  if (!desc) {
    return { ok: false, error: 'Informe o nome do produto antes de enviar ao almoxarifado.' };
  }

  const touchLinkedItem = async (itemId: string): Promise<{ ok: boolean; error: string | null }> => {
    let patch: Record<string, unknown> = {
      description: desc,
      unit,
      quantity_current: qty,
      updated_at: new Date().toISOString(),
      tag: null,
    };
    let up = await supabase.from('items').update(patch).eq('id', itemId).eq('user_id', userId);
    if (up.error?.message && isLikelyMissingColumn(up.error.message, 'tag')) {
      const { tag: _t, ...noTag } = patch;
      patch = noTag;
      up = await supabase.from('items').update(patch).eq('id', itemId).eq('user_id', userId);
    }
    if (up.error) return { ok: false, error: up.error.message };
    return { ok: true, error: null };
  };

  if (input.inventoryItemId) {
    return touchLinkedItem(String(input.inventoryItemId));
  }

  const { data: existingByName, error: findErr } = await supabase
    .from('items')
    .select('id')
    .eq('user_id', userId)
    .eq('description', desc)
    .maybeSingle();

  if (findErr) return { ok: false, error: findErr.message };

  let itemId: string;
  if (existingByName?.id) {
    itemId = String(existingByName.id);
    const touch = await touchLinkedItem(itemId);
    if (!touch.ok) return touch;
  } else {
    const baseRow: Record<string, unknown> = {
      description: desc,
      category: PENDING_CATEGORY,
      location: PENDING_LOCATION,
      consumable: false,
      unique_item: false,
      quantity_current: qty,
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
