/**
 * Fontes do autocomplete de materiais:
 * - CATMAT (Compras Gov): JSON públicos em ant-rod-silva/catmat_compras_gov → catmat_compras_gov_pub
 * - SINAPI: API autoSINAPI (LAMP-LUCAS/autoSINAPI_API), opcional via env
 */

export type CatalogHit = {
  id: string;
  title: string;
  subtitle: string | null;
  thumbnail: string | null;
  price: number | null;
  currency_id: string | null;
  permalink: string | null;
  condition: string | null;
  seller_nickname: string | null;
  source: 'catmat' | 'sinapi_insumo' | 'sinapi_composicao';
};

const CATMAT_OWNER = 'ant-rod-silva';
const CATMAT_REPO = 'catmat_compras_gov_pub';
const CATMAT_REF = 'master';
const CATMAT_JSON_API = `https://api.github.com/repos/${CATMAT_OWNER}/${CATMAT_REPO}/contents/json?ref=${CATMAT_REF}`;

type RawCatmatItem = {
  'Código do Item'?: number;
  'Descrição do Item'?: string;
  Grupo?: string;
  Status?: string;
};

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

let catmatLoadPromise: Promise<CatalogHit[]> | null = null;

async function fetchJsonFiles(urls: string[]): Promise<RawCatmatItem[][]> {
  const batches = chunk(urls, 24);
  const all: RawCatmatItem[][] = [];
  for (const batch of batches) {
    const parts = await Promise.all(
      batch.map(async (u) => {
        try {
          const r = await fetch(u, { cache: 'no-store' });
          if (!r.ok) return [];
          const data: unknown = await r.json();
          return Array.isArray(data) ? (data as RawCatmatItem[]) : [];
        } catch {
          return [];
        }
      })
    );
    all.push(...parts);
  }
  return all;
}

/** Carrega todos os grupos CATMAT (cache por instância serverless). */
export function loadCatmatCatalog(): Promise<CatalogHit[]> {
  if (!catmatLoadPromise) {
    const p = (async () => {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'LoggB-catalog-search/1.0',
      };
      const tok = process.env.GITHUB_TOKEN?.trim();
      if (tok) headers.Authorization = `Bearer ${tok}`;

      const res = await fetch(CATMAT_JSON_API, { headers, cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`CATMAT: listagem GitHub ${res.status}`);
      }
      const listing: unknown = await res.json();
      if (!Array.isArray(listing)) {
        throw new Error('CATMAT: resposta de listagem inválida');
      }

      const urls = listing
        .filter(
          (x): x is { download_url: string; name: string; type: string } =>
            Boolean(x && typeof x === 'object' && (x as { type?: string }).type === 'file') &&
            typeof (x as { name?: string }).name === 'string' &&
            (x as { name: string }).name.endsWith('.json') &&
            typeof (x as { download_url?: string }).download_url === 'string'
        )
        .map((x) => x.download_url);

      const fileContents = await fetchJsonFiles(urls);
      const hits: CatalogHit[] = [];

      for (const rows of fileContents) {
        for (const row of rows) {
          const cod = row['Código do Item'];
          const desc = row['Descrição do Item'];
          if (typeof cod !== 'number' || typeof desc !== 'string' || !desc.trim()) continue;
          const st = row.Status;
          if (typeof st === 'string' && st.trim() && fold(st) !== 'ativo') continue;

          hits.push({
            id: `catmat-${cod}`,
            title: desc.trim(),
            subtitle: row.Grupo ? `CATMAT · ${row.Grupo}` : 'CATMAT · Compras Gov',
            thumbnail: null,
            price: null,
            currency_id: null,
            permalink: null,
            condition: null,
            seller_nickname: null,
            source: 'catmat',
          });
        }
      }

      return hits;
    })();
    catmatLoadPromise = p;
    void p.catch(() => {
      catmatLoadPromise = null;
    });
  }
  return catmatLoadPromise;
}

