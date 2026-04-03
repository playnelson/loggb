import type { createBrowserClient } from '@supabase/ssr';

type SupabaseClient = ReturnType<typeof createBrowserClient>;

export type KanbanColumnRow = {
  id: string;
  user_id: string;
  title: string;
  slug: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_KANBAN_COLUMNS: Array<{ title: string; slug: string; sort_order: number }> = [
  { title: 'Rascunho', slug: 'rascunho', sort_order: 0 },
  { title: 'Cotando', slug: 'cotando', sort_order: 1 },
  { title: 'Aprovado', slug: 'aprovado', sort_order: 2 },
  { title: 'Comprado', slug: 'comprado', sort_order: 3 },
  { title: 'Recebido', slug: 'recebido', sort_order: 4 },
  { title: 'Cancelado', slug: 'cancelado', sort_order: 5 },
];

/** Mapeia textos antigos de estágio para slug padrão. */
const LEGACY_TITLE_TO_SLUG: Record<string, string> = Object.fromEntries(
  DEFAULT_KANBAN_COLUMNS.map((c) => [c.title.toLowerCase(), c.slug])
);

export function stageTextToSlug(stage: string): string {
  const t = stage.trim().toLowerCase();
  return LEGACY_TITLE_TO_SLUG[t] ?? t.replace(/\s+/g, '_');
}

export function mapRowToColumn(r: Record<string, unknown>): KanbanColumnRow {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    title: String(r.title ?? ''),
    slug: String(r.slug ?? ''),
    sort_order: Number(r.sort_order ?? 0),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

export async function fetchKanbanColumns(
  supabase: SupabaseClient,
  userId: string
): Promise<{ columns: KanbanColumnRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from('kanban_columns')
    .select('id, user_id, title, slug, sort_order, created_at, updated_at')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });
  if (error) {
    if (error.code === '42P01' || String(error.message).toLowerCase().includes('kanban_columns')) {
      return { columns: [], error: null };
    }
    return { columns: [], error: error.message };
  }
  return { columns: (data || []).map((r: unknown) => mapRowToColumn(r as Record<string, unknown>)), error: null };
}

export async function ensureKanbanColumnsSeeded(
  supabase: SupabaseClient,
  userId: string
): Promise<{ columns: KanbanColumnRow[]; error: string | null }> {
  const first = await fetchKanbanColumns(supabase, userId);
  if (first.error) return first;
  if (first.columns.length > 0) return first;

  const rows = DEFAULT_KANBAN_COLUMNS.map((c) => ({
    user_id: userId,
    title: c.title,
    slug: c.slug,
    sort_order: c.sort_order,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }));

  const { error: insErr } = await supabase.from('kanban_columns').insert(rows);
  if (insErr) {
    return { columns: [], error: insErr.message };
  }
  return fetchKanbanColumns(supabase, userId);
}

export function resolveColumnIdForOrder(
  order: { kanban_column_id: string | null; stage: string },
  columns: KanbanColumnRow[]
): string | null {
  if (order.kanban_column_id && columns.some((c) => c.id === order.kanban_column_id)) {
    return order.kanban_column_id;
  }
  const slug = stageTextToSlug(order.stage);
  const bySlug = columns.find((c) => c.slug === slug);
  if (bySlug) return bySlug.id;
  const byTitle = columns.find((c) => c.title.toLowerCase() === order.stage.trim().toLowerCase());
  if (byTitle) return byTitle.id;
  return columns[0]?.id ?? null;
}
