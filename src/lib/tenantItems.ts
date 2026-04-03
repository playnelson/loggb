import type { createBrowserClient } from '@supabase/ssr';

export type SupabaseBrowserClient = ReturnType<typeof createBrowserClient>;

/** Select de itens para o almoxarifado (posse aninhada). */
export const ITEMS_SELECT_WITHOUT_TAG =
  'id, code, description, category, location, consumable, unique_item, quantity_current, quantity_min, unit, updated_at, user_id, possession (id, quantity, employees (full_name))';

export const ITEMS_SELECT_WITH_TAG = ITEMS_SELECT_WITHOUT_TAG.replace(
  'unique_item,',
  'unique_item, tag,'
);

export function isLikelyMissingColumn(errMessage: string, column: string): boolean {
  const m = errMessage.toLowerCase();
  const c = column.toLowerCase();
  return (m.includes('column') && m.includes(c)) || (m.includes('does not exist') && m.includes(c));
}

/**
 * Lista itens do tenant (auth user). Sem `user_id` no banco, use o fluxo de “vincular órfãos” em Configurações.
 * Se a coluna `tag` não existir, repete o select sem ela.
 */
export async function fetchTenantItems(supabase: SupabaseBrowserClient, userId: string) {
  let res = await supabase
    .from('items')
    .select(ITEMS_SELECT_WITH_TAG)
    .eq('user_id', userId)
    .order('description', { ascending: true });

  if (res.error?.message && isLikelyMissingColumn(res.error.message, 'tag')) {
    res = await supabase
      .from('items')
      .select(ITEMS_SELECT_WITHOUT_TAG)
      .eq('user_id', userId)
      .order('description', { ascending: true });
  }

  return res;
}
