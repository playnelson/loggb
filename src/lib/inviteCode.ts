/** Chave curta do convite (etapa 11): 8 letras/números, mostrada como XXXX-XXXX. */
export function formatInviteCode(code: string | null | undefined): string {
  const c = String(code ?? '').toUpperCase();
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export type ParsedInvite = { kind: 'token'; token: string } | { kind: 'code'; code: string } | null;

/**
 * Entende o que a pessoa colou: o link inteiro (…/convite/<token>),
 * só o token comprido ou a chave curta (com ou sem traço).
 */
export function parseInviteInput(raw: string): ParsedInvite {
  const text = raw.trim();
  if (!text) return null;
  const fromLink = text.match(/\/convite\/([A-Za-z0-9]+)/);
  if (fromLink) return { kind: 'token', token: fromLink[1] };
  const compact = text.replace(/[^A-Za-z0-9]/g, '');
  if (/^[0-9a-f]{32,}$/i.test(compact)) return { kind: 'token', token: compact.toLowerCase() };
  if (compact.length === 8) return { kind: 'code', code: compact.toUpperCase() };
  return null;
}
