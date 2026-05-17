import type { createBrowserClient } from '@supabase/ssr';

export type SupabaseBrowserClient = ReturnType<typeof createBrowserClient>;

/** Select de itens para o almoxarifado (posse aninhada). */
export const ITEMS_SELECT_WITHOUT_TAG =
  'id, code, description, category, location, consumable, unique_item, is_rented, quantity_current, quantity_min, unit, updated_at, user_id, possession (id, quantity, employee_id, employees (id, full_name))';

export const ITEMS_SELECT_WITH_TAG = ITEMS_SELECT_WITHOUT_TAG.replace(
  'unique_item,',
  'unique_item, tag,'
);

export const ITEMS_SELECT_LEGACY = ITEMS_SELECT_WITHOUT_TAG.replace('is_rented, ', '');

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

  let res = await run(ITEMS_SELECT_WITH_TAG);

  if (res.error?.message && isLikelyMissingColumn(res.error.message, 'tag')) {
    res = await run(ITEMS_SELECT_WITHOUT_TAG);
  }
  if (res.error?.message && isLikelyMissingColumn(res.error.message, 'is_rented')) {
    res = await run(ITEMS_SELECT_LEGACY);
  }

  return res;
}
