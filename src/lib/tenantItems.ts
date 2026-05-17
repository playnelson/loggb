import type { createBrowserClient } from '@supabase/ssr';

export type SupabaseBrowserClient = ReturnType<typeof createBrowserClient>;

/** Select de itens para o almoxarifado (posse aninhada). */
export const ITEMS_SELECT_WITHOUT_TAG =
  'id, code, description, category, location, consumable, unique_item, is_rented, calibration_due_date, expiration_date, quantity_current, quantity_min, unit, updated_at, user_id, possession (id, quantity, employee_id, employees (id, full_name))';

export const ITEMS_SELECT_WITH_TAG = ITEMS_SELECT_WITHOUT_TAG.replace(
  'unique_item,',
  'unique_item, tag,'
);

export const ITEMS_SELECT_LEGACY = ITEMS_SELECT_WITHOUT_TAG.replace('is_rented, ', '');
export const ITEMS_SELECT_WITHOUT_DATES = ITEMS_SELECT_WITHOUT_TAG.replace(
  'calibration_due_date, expiration_date, ',
  ''
);
export const ITEMS_SELECT_LEGACY_WITHOUT_DATES = ITEMS_SELECT_LEGACY.replace(
  'calibration_due_date, expiration_date, ',
  ''
);

export function isLikelyMissingColumn(errMessage: string, column: string): boolean {
  const m = errMessage.toLowerCase();
  const c = column.toLowerCase();
  return (m.includes('column') && m.includes(c)) || (m.includes('does not exist') && m.includes(c));
}

/**
 * Lista itens do tenant (auth user). Sem `user_id` no banco, use o fluxo de “vincular órfãos” em Configurações.
 * Faz fallback se `tag` ainda não existir no schema.
 */
export async function fetchTenantItems(supabase: SupabaseBrowserClient, userId: string) {
  const run = (sel: string) =>
    supabase.from('items').select(sel).eq('user_id', userId).order('description', { ascending: true });

  const candidates = [
    ITEMS_SELECT_WITH_TAG,
    ITEMS_SELECT_WITHOUT_TAG,
    ITEMS_SELECT_WITHOUT_DATES,
    ITEMS_SELECT_LEGACY,
    ITEMS_SELECT_LEGACY_WITHOUT_DATES,
  ];

  let res = await run(candidates[0]);
  for (let i = 1; i < candidates.length; i++) {
    if (!res.error?.message) break;
    const msg = res.error.message;
    const isOptionalColumnError =
      isLikelyMissingColumn(msg, 'tag') ||
      isLikelyMissingColumn(msg, 'is_rented') ||
      isLikelyMissingColumn(msg, 'calibration_due_date') ||
      isLikelyMissingColumn(msg, 'expiration_date');
    if (!isOptionalColumnError) break;
    res = await run(candidates[i]);
  }

  return res;
}
