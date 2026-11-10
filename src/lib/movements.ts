import type { createBrowserClient } from '@supabase/ssr';

type SupabaseClient = ReturnType<typeof createBrowserClient>;

export type MovementType = 'IN' | 'OUT';

export type RecordMovementInput = {
  item_id: string;
  employee_id: string | null;
  work_site_id?: string | null;
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
  if (input.work_site_id) payload.work_site_id = input.work_site_id;

  const { error: err1 } = await supabase.from('movements').insert([payload]);
  if (!err1) return { ok: true };

  const msg = String(err1.message || '').toLowerCase();
  // If DB doesn't have optional column yet, retry without it.
  if (input.tag && msg.includes('column') && msg.includes('tag')) {
    const { tag: _tag, ...withoutTag } = payload as { tag?: unknown };
    const { error: err2 } = await supabase.from('movements').insert([withoutTag]);
    if (!err2) return { ok: true };
    return { ok: false, message: err2.message || 'Erro ao registrar movimentação.' };
  }
  if (input.work_site_id && msg.includes('column') && msg.includes('work_site')) {
    const { work_site_id: _ws, ...withoutSite } = payload as { work_site_id?: unknown };
    const { error: err2 } = await supabase.from('movements').insert([withoutSite]);
    if (!err2) {
      return {
        ok: false,
        message:
          'A coluna work_site_id não existe em movements. Execute o script supabase/work_sites.sql no Supabase.',
      };
    }
    return { ok: false, message: err2.message || 'Erro ao registrar movimentação.' };
  }

  return { ok: false, message: err1.message || 'Erro ao registrar movimentação.' };
}

export type RegisterMovementInput = {
  item_id: string;
  type: MovementType;
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
};

export type RegisterMovementResult =
  | { ok: true; quantity_current: number | null }
  | { ok: false; message: string };

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

  const qc = (data as { quantity_current?: unknown } | null)?.quantity_current;
  return { ok: true, quantity_current: qc == null ? null : Number(qc) };
}

