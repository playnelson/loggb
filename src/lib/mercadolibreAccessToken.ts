/**
 * Bearer para chamadas à API do Mercado Livre.
 * Prioridade: MERCADOLIBRE_ACCESS_TOKEN → client_credentials com ID+secret (cache em memória).
 */

const ML_API = 'https://api.mercadolibre.com';

type CachedToken = { token: string; expiresAtMs: number };
let cached: CachedToken | null = null;
const EXPIRY_SKEW_MS = 120_000;

export async function getMercadoLibreBearer(): Promise<{ token: string | null; oauthError?: string }> {
  const manual = process.env.MERCADOLIBRE_ACCESS_TOKEN?.trim();
  if (manual) return { token: manual };

  const clientId = process.env.MERCADOLIBRE_CLIENT_ID?.trim();
  const clientSecret = process.env.MERCADOLIBRE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return { token: null };
  }

  const now = Date.now();
  if (cached && cached.expiresAtMs > now) {
    return { token: cached.token };
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const res = await fetch(`${ML_API}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      cache: 'no-store',
    });

    const json = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      const msg =
        typeof json.message === 'string'
          ? json.message
          : typeof json.error === 'string'
            ? json.error
            : `HTTP ${res.status}`;
      return { token: null, oauthError: msg };
    }

    const accessToken = typeof json.access_token === 'string' ? json.access_token : null;
    const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;

    if (!accessToken) {
      return { token: null, oauthError: 'Resposta OAuth sem access_token.' };
    }

    cached = {
      token: accessToken,
      expiresAtMs: now + Math.max(60, expiresIn) * 1000 - EXPIRY_SKEW_MS,
    };
    return { token: accessToken };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao obter token';
    return { token: null, oauthError: msg };
  }
}
