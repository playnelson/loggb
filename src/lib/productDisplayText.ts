/** Padrão visual: nomes de produto / descrição sempre em maiúsculas (pt-BR). */

export function normalizeProductLabelForSave(raw: string): string {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  return t.toLocaleUpperCase('pt-BR');
}

/** Exibição — normaliza para o mesmo padrão (inclui dados antigos em caixa mista). */
export function formatProductLabelDisplay(raw: string | null | undefined): string {
  if (raw == null) return '';
  return normalizeProductLabelForSave(String(raw));
}
