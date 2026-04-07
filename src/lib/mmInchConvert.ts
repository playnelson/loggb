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

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export type InchFractionApprox = {
  sign: 1 | -1;
  whole: number;
  num: number;
  den: number;
  /** Erro absoluto em polegadas vs. valor decimal original (com sinal considerado). */
  errorInches: number;
};

/**
 * Aproxima polegadas decimais por fração com denominador até `maxDen` (ex.: 32, 64).
 * Útil para exibir equivalente SAE ao lado do decimal.
 */
export function decimalInchesToApproxFraction(
  inches: number,
  maxDen: 16 | 32 | 64 | 128 = 64
): InchFractionApprox | null {
  if (!Number.isFinite(inches)) return null;
  const sign: 1 | -1 = inches < 0 ? -1 : 1;
  let x = Math.abs(inches);
  const whole = Math.floor(x + 1e-12);
  let frac = x - whole;
  if (frac < 1e-12) {
    return { sign, whole, num: 0, den: 1, errorInches: Math.abs(inches - sign * whole) };
  }
  let bestNum = 0;
  let bestDen = 1;
  let bestErr = Infinity;
  for (let den = 1; den <= maxDen; den++) {
    const num = Math.round(frac * den);
    if (num < 0 || num > den) continue;
    const err = Math.abs(frac - num / den);
    if (err < bestErr) {
      bestErr = err;
      bestNum = num;
      bestDen = den;
    }
  }
  const g = gcd(bestNum, bestDen);
  bestNum /= g;
  bestDen /= g;
  const approx = whole + bestNum / bestDen;
  const value = sign * approx;
  return {
    sign,
    whole,
    num: bestNum,
    den: bestDen,
    errorInches: Math.abs(inches - value),
  };
}

/** Ex.: ~1 3/8" ou 3/8" */
export function formatFractionInchesLabel(approx: InchFractionApprox, showApproxPrefix: boolean): string {
  const { sign, whole, num, den } = approx;
  if (num === 0) {
    return `${sign < 0 ? '-' : ''}${whole}"`;
  }
  const frac = `${num}/${den}`;
  if (whole === 0) {
    return `${showApproxPrefix ? '≈ ' : ''}${sign < 0 ? '-' : ''}${frac}"`;
  }
  return `${showApproxPrefix ? '≈ ' : ''}${sign < 0 ? '-' : ''}${whole} ${frac}"`;
}

/**
 * Aceita: "1,5", "1/2", "3/8", "1 3/8", "1-3/8", "2"
 */
export function parseInchFraction(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;

  if (/^\d+[.,]\d+$/.test(t.replace(/\s/g, ''))) {
    return parseLocaleNumber(t);
  }

  let s = t.replace(/\s+/g, ' ').replace(/,/g, '.');

  const pureDec = parseLocaleNumber(s);
  if (pureDec !== null && !s.includes('/') && !/\d\s+\d/.test(s)) {
    return pureDec;
  }

  let sign = 1;
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1).trim();
  }

  const mixedHyphen = /^(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (mixedHyphen) {
    const w = Number(mixedHyphen[1]);
    const n = Number(mixedHyphen[2]);
    const d = Number(mixedHyphen[3]);
    if (!Number.isFinite(w) || !Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return sign * (w + n / d);
  }

  const mixedSpace = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (mixedSpace) {
    const w = Number(mixedSpace[1]);
    const n = Number(mixedSpace[2]);
    const d = Number(mixedSpace[3]);
    if (!Number.isFinite(w) || !Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return sign * (w + n / d);
  }

  const fracOnly = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (fracOnly) {
    const n = Number(fracOnly[1]);
    const d = Number(fracOnly[2]);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return sign * (n / d);
  }

  const wholeOnly = /^(\d+)$/.exec(s);
  if (wholeOnly) {
    const w = Number(wholeOnly[1]);
    return sign * w;
  }

  const dec2 = parseLocaleNumber(s);
  return dec2 !== null ? sign * Math.abs(dec2) : null;
}

/** mm para exibição (pt-BR). */
export function formatMm(mm: number, maxDecimals?: number): string {
  if (!Number.isFinite(mm)) return '';
  const abs = Math.abs(mm);
  const decimals =
    maxDecimals ??
    (abs >= 100 ? 2 : abs >= 1 ? 3 : 4);
  return mm.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/** Polegadas decimais para exibição. */
export function formatInches(inches: number, maxDecimals = 6): string {
  if (!Number.isFinite(inches)) return '';
  return inches.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

/** Tenta decimal primeiro; se falhar, aceita fração SAE (1 3/8, 3/8, …). */
export function parseInchInput(raw: string): number | null {
  const direct = parseLocaleNumber(raw);
  if (direct !== null) return direct;
  return parseInchFraction(raw);
}
