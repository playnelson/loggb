import type { createBrowserClient } from '@supabase/ssr';

type SupabaseClient = ReturnType<typeof createBrowserClient>;

export type MovementType = 'IN' | 'OUT';

export type RecordMovementInput = {
  item_id: string;
  employee_id: string | null;
  quantity: number;
  type: MovementType;
  performed_by: string;
  tag?: string | null;
};

export async function recordMovement(
  supabase: SupabaseClient,
  input: RecordMovementInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  const payload: Record<string, unknown> = {
    item_id: input.item_id,
    employee_id: input.employee_id,
    quantity: input.quantity,
    type: input.type,
    performed_by: input.performed_by,
  };
  if (input.tag) payload.tag = input.tag;

  const { error: err1 } = await supabase.from('movements').insert([payload]);
  if (!err1) return { ok: true };

  const msg = String(err1.message || '');
  // If DB doesn't have optional column yet, retry without it.
  if (input.tag && msg.toLowerCase().includes('column') && msg.toLowerCase().includes('tag')) {
    const { tag: _tag, ...withoutTag } = payload as { tag?: unknown };
    const { error: err2 } = await supabase.from('movements').insert([withoutTag]);
    if (!err2) return { ok: true };
    return { ok: false, message: err2.message || 'Erro ao registrar movimentação.' };
  }

  return { ok: false, message: err1.message || 'Erro ao registrar movimentação.' };
}

export async function updateStock(
  supabase: SupabaseClient,
  itemId: string,
  delta: number
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('update_stock', { p_item_id: itemId, p_quantity: delta });
  if (!error) return { ok: true };

  // RPC ausente, RLS ou permissão: tenta o mesmo efeito lendo e gravando em `items`.
  const rpcMsg = error.message || '';
  const { data: row, error: selErr } = await supabase
    .from('items')
    .select('quantity_current')
    .eq('id', itemId)
    .maybeSingle();

  if (selErr) {
    return {
      ok: false,
      message: rpcMsg || selErr.message || 'Erro ao atualizar estoque.',
    };
  }
  if (!row) {
    return { ok: false, message: 'Item não encontrado para atualizar o estoque.' };
  }

  const next = Number(row.quantity_current ?? 0) + delta;
  if (!Number.isFinite(next) || next < 0) {
    return { ok: false, message: 'Saldo em estoque inválido após a operação.' };
  }

  const { error: upErr } = await supabase.from('items').update({ quantity_current: next }).eq('id', itemId);
  if (upErr) {
    return { ok: false, message: upErr.message || rpcMsg || 'Erro ao atualizar estoque.' };
  }
  return { ok: true };
}

export async function updatePossessionQuantity(
  supabase: SupabaseClient,
  employeeId: string,
  itemId: string,
  nextQty: number,
  userId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (nextQty <= 0) {
    const { error } = await supabase.from('possession').delete().match({ employee_id: employeeId, item_id: itemId });
    if (error) return { ok: false, message: error.message || 'Erro ao atualizar carteira.' };
    return { ok: true };
  }
  const { error } = await supabase
    .from('possession')
    .upsert({ employee_id: employeeId, item_id: itemId, quantity: nextQty, user_id: userId }, { onConflict: 'employee_id,item_id' });
  if (error) return { ok: false, message: error.message || 'Erro ao atualizar carteira.' };
  return { ok: true };
}

