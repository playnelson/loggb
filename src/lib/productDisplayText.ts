/** Padrão visual: nomes de produto / descrição em MAIÚSCULAS, sem acentos (pt-BR). */

/** Remove marcas diacríticas (á→a, ç→c, ã→a, etc.). */
export function stripDiacritics(raw: string): string {
  return String(raw ?? '').normalize('NFD').replace(/\p{M}/gu, '');
}

export function normalizeProductLabelForSave(raw: string): string {
  const t = stripDiacritics(String(raw ?? '').trim());
  if (!t) return '';
  return t.toLocaleUpperCase('pt-BR');
}

/** Exibição — normaliza para o mesmo padrão (inclui dados antigos em caixa mista). */
export function formatProductLabelDisplay(raw: string | null | undefined): string {
  if (raw == null) return '';
  return normalizeProductLabelForSave(String(raw));
}
