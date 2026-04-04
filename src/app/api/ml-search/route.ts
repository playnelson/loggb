/**
 * Proxy de busca pública no Mercado Livre (site MLB por padrão).
 * Documentação: https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/busca-de-produtos
 */

import { getMercadoLibreBearer } from '@/lib/mercadolibreAccessToken';

const ML_API = 'https://api.mercadolibre.com';

function normalizeThumb(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const u = url.startsWith('http:') ? `https${url.slice(4)}` : url;
  return u.replace('-I.jpg', '-O.jpg');
}

function thumbFromResult(r: Record<string, unknown>): string | null {
  const direct =
    normalizeThumb(typeof r.thumbnail === 'string' ? r.thumbnail : null) ||
    normalizeThumb(typeof r.secure_thumbnail === 'string' ? r.secure_thumbnail : null);
  if (direct) return direct;
  const pics = r.pictures;
  if (!Array.isArray(pics) || pics.length === 0) return null;
  const first = pics[0] as Record<string, unknown>;
  const url =
    (typeof first.secure_url === 'string' ? first.secure_url : null) ||
    (typeof first.url === 'string' ? first.url : null);
  return normalizeThumb(url);
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 3) {
    return Response.json({ error: 'Informe pelo menos 3 caracteres.', results: [] }, { status: 400 });
  }
  if (q.length > 200) {
    return Response.json({ error: 'Consulta muito longa.', results: [] }, { status: 400 });
  }

  const site =
    (process.env.MERCADOLIBRE_SITE_ID || 'MLB').replace(/[^A-Z0-9_-]/gi, '') || 'MLB';
  const limit = Math.min(20, Math.max(1, Number(new URL(req.url).searchParams.get('limit')) || 5));

  const url = `${ML_API}/sites/${site}/search?q=${encodeURIComponent(q)}&limit=${limit}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);

  const { token: bearer, oauthError } = await getMercadoLibreBearer();

  const baseHeaders: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (compatible; LoggB/1.0; +https://developers.mercadolivre.com.br) AppleWebKit/537.36',
  };

  const fetchMl = (authToken: string | null) => {
    const h = { ...baseHeaders };
    if (authToken) h.Authorization = `Bearer ${authToken}`;
    return fetch(url, {
      method: 'GET',
      headers: h,
      signal: controller.signal,
      cache: 'no-store',
    });
  };

  try {
    let res = await fetchMl(bearer);
    if (res.status === 403 && bearer) {
      res = await fetchMl(null);
    }

    if (!res.ok) {
      let errMsg =
        res.status === 403
          ? 'Mercado Livre recusou a busca (403). Em produção (Vercel etc.), defina MERCADOLIBRE_CLIENT_ID e MERCADOLIBRE_CLIENT_SECRET nas variáveis de ambiente, ou MERCADOLIBRE_ACCESS_TOKEN. Localmente use .env.local e reinicie o servidor.'
          : `Mercado Livre retornou ${res.status}.`;
      if (oauthError && !bearer) {
        errMsg += ` OAuth: ${oauthError}`;
      }
      return Response.json({ error: errMsg, results: [] }, { status: 502 });
    }

    const data = (await res.json()) as { results?: unknown[] };
    const raw = Array.isArray(data.results) ? data.results : [];

    const results = raw.map((row) => {
      const r = row as Record<string, unknown>;
      const id = r.id != null ? String(r.id) : '';
      const title = typeof r.title === 'string' ? r.title : '';
      const subtitle = typeof r.subtitle === 'string' ? r.subtitle : null;
      const thumb = thumbFromResult(r);
      const price = typeof r.price === 'number' ? r.price : null;
      const currency_id = typeof r.currency_id === 'string' ? r.currency_id : null;
      const permalink = typeof r.permalink === 'string' ? r.permalink : null;
      const condition = typeof r.condition === 'string' ? r.condition : null;
      const seller = r.seller && typeof r.seller === 'object' ? (r.seller as Record<string, unknown>) : null;
      const sellerNickname =
        seller && typeof seller.nickname === 'string' ? seller.nickname : null;

      return {
        id,
        title,
        subtitle,
        thumbnail: thumb,
        price,
        currency_id,
        permalink,
        condition,
        seller_nickname: sellerNickname,
      };
    }).filter((x) => x.id && x.title);

    return Response.json({ results, site_id: site });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return Response.json({ error: msg, results: [] }, { status: 502 });
  } finally {
    clearTimeout(t);
  }
}
