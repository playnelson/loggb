/** Autocomplete: somente Mercado Livre (Brasil / MLB) via `/api/ml-search`. */
export type MlSearchHit = {
  id: string;
  title: string;
  subtitle: string | null;
  thumbnail: string | null;
  price: number | null;
  currency_id: string | null;
  permalink: string | null;
  condition: string | null;
  seller_nickname: string | null;
};

export async function fetchMlSearchSuggestions(q: string): Promise<{
  ok: boolean;
  results: MlSearchHit[];
  error?: string;
}> {
  const trimmed = q.trim();
  if (trimmed.length < 3) {
    return { ok: true, results: [] };
  }

  const res = await fetch(`/api/ml-search?q=${encodeURIComponent(trimmed)}&limit=5`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const json: unknown = await res.json();
  const obj = json as Record<string, unknown>;

  if (!res.ok) {
    return {
      ok: false,
      results: [],
      error: typeof obj.error === 'string' ? obj.error : 'Falha na busca.',
    };
  }

  const results = Array.isArray(obj.results) ? (obj.results as MlSearchHit[]) : [];
  return { ok: true, results };
}

export function formatMlPrice(price: number | null, currencyId: string | null): string {
  if (price == null || Number.isNaN(price)) return '';
  const cur = currencyId === 'BRL' || !currencyId ? 'BRL' : currencyId;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: cur }).format(price);
  } catch {
    return `${price} ${currencyId ?? ''}`.trim();
  }
}
