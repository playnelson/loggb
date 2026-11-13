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

const PAGE = 1000;

/** Lê todas as páginas de uma consulta (a API do Supabase devolve no máximo 1000 linhas por vez). */
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return { rows, error: null };
}

/** Motivo da linha; linhas antigas sem `reason` são deduzidas do tipo. */
function reasonOf(m: { reason?: string | null; type?: string; employee_id?: string | null; work_site_id?: string | null }) {
  if (m.reason) return m.reason;
  const hasParty = Boolean(m.employee_id || m.work_site_id);
  if (m.type === 'OUT') return hasParty ? 'saida' : 'ajuste';
  return hasParty ? 'devolucao' : 'entrada';
}

export async function fetchAlmoxDashboardSnapshot(
  supabase: SupabaseClient,
  userId: string,
  opts?: { outDays?: number; summaryDays?: number }
): Promise<AlmoxDashboardSnapshot> {
  const outDays = opts?.outDays ?? 90;
  const summaryDays = opts?.summaryDays ?? 30;

  const { rows: itemRows, error: itemErr } = await readAll<Record<string, unknown>>((from, to) =>
    supabase
      .from('items')
      .select('id, description, quantity_current, quantity_min, unit, category')
      .is('archived_at', null)
      .order('id', { ascending: true })
      .range(from, to)
  );

  if (itemErr) {
    return {
      items: [],
      topOut: [],
      totalOutLast30: 0,
      totalInLast30: 0,
      movementsLast30: 0,
      error: itemErr,
    };
  }

  const items: AlmoxDashboardItem[] = itemRows.map((r) => ({
    id: String(r.id),
    description: String(r.description ?? ''),
    quantity_current: Number(r.quantity_current ?? 0),
    quantity_min: Number(r.quantity_min ?? 0),
    unit: String(r.unit ?? 'un'),
    category: String(r.category ?? ''),
  }));

  const sinceOut = new Date();
  sinceOut.setDate(sinceOut.getDate() - outDays);
  const sinceOutIso = sinceOut.toISOString();

  const sinceSum = new Date();
  sinceSum.setDate(sinceSum.getDate() - summaryDays);
  const sinceSumMs = sinceSum.getTime();

  type MoveRow = {
    item_id: string;
    quantity: number;
    type: string;
    reason?: string | null;
    employee_id?: string | null;
    work_site_id?: string | null;
    created_at: string;
    items?: { description?: string; unit?: string } | null;
  };

  // Uma única leitura paginada dos movimentos do período (o RLS já limita à conta do usuário).
  const { rows: moves } = await readAll<MoveRow>((from, to) =>
    supabase
      .from('movements')
      .select('item_id, quantity, type, reason, employee_id, work_site_id, created_at, items(description, unit)')
      .gte('created_at', sinceOutIso)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
  );

  const outAgg = new Map<string, { qty: number; n: number; description: string; unit: string }>();
  let totalOutLast30 = 0;
  let totalInLast30 = 0;
  let movementsLast30 = 0;

  for (const m of moves) {
    const reason = reasonOf(m);
    const q = Number(m.quantity ?? 0);
    if (reason === 'saida') {
      const cur = outAgg.get(m.item_id) || {
        qty: 0,
        n: 0,
        description: String(m.items?.description ?? '—'),
        unit: String(m.items?.unit ?? 'un'),
      };
      cur.qty += q;
      cur.n += 1;
      outAgg.set(m.item_id, cur);
    }
    if (new Date(m.created_at).getTime() >= sinceSumMs) {
      movementsLast30 += 1;
      // Só conta saída real (para colaborador/local) e entrada real (recebimento) —
      // devoluções, ajustes e descartes não inflam os totais.
      if (reason === 'saida') totalOutLast30 += q;
      if (reason === 'entrada') totalInLast30 += q;
    }
  }

  const topOut: TopMoverRow[] = [...outAgg.entries()]
    .map(([item_id, v]) => ({
      item_id,
      description: v.description,
      unit: v.unit,
      out_qty: Math.round(v.qty * 1000) / 1000,
      movements_count: v.n,
    }))
    .sort((a, b) => b.out_qty - a.out_qty)
    .slice(0, 12);

  return {
    items,
    topOut,
    totalOutLast30: Math.round(totalOutLast30 * 1000) / 1000,
    totalInLast30: Math.round(totalInLast30 * 1000) / 1000,
    movementsLast30,
    error: null,
  };
}
