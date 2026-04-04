/** Ordem de compra (4 dígitos) informada pelo setor de compras. */

export function normalizeOcNumberInput(raw: string): string | null {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  if (d.length === 0) return null;
  if (d.length !== 4) return null;
  return d;
}

/** Exibe OC sempre com 4 caracteres (padding à esquerda se vier legado). */
export function formatOcForDisplay(v: string | null | undefined): string | null {
  if (v == null || String(v).trim() === '') return null;
  const d = String(v).replace(/\D/g, '').slice(0, 4);
  if (d.length === 0) return null;
  return d.padStart(4, '0').slice(-4);
}
