/**
 * Proxy de busca pública no Mercado Livre (site MLB por padrão).
 * A busca por `q=` é recurso público; OAuth é opcional. Enviar Bearer de
 * client_credentials primeiro costuma gerar 403 em alguns casos; datacenters
 * também filtram User-Agent “bot”. Por isso: tentar sem auth + UA de navegador,
 * depois com token se necessário.
 */

import { getMercadoLibreBearer } from '@/lib/mercadolibreAccessToken';

const ML_API = 'https://api.mercadolibre.com';

export const dynamic = 'force-dynamic';

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
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
    let res: Response;
    if (bearer) {
      // Com credenciais: muitos IPs de datacenter só aceitam a busca com Bearer válido.
      res = await fetchMl(bearer);
      if (!res.ok && (res.status === 403 || res.status === 401)) {
        res = await fetchMl(null);
      }
    } else {
      // Sem token: endpoint público (quando o ML não bloqueia o IP).
      res = await fetchMl(null);
    }

    if (!res.ok) {
      let errMsg =
        res.status === 403
          ? 'Mercado Livre recusou a busca (403). Confira se fez redeploy no Vercel após definir MERCADOLIBRE_CLIENT_ID e MERCADOLIBRE_CLIENT_SECRET (ou MERCADOLIBRE_ACCESS_TOKEN). Credenciais no painel de desenvolvedores do Mercado Livre.'
          : `Mercado Livre retornou ${res.status}.`;
      if (oauthError) {
        errMsg += ` OAuth: ${oauthError}`;
      } else if (!bearer && !process.env.MERCADOLIBRE_ACCESS_TOKEN?.trim()) {
        const hasId = Boolean(process.env.MERCADOLIBRE_CLIENT_ID?.trim());
        const hasSecret = Boolean(process.env.MERCADOLIBRE_CLIENT_SECRET?.trim());
        if (!hasId || !hasSecret) {
          errMsg +=
            ' Não há token: faltam MERCADOLIBRE_CLIENT_ID / MERCADOLIBRE_CLIENT_SECRET no ambiente em runtime (redeploy após salvar no Vercel).';
        }
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
