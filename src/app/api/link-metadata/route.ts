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
    return u;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url') || '';
  const u = safeUrl(url);
  if (!u) return Response.json({ error: 'URL inválida.' }, { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(u.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; LoggB/1.0; +https://example.local)',
        'accept': 'text/html,application/xhtml+xml',
      },
    });

    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      return Response.json({ error: `Falha ao acessar link (${res.status}).` }, { status: 502 });
    }
    if (!contentType.includes('text/html')) {
      return Response.json({ error: 'O link não retornou uma página HTML.' }, { status: 415 });
    }

    const html = await res.text();

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
      url: u.toString(),
      product_name: title || null,
      vendor: siteName || u.hostname,
      product_price: price || null,
    });
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : '';
    const msg = name === 'AbortError' ? 'Timeout ao acessar link.' : 'Erro ao acessar link.';
    return Response.json({ error: msg }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

