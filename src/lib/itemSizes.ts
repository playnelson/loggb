/*
  Botas e fardamentos: o tamanho vem no fim da descrição ("BOTINA 40", "BOTA Nº 42",
  "CALCA DE UNIFORME TAMANHO GG"). Daqui sai o tipo (para agrupar) e o tamanho (para a plaquinha).
*/

/** Palavras que indicam calçado ou roupa (só esses itens são agrupados por tamanho). */
const WEAR = /\b(BOTAS?|BOTINAS?|COTURNOS?|SAPATOS?|CALCAS?|CAMISAS?|CAMISETAS?|UNIFORMES?|FARDAS?|FARDAMENTOS?|JALECOS?|JAQUETAS?|BLUSAS?|MACACAO|MACACOES|BERMUDAS?|GANDOLAS?)\b/;

const LETTERS = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'EG', 'XGG', 'EGG', 'EXG', 'G1', 'G2', 'G3', 'G4'];

const SIZE_AT_END =
  /^(.*?)[\s\-–:,]*(?:\b(?:N\s*[º°ºO]|N\.|NUM\.?|NUMERO|TAM\.?|TAMANHO)\s*)?\b(\d{2}|PP|P|M|G|GG|XG|EG|XGG|EGG|EXG|G[1-4])$/;

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

export type ItemSize = {
  /** Tipo sem o tamanho, como está escrito (ex.: "CALCA DE UNIFORME"). */
  base: string;
  /** "40", "GG"… */
  size: string;
  numeric: boolean;
};

/** Separa o tamanho do fim da descrição. Só para calçados e roupas; nos outros itens devolve null. */
export function splitSize(description: string | null | undefined): ItemSize | null {
  const d = plain(String(description ?? ''));
  if (!d || !WEAR.test(d)) return null;
  const m = SIZE_AT_END.exec(d);
  if (!m) return null;
  const base = m[1].replace(/[\s\-–:,]+$/, '').trim();
  if (!base || !WEAR.test(base)) return null;
  const size = m[2];
  return { base, size, numeric: /^\d+$/.test(size) };
}

/** Texto da plaquinha: "Nº 40" ou "TAM GG". */
export function sizeLabel(s: ItemSize): string {
  return s.numeric ? `Nº ${s.size}` : `TAM ${s.size}`;
}

/** Ordem dos tamanhos: números crescentes; letras de PP a EXG. */
export function compareSizes(a: ItemSize | null, b: ItemSize | null): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  if (a.numeric && b.numeric) return Number(a.size) - Number(b.size);
  if (a.numeric !== b.numeric) return a.numeric ? -1 : 1;
  return LETTERS.indexOf(a.size) - LETTERS.indexOf(b.size);
}

/** "38 a 45" ou "M a GG" (ou só um tamanho). */
export function sizeRange(sizes: ItemSize[]): string {
  const sorted = [...sizes].sort(compareSizes);
  if (sorted.length === 0) return '';
  const a = sorted[0].size;
  const b = sorted[sorted.length - 1].size;
  return a === b ? a : `${a} a ${b}`;
}
