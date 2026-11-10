import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { requireUser } from '@/lib/apiAuth';

export const runtime = 'nodejs';

const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 1_000_000; // 1 MB é mais que suficiente para ler <head>
const TIMEOUT_MS = 8000;

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return decodeHtmlEntities(m[1].trim());
  }
  return null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (u.port && u.port !== '80' && u.port !== '443') return null;
    return u;
  } catch {
    return null;
  }
}

/** IPv4/IPv6 que nunca devem ser acessados pelo servidor (rede interna, loopback, metadados de nuvem etc.). */
function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // link-local / metadados de nuvem
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true; // multicast / reservado / broadcast
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    if (s.startsWith('::ffff:')) return true; // forma hexadecimal de IPv4 mapeado
    if (/^f[cd]/.test(s)) return true; // fc00::/7 (ULA)
    if (/^fe[89ab]/.test(s)) return true; // fe80::/10 (link-local)
    if (s.startsWith('ff')) return true; // multicast
    return false;
  }
  return true;
}

/** Resolve o host e recusa se qualquer endereço for interno. */
async function assertPublicHost(u: URL): Promise<void> {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new BlockedHostError();
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (addrs.length === 0 || addrs.some((a) => isBlockedIp(a.address))) {
    throw new BlockedHostError();
  }
}

class BlockedHostError extends Error {
  constructor() {
    super('Endereço não permitido.');
    this.name = 'BlockedHostError';
  }
}

/** Faz o fetch seguindo redirecionamentos manualmente, validando o destino a cada salto. */
async function fetchPublic(start: URL, signal: AbortSignal): Promise<{ res: Response; finalUrl: URL }> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current);
    const res = await fetch(current.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; LoggB/1.0)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await res.body?.cancel();
      const next = loc ? safeUrl(new URL(loc, current).toString()) : null;
      if (!next) throw new BlockedHostError();
      current = next;
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new Error('Redirecionamentos demais.');
}

/** Lê no máximo `limit` bytes do corpo (evita baixar arquivos enormes). */
async function readLimitedText(res: Response, limit: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, limit));
}

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url') || '';
  const u = safeUrl(url);
  if (!u) return Response.json({ error: 'URL inválida.' }, { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const { res, finalUrl } = await fetchPublic(u, controller.signal);

    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      await res.body?.cancel();
      return Response.json({ error: `Falha ao acessar link (${res.status}).` }, { status: 502 });
    }
    if (!contentType.includes('text/html')) {
      await res.body?.cancel();
      return Response.json({ error: 'O link não retornou uma página HTML.' }, { status: 415 });
    }

    const html = await readLimitedText(res, MAX_HTML_BYTES);

    // Prefer Open Graph / Twitter tags
    const ogTitle = firstMatch(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    ]);

    const title = ogTitle || firstMatch(html, [/<title[^>]*>([^<]+)<\/title>/i]);

    const siteName = firstMatch(html, [
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    ]);

    const price = firstMatch(html, [
      /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+name=["']twitter:data1["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    ]);

    return Response.json({
      url: finalUrl.toString(),
      product_name: title || null,
      vendor: siteName || finalUrl.hostname,
      product_price: price || null,
    });
  } catch (err: unknown) {
    if (err instanceof BlockedHostError) {
      return Response.json({ error: 'Este endereço não é permitido.' }, { status: 400 });
    }
    const name = err instanceof Error ? err.name : '';
    const msg = name === 'AbortError' ? 'Timeout ao acessar link.' : 'Erro ao acessar link.';
    return Response.json({ error: msg }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
