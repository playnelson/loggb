import {
  filterCatmatHits,
  loadCatmatCatalog,
  searchSinapi,
  type CatalogHit,
} from '@/lib/catalogSearchSources';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 3) {
    return Response.json({ error: 'Informe pelo menos 3 caracteres.', results: [] }, { status: 400 });
  }
  if (q.length > 200) {
    return Response.json({ error: 'Consulta muito longa.', results: [] }, { status: 400 });
  }

  const limit = Math.min(20, Math.max(1, Number(new URL(req.url).searchParams.get('limit')) || 8));

  let catmatErr: string | null = null;
  const catmatP = loadCatmatCatalog().catch((e) => {
    catmatErr = e instanceof Error ? e.message : 'CATMAT indisponível';
    return [] as CatalogHit[];
  });
  const sinP = searchSinapi(q, limit);
  const [catmatAll, sinHits] = await Promise.all([catmatP, sinP]);
  const catHits = filterCatmatHits(catmatAll, q, limit);

  const seen = new Set<string>();
  const merged: CatalogHit[] = [];
  for (const h of [...sinHits, ...catHits]) {
    const k = foldKey(h.title);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(h);
    if (merged.length >= limit) break;
  }

  if (merged.length === 0 && catmatErr && sinHits.length === 0) {
    return Response.json(
      {
        error: `${catmatErr}. SINAPI: defina SINAPI_API_BASE_URL e SINAPI_API_KEY para buscar na sua instância autoSINAPI.`,
        results: [],
      },
      { status: 502 }
    );
  }

  return Response.json({ results: merged });
}

function foldKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