type SinapiInsumo = { codigo: number; descricao: string; unidade: string; preco_mediano?: number | null };
type SinapiComposicao = { codigo: number; descricao: string; unidade: string; custo_total?: number | null };

function sinapiBase(): string | null {
  const b = process.env.SINAPI_API_BASE_URL?.trim();
  return b ? b.replace(/\/$/, '') : null;
}

export async function searchSinapi(q: string, limit: number): Promise<CatalogHit[]> {
  const base = sinapiBase();
  const key = process.env.SINAPI_API_KEY?.trim();
  if (!base || !key) return [];

  const uf = (process.env.SINAPI_UF || 'SP').trim().slice(0, 2).toUpperCase() || 'SP';
  const dataRef =
    (process.env.SINAPI_DATA_REFERENCIA || '2025-09').trim() || '2025-09';
  const regime = (process.env.SINAPI_REGIME || 'NAO_DESONERADO').trim() || 'NAO_DESONERADO';

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-API-KEY': key,
  };

  const qEnc = encodeURIComponent(q);
  const insUrl = `${base}/insumos/?q=${qEnc}&uf=${uf}&data_referencia=${encodeURIComponent(dataRef)}&regime=${encodeURIComponent(regime)}&skip=0&limit=${limit}`;
  const compUrl = `${base}/composicoes/?q=${qEnc}&uf=${uf}&data_referencia=${encodeURIComponent(dataRef)}&regime=${encodeURIComponent(regime)}&skip=0&limit=${limit}`;

  const [insRes, compRes] = await Promise.all([
    fetch(insUrl, { headers, cache: 'no-store' }),
    fetch(compUrl, { headers, cache: 'no-store' }),
  ]);

  const out: CatalogHit[] = [];

  if (insRes.ok) {
    const data: unknown = await insRes.json();
    if (Array.isArray(data)) {
      for (const row of data as SinapiInsumo[]) {
        if (typeof row.codigo !== 'number' || typeof row.descricao !== 'string') continue;
        out.push({
          id: `sinapi-i-${row.codigo}`,
          title: row.descricao.trim(),
          subtitle: `SINAPI insumo · ${row.unidade ?? '—'} · ${uf} ${dataRef}`,
          thumbnail: null,
          price: typeof row.preco_mediano === 'number' ? row.preco_mediano : null,
          currency_id: 'BRL',
          permalink: null,
          condition: null,
          seller_nickname: null,
          source: 'sinapi_insumo',
        });
      }
    }
  }

  if (compRes.ok) {
    const data: unknown = await compRes.json();
    if (Array.isArray(data)) {
      for (const row of data as SinapiComposicao[]) {
        if (typeof row.codigo !== 'number' || typeof row.descricao !== 'string') continue;
        out.push({
          id: `sinapi-c-${row.codigo}`,
          title: row.descricao.trim(),
          subtitle: `SINAPI composição · ${row.unidade ?? '—'} · ${uf} ${dataRef}`,
          thumbnail: null,
          price: typeof row.custo_total === 'number' ? row.custo_total : null,
          currency_id: 'BRL',
          permalink: null,
          condition: null,
          seller_nickname: null,
          source: 'sinapi_composicao',
        });
      }
    }
  }

  return out.slice(0, limit);
}

export function filterCatmatHits(rows: CatalogHit[], q: string, limit: number): CatalogHit[] {
  const f = fold(q.trim());
  if (!f) return [];
  const words = f.split(/\s+/).filter(Boolean);
  const scored: { h: CatalogHit; n: number }[] = [];
  for (const h of rows) {
    const t = fold(h.title);
    if (!words.every((w) => t.includes(w))) continue;
    let n = 0;
    if (t.startsWith(f)) n += 100;
    n += Math.min(h.title.length, 200);
    scored.push({ h, n });
  }
  scored.sort((a, b) => b.n - a.n);
  return scored.slice(0, limit).map((x) => x.h);
}
