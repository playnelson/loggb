/** Autocomplete CATMAT (GitHub) + SINAPI opcional via `/api/catalog-search`. */

export type CatalogSearchHit = {
  id: string;
  title: string;
  subtitle: string | null;
  thumbnail: string | null;
  price: number | null;
  currency_id: string | null;
  permalink: string | null;
  condition: string | null;
  seller_nickname: string | null;
  source?: 'catmat' | 'sinapi_insumo' | 'sinapi_composicao';
};

export async function fetchCatalogSearchSuggestions(q: string): Promise<{
  ok: boolean;
  results: CatalogSearchHit[];
  error?: string;
}> {
  const trimmed = q.trim();
  if (trimmed.length < 3) {
    return { ok: true, results: [] };
  }

  const res = await fetch(`/api/catalog-search?q=${encodeURIComponent(trimmed)}&limit=8`, {
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

  const results = Array.isArray(obj.results) ? (obj.results as CatalogSearchHit[]) : [];
  return { ok: true, results };
}

export function formatCatalogPrice(price: number | null, currencyId: string | null): string {
  if (price == null || Number.isNaN(price)) return '';
  const cur = currencyId === 'BRL' || !currencyId ? 'BRL' : currencyId;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: cur }).format(price);
  } catch {
    return `${price} ${currencyId ?? ''}`.trim();
  }
}
