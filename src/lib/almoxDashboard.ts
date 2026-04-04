import type { createBrowserClient } from '@supabase/ssr';

type SupabaseClient = ReturnType<typeof createBrowserClient>;

export type AlmoxDashboardItem = {
  id: string;
  description: string;
  quantity_current: number;
  quantity_min: number;
  unit: string;
  category: string;
};

export type TopMoverRow = {
  item_id: string;
  description: string;
  unit: string;
  out_qty: number;
  movements_count: number;
};

export type AlmoxDashboardSnapshot = {
  items: AlmoxDashboardItem[];
  topOut: TopMoverRow[];
  totalOutLast30: number;
  totalInLast30: number;
  movementsLast30: number;
  error: string | null;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function fetchAlmoxDashboardSnapshot(
  supabase: SupabaseClient,
  userId: string,
  opts?: { outDays?: number; summaryDays?: number }
): Promise<AlmoxDashboardSnapshot> {
  const outDays = opts?.outDays ?? 90;
  const summaryDays = opts?.summaryDays ?? 30;

  const { data: itemRows, error: itemErr } = await supabase
    .from('items')
    .select('id, description, quantity_current, quantity_min, unit, category')
    .eq('user_id', userId);

  if (itemErr) {
    return {
      items: [],
      topOut: [],
      totalOutLast30: 0,
      totalInLast30: 0,
      movementsLast30: 0,
      error: itemErr.message,
    };
  }

  const items: AlmoxDashboardItem[] = (itemRows || []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    description: String(r.description ?? ''),
    quantity_current: Number(r.quantity_current ?? 0),
    quantity_min: Number(r.quantity_min ?? 0),
    unit: String(r.unit ?? 'un'),
    category: String(r.category ?? ''),
  }));

  const itemIds = items.map((i) => i.id);
  const descById = new Map(items.map((i) => [i.id, i.description]));
  const unitById = new Map(items.map((i) => [i.id, i.unit]));

  const sinceOut = new Date();
  sinceOut.setDate(sinceOut.getDate() - outDays);
  const sinceOutIso = sinceOut.toISOString();

  const sinceSum = new Date();
  sinceSum.setDate(sinceSum.getDate() - summaryDays);
  const sinceSumIso = sinceSum.toISOString();

  const outAgg = new Map<string, { qty: number; n: number }>();
  let totalOutLast30 = 0;
  let totalInLast30 = 0;
  let movementsLast30 = 0;

  if (itemIds.length > 0) {
    for (const slice of chunk(itemIds, 100)) {
      const { data: outRows, error: outErr } = await supabase
        .from('movements')
        .select('item_id, quantity, type, created_at')
        .in('item_id', slice)
        .eq('type', 'OUT')
        .gte('created_at', sinceOutIso);

      if (!outErr && outRows) {
        for (const m of outRows as { item_id: string; quantity: number }[]) {
          const cur = outAgg.get(m.item_id) || { qty: 0, n: 0 };
          cur.qty += Number(m.quantity ?? 0);
          cur.n += 1;
          outAgg.set(m.item_id, cur);
        }
      }

      const { data: sumRows, error: sumErr } = await supabase
        .from('movements')
        .select('quantity, type, created_at')
        .in('item_id', slice)
        .gte('created_at', sinceSumIso);

      if (!sumErr && sumRows) {
        for (const m of sumRows as { quantity: number; type: string }[]) {
          movementsLast30 += 1;
          const q = Number(m.quantity ?? 0);
          if (m.type === 'OUT') totalOutLast30 += q;
          if (m.type === 'IN') totalInLast30 += q;
        }
      }
    }
  }

  const topOut: TopMoverRow[] = [...outAgg.entries()]
    .map(([item_id, v]) => ({
      item_id,
      description: descById.get(item_id) || '—',
      unit: unitById.get(item_id) || 'un',
      out_qty: v.qty,
      movements_count: v.n,
    }))
    .sort((a, b) => b.out_qty - a.out_qty)
    .slice(0, 12);

  return {
    items,
    topOut,
    totalOutLast30,
    totalInLast30,
    movementsLast30,
    error: null,
  };
}
