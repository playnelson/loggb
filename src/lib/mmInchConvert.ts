/** Polegada internacional exata (pol → mm). */
export const MM_PER_INCH = 25.4;

export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH;
}

export function inchesToMm(inches: number): number {
  return inches * MM_PER_INCH;
}

export function parseLocaleNumber(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '' || t === '-' || t === '.' || t === '-.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** mm para exibição (pt-BR). */
export function formatMm(mm: number): string {
  if (!Number.isFinite(mm)) return '';
  const abs = Math.abs(mm);
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 3 : 4;
  return mm.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/** Polegadas decimais para exibição. */
export function formatInches(inches: number): string {
  if (!Number.isFinite(inches)) return '';
  return inches.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}
