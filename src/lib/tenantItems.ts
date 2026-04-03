import type { createBrowserClient } from '@supabase/ssr';

export type SupabaseBrowserClient = ReturnType<typeof createBrowserClient>;

/** Select de itens para o almoxarifado (posse aninhada). Sem `ca_number` no banco, use legado. */
export const ITEMS_SELECT_WITHOUT_TAG_LEGACY =
  'id, code, description, category, location, consumable, unique_item, quantity_current, quantity_min, unit, updated_at, user_id, possession (id, quantity, employees (full_name))';

export const ITEMS_SELECT_WITH_TAG_LEGACY = ITEMS_SELECT_WITHOUT_TAG_LEGACY.replace(
  'unique_item,',
  'unique_item, tag,'
);

export const ITEMS_SELECT_WITHOUT_TAG = ITEMS_SELECT_WITHOUT_TAG_LEGACY.replace(
  'unit,',
  'unit, ca_number,'
);

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
 * Faz fallback se `tag` ou `ca_number` ainda não existirem no schema.
 */
export async function fetchTenantItems(supabase: SupabaseBrowserClient, userId: string) {
  const run = (sel: string) =>
    supabase.from('items').select(sel).eq('user_id', userId).order('description', { ascending: true });

  let res = await run(ITEMS_SELECT_WITH_TAG);

  if (res.error?.message && isLikelyMissingColumn(res.error.message, 'tag')) {
    res = await run(ITEMS_SELECT_WITHOUT_TAG);
  }
  if (res.error?.message && isLikelyMissingColumn(res.error.message, 'ca_number')) {
    res = await run(ITEMS_SELECT_WITH_TAG_LEGACY);
    if (res.error?.message && isLikelyMissingColumn(res.error.message, 'tag')) {
      res = await run(ITEMS_SELECT_WITHOUT_TAG_LEGACY);
    }
  }

  return res;
}
