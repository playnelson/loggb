/**
 * Extrai campos de ordens de compra a partir do texto de PDFs (layout típico ERP / OC brasileira).
 */

export interface ParsedPurchaseOrderItem {
  line_number: number;
  description: string;
  quantity: number | null;
  unit: string | null;
}

export interface ParsedPurchaseOrder {
  oc_number: string | null;
  buyer_code: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  vendor_name: string | null;
  /** Nome do vendedor e telefone em um único texto (como no PDF). */
  vendor_contact_name: string | null;
  delivery_deadline: string | null;
  title: string | null;
  items: ParsedPurchaseOrderItem[];
}

// ---------------------------------------------------------------------------
// Extração posicional — usa coordenadas X/Y reais do pdf.js para reconstruir
// a tabela independente da ordem de serialização do texto.
// ---------------------------------------------------------------------------

export interface PositionedTextItem {
  text: string;
  x: number; // coordenada X da página (pontos)
  y: number; // coordenada Y top-down (0 = topo do documento)
}

function brNumberToFloat(raw: string): number | null {
  const t = raw.trim();
  if (!/^[\d.,]+$/.test(t)) return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  let s: string;
  if (lastComma > lastDot) s = t.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma) s = t.replace(/,/g, '');
  else s = t;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function normalizeForHeuristic(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function normalizeDescriptionText(desc: string): string {
  let t = desc.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i++) {
    const next = t.replace(
      /\b((?:[A-Za-zÀ-ÿ0-9"/.-]+\s+){1,5}[A-Za-zÀ-ÿ0-9"/.-]+)(?:\s+\1){1,}\b/gi,
      '$1'
    );
    if (next === t) break;
    t = next;
  }
  return t.trim();
}

function stripNonItemTailFromDescription(desc: string): string {
  let t = desc.replace(/\s+/g, ' ').trim();
  if (!t) return t;

  const stopPatterns: RegExp[] = [
    /\s+(?:RUA|RODOVIA|AVENIDA|ENDERE[CÇ]O)\b/i,
    /\s+N(?:[UÚ]MERO|RO)?\s*:\s*/i,
    /\s+CIDADE\s*:\s*/i,
    /\s+BAIRRO\s*:\s*/i,
    /\s+CEP\s*:\s*/i,
    /\s+(?:TELEFONE|TEL\.?|CELULAR)\s*:\s*/i,
    /\s+[A-Za-zÀ-ÿ]{3,}\s+TELEFONE\s*:\s*/i,
    /\s+EMAIL\s*:\s*/i,
    /\s+CNPJ\s*:\s*/i,
    /\s+IE\s*:\s*/i,
    /\s+COND\.?\s*PAGTO\b/i,
    /\s+TIPO\s*PAGTO\b/i,
    /\s+SOLICITA[ÇC][AÃ]O\s+DE\s+MATERIAL\b/i,
    /\s+PARA\s+ABASTECER\b/i,
    /\s+ALMOXARIFADO\b/i,
    /\s+JUSTIFICATIVA\b/i,
  ];

  let cut = t.length;
  for (const re of stopPatterns) {
    const m = re.exec(t);
    if (m?.index != null && m.index >= 10) {
      cut = Math.min(cut, m.index);
    }
  }
  if (cut < t.length) t = t.slice(0, cut).trim();
  return t;
}

function isLikelyNonItemMetadataLine(line: string): boolean {
  const t = line.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (
    /\b(?:ENDERE[CÇ]O|RUA|RODOVIA|AVENIDA|CIDADE|BAIRRO|CEP|TELEFONE|CELULAR|EMAIL|CNPJ|COND\.?\s*PAGTO|TIPO\s*PAGTO|SOLICITA[ÇC][AÃ]O\s+DE\s+MATERIAL|ABASTECER|ALMOXARIFADO|JUSTIFICATIVA)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (/\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{3,4}/.test(t)) return true;
  return false;
}

function isHardTableEndLine(line: string): boolean {
  const t = line.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return /\b(?:OBSERVA[ÇC][AÃ]O(?:ES)?|SOLICITA[ÇC][AÃ]O\s+DE\s+MATERIAL|JUSTIFICATIVA|COND\.?\s*PAGTO|TIPO\s*PAGTO|ENDERE[CÇ]O|RUA|RODOVIA|CIDADE|BAIRRO|CEP|TELEFONE|CELULAR|EMAIL|CNPJ)\b/i.test(
    t
  );
}

const GROUP_SPLIT_ANCHORS = [
  'CHAVE',
  'FITA',
  'TESOURA',
  'ESTILETE',
  'LENTE',
  'PERNEIRA',
  'AVENTAL',
  'BROCA',
  'DISCO',
  'PARAFUSO',
  'PORCA',
  'ARRUELA',
  'ALICATE',
  'MARTELO',
  'OXIGENIO',
  'MASCARA',
  'LUVA',
  'REGUA',
  'MARCA TEXTO',
];

function isLikelyGroupedDescription(desc: string): boolean {
  const t = normalizeForHeuristic(desc);
  if (t.length < 95) return false;
  let anchorHits = 0;
  for (const a of GROUP_SPLIT_ANCHORS) {
    if (new RegExp(`\\b${a}\\b`, 'i').test(t)) anchorHits += 1;
  }
  const repeatedCa = t.match(/\bC\.?\s*A[-:\s]?\d{3,6}\b/gi)?.length || 0;
  const manyEnumerations = t.match(/\b\d+\s*(?:CAIXA|CX|UN|UND|FITA|LENTE|AVENTAL|PERNEIRA)\b/gi)?.length || 0;
  return anchorHits >= 3 || repeatedCa >= 4 || manyEnumerations >= 2;
}

function splitGroupedDescription(desc: string): string[] {
  const normalized = normalizeForHeuristic(desc);
  const starts = [0];
  for (const a of GROUP_SPLIT_ANCHORS) {
    const re = new RegExp(`\\b${a}\\b`, 'gi');
    for (const m of normalized.matchAll(re)) {
      const idx = m.index ?? -1;
      if (idx > 18) starts.push(idx);
    }
  }
  const uniqueStarts = [...new Set(starts)].sort((a, b) => a - b);
  if (uniqueStarts.length <= 1) return [desc.trim()];

  const parts: string[] = [];
  for (let i = 0; i < uniqueStarts.length; i++) {
    const start = uniqueStarts[i];
    const end = uniqueStarts[i + 1] ?? desc.length;
    const p = desc.slice(start, end).replace(/\s+/g, ' ').trim();
    if (p.length >= 10) parts.push(p);
  }
  if (parts.length <= 1) return [desc.trim()];

  // Junta fragmentos muito pequenos ao bloco anterior.
  const merged: string[] = [];
  for (const p of parts) {
    if (p.length < 14 && merged.length) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${p}`.trim();
      continue;
    }
    merged.push(p);
  }
  return merged.length > 1 ? merged : [desc.trim()];
}

export function refineParsedItems(
  items: ParsedPurchaseOrderItem[]
): ParsedPurchaseOrderItem[] {
  const penalty = (arr: ParsedPurchaseOrderItem[]) => {
    const missingQty = arr.filter((i) => i.quantity == null).length;
    const missingUnit = arr.filter((i) => !(i.unit && String(i.unit).trim())).length;
    const longDesc = arr.filter((i) => i.description.length > 120).length;
    const groupedSuspicion = arr.filter((i) => isLikelyGroupedDescription(i.description)).length;
    const seen = new Set<number>();
    let duplicates = 0;
    for (const i of arr) {
      if (seen.has(i.line_number)) duplicates += 1;
      seen.add(i.line_number);
    }
    return missingQty + missingUnit + longDesc * 2 + groupedSuspicion * 2 + duplicates;
  };

  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.line_number - b.line_number);
  const last = sorted[sorted.length - 1];
  if (!last || !isLikelyGroupedDescription(last.description) || sorted.length < 3) return sorted;

  const segments = splitGroupedDescription(last.description);
  if (segments.length <= 1) return sorted;

  const baseLine = Number.isFinite(last.line_number) ? last.line_number : sorted.length;
  const replaced = sorted.slice(0, -1);
  segments.forEach((seg, idx) => {
    replaced.push({
      line_number: baseLine + idx,
      description: normalizeDescriptionText(seg),
      quantity: idx === 0 ? last.quantity : null,
      unit: idx === 0 ? last.unit : null,
    });
  });
  return penalty(replaced) < penalty(sorted) ? replaced : sorted;
}

export function scoreParsedItemsQuality(items: ParsedPurchaseOrderItem[]): number {
  const missingQty = items.filter((i) => i.quantity == null).length;
  const missingUnit = items.filter((i) => !(i.unit && String(i.unit).trim())).length;
  const longDesc = items.filter((i) => i.description.length > 120).length;
  const groupedSuspicion = items.filter((i) => isLikelyGroupedDescription(i.description)).length;
  const seen = new Set<number>();
  let duplicates = 0;
  for (const i of items) {
    if (seen.has(i.line_number)) duplicates += 1;
    seen.add(i.line_number);
  }
  return (
    missingQty +
    missingUnit +
    longDesc +
    groupedSuspicion * 2 +
    duplicates +
    (items.length === 0 ? 10 : 0)
  );
}

export interface ParsedItemsDiagnostics {
  itemCount: number;
  missingQty: number;
  missingUnit: number;
  longDesc: number;
  groupedSuspicion: number;
  duplicateLineNumbers: number;
  nonMonotonicLineNumbers: number;
  repeatedDescriptionPatterns: number;
  largeLineJumps: number;
  qualityScore: number;
}

export type ParsedItemsConfidence = 'high' | 'medium' | 'low';

export function analyzeParsedItems(items: ParsedPurchaseOrderItem[]): ParsedItemsDiagnostics {
  const sorted = [...items].sort((a, b) => a.line_number - b.line_number);
  const missingQty = sorted.filter((i) => i.quantity == null).length;
  const missingUnit = sorted.filter((i) => !(i.unit && String(i.unit).trim())).length;
  const longDesc = sorted.filter((i) => i.description.length > 120).length;
  const groupedSuspicion = sorted.filter((i) => isLikelyGroupedDescription(i.description)).length;

  const seen = new Set<number>();
  let duplicateLineNumbers = 0;
  for (const i of sorted) {
    if (seen.has(i.line_number)) duplicateLineNumbers += 1;
    seen.add(i.line_number);
  }

  let nonMonotonicLineNumbers = 0;
  let largeLineJumps = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i].line_number - sorted[i - 1].line_number;
    if (diff < 0) nonMonotonicLineNumbers += 1;
    if (diff > 3) largeLineJumps += 1;
  }

  const repeatedDescriptionPatterns = sorted.filter((i) =>
    /\b((?:[A-Za-zÀ-ÿ0-9"/.-]+\s+){2,6}[A-Za-zÀ-ÿ0-9"/.-]+)\s+\1\b/i.test(
      normalizeDescriptionText(i.description)
    )
  ).length;

  const qualityScore = scoreParsedItemsQuality(sorted);
  return {
    itemCount: sorted.length,
    missingQty,
    missingUnit,
    longDesc,
    groupedSuspicion,
    duplicateLineNumbers,
    nonMonotonicLineNumbers,
    repeatedDescriptionPatterns,
    largeLineJumps,
    qualityScore,
  };
}

export function parsedItemsConfidence(
  diagnostics: ParsedItemsDiagnostics
): ParsedItemsConfidence {
  if (
    diagnostics.itemCount === 0 ||
    diagnostics.duplicateLineNumbers > 0 ||
    diagnostics.nonMonotonicLineNumbers > 0
  ) {
    return 'low';
  }

  const missingUnitRatio =
    diagnostics.itemCount > 0 ? diagnostics.missingUnit / diagnostics.itemCount : 1;
  if (
    diagnostics.groupedSuspicion > 0 ||
    diagnostics.repeatedDescriptionPatterns > 0 ||
    missingUnitRatio > 0.3 ||
    diagnostics.largeLineJumps > 2
  ) {
    return 'low';
  }

  if (
    diagnostics.missingQty > 0 ||
    diagnostics.missingUnit > 0 ||
    diagnostics.longDesc > 0 ||
    diagnostics.largeLineJumps > 0
  ) {
    return 'medium';
  }

  return 'high';
}

export interface ParsedItemsCandidate {
  source: string;
  items: ParsedPurchaseOrderItem[];
}

export interface SelectedParsedItems {
  source: string;
  items: ParsedPurchaseOrderItem[];
  diagnostics: ParsedItemsDiagnostics;
  confidence: ParsedItemsConfidence;
}

export function selectBestParsedItems(
  candidates: ParsedItemsCandidate[]
): SelectedParsedItems | null {
  const nonEmpty = candidates.filter((c) => c.items.length > 0);
  if (!nonEmpty.length) return null;

  const counts = nonEmpty.map((c) => c.items.length).sort((a, b) => a - b);
  const medianCount = counts[Math.floor(counts.length / 2)] || counts[0] || 1;
  const maxCountByConsensus = Math.max(medianCount + 8, Math.ceil(medianCount * 2));

  const withDiag = nonEmpty.map((c) => {
    const diagnostics = analyzeParsedItems(c.items);
    const confidence = parsedItemsConfidence(diagnostics);
    const missingQtyRatio =
      diagnostics.itemCount > 0 ? diagnostics.missingQty / diagnostics.itemCount : 1;
    const missingUnitRatio =
      diagnostics.itemCount > 0 ? diagnostics.missingUnit / diagnostics.itemCount : 1;
    const coverageValid = diagnostics.itemCount <= maxCountByConsensus;
    const contractValid =
      diagnostics.itemCount > 0 &&
      coverageValid &&
      diagnostics.duplicateLineNumbers === 0 &&
      diagnostics.nonMonotonicLineNumbers === 0 &&
      missingQtyRatio <= 0.45 &&
      missingUnitRatio <= 0.45;
    return { ...c, diagnostics, confidence, contractValid };
  });

  const validPool = withDiag.some((c) => c.contractValid)
    ? withDiag.filter((c) => c.contractValid)
    : withDiag;

  let best = validPool[0];
  for (const c of validPool.slice(1)) {
    const strictBetter = c.diagnostics.qualityScore < best.diagnostics.qualityScore;
    const tieWithMoreItems =
      c.diagnostics.qualityScore === best.diagnostics.qualityScore &&
      c.items.length > best.items.length;
    const highCoverageNearQuality =
      c.items.length >= best.items.length + 3 &&
      c.diagnostics.qualityScore <= best.diagnostics.qualityScore + 1;
    const controlledCoverage =
      c.items.length <= Math.max(best.items.length + 6, Math.ceil(best.items.length * 2));

    if (strictBetter || tieWithMoreItems || (highCoverageNearQuality && controlledCoverage)) {
      best = c;
    }
  }

  return {
    source: best.source,
    items: best.items,
    diagnostics: best.diagnostics,
    confidence: best.confidence,
  };
}

/**
 * Dado o conjunto de tokens de texto com suas posições X/Y,
 * reconstrói a tabela de itens da OC identificando as colunas
 * por posição (ITEM, DESCRIÇÃO, UND., QTD.) em vez de heurística de texto.
 */
export function extractItemsFromPositionedItems(
  items: PositionedTextItem[]
): ParsedPurchaseOrderItem[] {
  if (items.length === 0) return [];

  const Y_TOL = 3;
  const X_TOL = 30;

  const normalizeKey = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[.]/g, '');

  const unitSet = new Set([
    'UN',
    'UND',
    'PC',
    'PÇ',
    'PAR',
    'CX',
    'KG',
    'G',
    'M',
    'M2',
    'M3',
    'LT',
    'L',
    'ML',
  ]);

  const isItemNumber = (s: string) => {
    const t = s.trim().replace(/[.)-]+$/, '');
    if (!/^\d{1,3}$/.test(t)) return false;
    const n = parseInt(t, 10);
    return n > 0 && n <= 999;
  };

  const parseItemNumber = (s: string) => parseInt(s.trim().replace(/[.)-]+$/, ''), 10);

  const isQtyToken = (s: string) => brNumberToFloat(s) != null;
  const looksLikeSpillover = (s: string) => {
    if (!s) return false;
    const t = s.trim();
    if (!t) return false;
    if (/\b\d+\s*-\s*(CAIXA|CX|UN|UND|FITA|LENTE|AVENTAL|PERNEIRA)\b/i.test(t)) return true;
    const caHits = t.match(/\bC\.?\s*A[-:\s]?\d{3,6}\b/gi)?.length || 0;
    if (caHits >= 3) return true;
    if (
      t.length > 90 &&
      /\b(MODELO|INDUSTRIA|DEWALT|ESAB|HANDYGAS|OXIGENIO|OXIGÊNIO)\b/i.test(t)
    ) {
      return true;
    }
    return false;
  };

  // Agrupa por linhas (Y).
  const rowMap = new Map<number, { x: number; text: string }[]>();
  for (const it of items) {
    let rowY = -1;
    for (const ry of rowMap.keys()) {
      if (Math.abs(ry - it.y) <= Y_TOL) {
        rowY = ry;
        break;
      }
    }
    if (rowY < 0) {
      rowY = it.y;
      rowMap.set(rowY, []);
    }
    rowMap.get(rowY)!.push({ x: it.x, text: it.text });
  }

  const rows = [...rowMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([y, cells]) => ({ y, cells: [...cells].sort((a, b) => a.x - b.x) }));

  // 1) Tenta achar cabeçalho para definir início da grade.
  let startIdx = 0;
  for (let i = 0; i < rows.length; i++) {
    const joined = normalizeKey(rows[i].cells.map((c) => c.text).join(' '));
    if (joined.includes('ITEM') && joined.includes('DESCRI') && joined.includes('QTD')) {
      startIdx = i + 1;
      break;
    }
  }

  // 2) Estima coluna UND (x) pelos dados.
  const unitXs: number[] = [];
  for (const row of rows.slice(startIdx, startIdx + 260)) {
    for (const c of row.cells) {
      const k = normalizeKey(c.text);
      if (unitSet.has(k)) unitXs.push(c.x);
    }
  }
  if (!unitXs.length) return [];
  const avg = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length;
  const unitX = avg(unitXs);

  // 3) Estima coluna ITEM com base em linhas que parecem item real:
  // têm UND na coluna esperada e um número curto à esquerda.
  const itemXs: number[] = [];
  for (const row of rows.slice(startIdx, startIdx + 260)) {
    const hasUnitInCol = row.cells.some(
      (c) => Math.abs(c.x - unitX) <= X_TOL && unitSet.has(normalizeKey(c.text))
    );
    if (!hasUnitInCol) continue;
    const candidates = row.cells
      .filter((c) => c.x < unitX - X_TOL && isItemNumber(c.text))
      .sort((a, b) => a.x - b.x);
    if (candidates.length) itemXs.push(candidates[0].x);
  }
  if (!itemXs.length) return [];
  const itemX = avg(itemXs);

  const result: ParsedPurchaseOrderItem[] = [];
  let current: ParsedPurchaseOrderItem | null = null;

  const flush = () => {
    if (!current) return;
    current.description = normalizeDescriptionText(
      stripNonItemTailFromDescription(current.description)
    );
    if (current.description.length >= 2) result.push(current);
    current = null;
  };

  for (const row of rows.slice(startIdx)) {
    const rawRowText = row.cells.map((c) => c.text).join(' ');
    const rowText = normalizeKey(rawRowText);
    // Regra de negócio: terminou a tabela, terminam os itens.
    if (rowText.includes('OBSERVACAO') || rowText.includes('OBSERVACOES') || isHardTableEndLine(rawRowText)) {
      break;
    }

    const hasUnitInExpectedCol = row.cells.some(
      (c) => Math.abs(c.x - unitX) <= X_TOL && unitSet.has(normalizeKey(c.text))
    );

    const lineCandidates = row.cells
      .filter((c) => Math.abs(c.x - itemX) <= X_TOL && isItemNumber(c.text))
      .sort((a, b) => a.x - b.x);
    const lineCell = lineCandidates[0];

    // Fallback: em alguns PDFs o número do item "anda" no eixo X.
    // Se houver UND na coluna esperada e algum número plausível à esquerda,
    // tratamos a linha como início de novo item mesmo fora da janela do itemX.
    const fallbackItemCell = hasUnitInExpectedCol
      ? row.cells
          .filter((c) => c.x < unitX - X_TOL && isItemNumber(c.text))
          .sort((a, b) => a.x - b.x)[0]
      : undefined;
    let effectiveLineCell = lineCell || fallbackItemCell;

    // Heurística extra: se a linha não bateu coluna ITEM, mas contém um número
    // plausível de sequência à esquerda, trata como novo item (evita colar muitos
    // produtos no último item quando o PDF desloca a coluna ITEM).
    if (!effectiveLineCell && current) {
      const currentLine = current.line_number;
      const seqCandidate = row.cells
        .filter((c) => c.x < unitX - X_TOL && isItemNumber(c.text))
        .map((c) => ({ cell: c, n: parseItemNumber(c.text) }))
        .filter((v) => v.n > currentLine && v.n <= currentLine + 3)
        .sort((a, b) => a.n - b.n)[0];
      if (seqCandidate) effectiveLineCell = seqCandidate.cell;
    }

    if (!effectiveLineCell) {
      // Continuação de descrição em linha seguinte.
      if (current) {
        const continuation = row.cells
          .filter((c) => c.x > itemX + 6 && c.x < unitX - 8)
          .map((c) => c.text)
          .join(' ')
          .trim();
        if (continuation) {
          if (current.description.length > 110) continue;
          if (looksLikeSpillover(continuation)) continue;
          if (isLikelyNonItemMetadataLine(continuation)) continue;
          current.description = `${current.description} ${continuation}`.trim();
        }
      }
      continue;
    }

    flush();

    let lineNumber = parseItemNumber(effectiveLineCell.text);
    if (!Number.isFinite(lineNumber) || lineNumber <= 0) {
      lineNumber = current ? current.line_number + 1 : result.length + 1;
    }

    const desc = row.cells
      .filter((c) => c.x > itemX + 6 && c.x < unitX - 8)
      .map((c) => c.text)
      .join(' ')
      .trim();

    let unit: string | null = null;
    const unitCell = row.cells.find((c) => Math.abs(c.x - unitX) <= X_TOL && unitSet.has(normalizeKey(c.text)));
    if (unitCell) {
      const u = normalizeKey(unitCell.text).toLowerCase();
      unit = u === 'und' ? 'un' : u;
    }

    // QTD: primeiro número à direita da UND; se não achar, tenta número logo à esquerda.
    let quantity: number | null = null;
    if (unitCell) {
      const rightNums = row.cells
        .filter((c) => c.x > unitCell.x + 8)
        .map((c) => ({ x: c.x, q: brNumberToFloat(c.text) }))
        .filter((v) => v.q != null) as { x: number; q: number }[];
      if (rightNums.length) {
        rightNums.sort((a, b) => a.x - b.x);
        quantity = rightNums[0].q;
      } else {
        const leftNums = row.cells
          .filter((c) => c.x < unitCell.x - 8)
          .map((c) => ({ x: c.x, q: brNumberToFloat(c.text) }))
          .filter((v) => v.q != null) as { x: number; q: number }[];
        if (leftNums.length) {
          leftNums.sort((a, b) => b.x - a.x);
          quantity = leftNums[0].q;
        }
      }
    } else {
      // Sem UND na linha: tenta o primeiro número à direita da descrição.
      const nums = row.cells
        .filter((c) => c.x > unitX - X_TOL && isQtyToken(c.text))
        .map((c) => ({ x: c.x, q: brNumberToFloat(c.text)! }))
        .sort((a, b) => a.x - b.x);
      if (nums.length) quantity = nums[0].q;
    }

    current = {
      line_number: lineNumber,
      description: normalizeDescriptionText(stripNonItemTailFromDescription(desc)),
      quantity,
      unit: unit || (quantity != null ? 'un' : null),
    };
  }
  flush();

  return refineParsedItems(result.sort((a, b) => a.line_number - b.line_number));
}

// ---------------------------------------------------------------------------

const PHONE_LINE =
  /^(?:\(?\d{2}\)?\s*)?\d{4,5}[-.\s]?\d{3,4}(?:\s*\/\s*(?:\(?\d{2}\)?\s*)?\d{4,5}[-.\s]?\d{3,4})?$/;
const GARBLED_PHONE = /^\d{2,3}\d{3,4}-\d{6,}\d{2,3}-\d{3,4}$/;

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function findGridMarkerIndex(text: string): number {
  const patterns: RegExp[] = [
    /TOTAL\s*DESCRIÇÃO\s*QTD\.?/i,
    /DESCRIÇÃO\s*QTD\.?/i,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m?.index != null) return m.index + m[0].length;
  }
  return -1;
}

/** Dois telefones colados no PDF (ex.: 843317-0145843316-2223). */
function splitConcatenatedPhones(s: string): string {
  const t = s.replace(/\s/g, '');
  const m = t.match(/^(\d{2}\d{4,6}-\d{4})(\d{2}\d{4,6}-\d{4})$/);
  if (m) return `${m[1]} / ${m[2]}`;
  return s;
}

function parseBrDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function stripLeadingZerosOc(n: string): string {
  const t = n.replace(/\D/g, '');
  if (!t) return n;
  const stripped = t.replace(/^0+/, '') || '0';
  return stripped;
}

export function ocNumberFromFilename(name: string): string | null {
  const base = name.replace(/\.[^.]+$/i, '');
  const m = base.match(/\bOC\s*[-_]?\s*(\d{3,8})\b/i) || base.match(/(\d{4,8})/);
  return m ? stripLeadingZerosOc(m[1]) : null;
}

/** Título exibido na OC: nome do arquivo sem pasta e sem extensão (ex.: .pdf). */
export function titleFromSourceFilename(sourceFilename: string): string | null {
  const base = sourceFilename.replace(/^.*[/\\]/, '').trim();
  if (!base) return null;
  const withoutExt = base.replace(/\.[^.]+$/i, '').trim();
  return withoutExt || base;
}

function extractOcNumber(text: string): string | null {
  const patterns: RegExp[] = [
    /No\.?\s*Ordem\s*Compra\s*\n\s*(\d{4,12})/i,
    /No\.?\s*Ordem\s*Compra\s+(\d{4,12})/i,
    /Ordem\s*de\s*Compra[^\d]{0,40}(\d{5,12})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return stripLeadingZerosOc(m[1]);
  }
  return null;
}

function extractBuyer(text: string): { code: string | null; name: string | null } {
  const block = text.match(/Comprador\s*:\s*\n\s*(\S+)\s+([^\n]+)/i);
  if (block) {
    return { code: block[1].trim(), name: normalizeWs(block[2]) };
  }
  const inline = text.match(/Comprador\s*:\s*(\S+)\s+([^\n]+)/i);
  if (inline) {
    return { code: inline[1].trim(), name: normalizeWs(inline[2]) };
  }
  return { code: null, name: null };
}

/** Somente data de entrega no PDF (vários layouts de extração). */
function extractDeliveryDeadline(text: string): string | null {
  const direct = text.match(
    /Data\s*Entrega\s*[:\s]*([\d]{2}\/[\d]{2}\/[\d]{4})/i
  );
  if (direct?.[1]) {
    const parsed = parseBrDate(direct[1]);
    if (parsed) return parsed;
  }

  const compact = text.match(
    /DataEntrega\s*[:\s]*([\d]{2}\/[\d]{2}\/[\d]{4})/i
  );
  if (compact?.[1]) {
    const parsed = parseBrDate(compact[1]);
    if (parsed) return parsed;
  }

  const patterns: RegExp[] = [
    /Data\s*Entrega\s*:\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s*Entrega\s*:\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s+de\s+Entrega\s*:\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Entrega\s*:\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s*Entrega\s*[:\s]+\s*(\d{2}\/\d{2}\/\d{4})/i,
    /ITEM\s*\n\s*BOLETO\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return parseBrDate(m[1]);
  }
  return null;
}

function itemStartLine(line: string): { num: number; rest: string } | null {
  // Com espaço: a descrição deve começar com letra/citação (evita "84 99986-0896" como item 84).
  const m = line.match(/^(\d+)\s+([A-Za-zÀ-ÿ"'.].*)$/);
  if (m) return { num: parseInt(m[1], 10), rest: m[2].trim() };
  // Colado ao número: 1CHAVE, 10MORSA (PDFs sem espaço entre nº e texto).
  const m2 = line.match(/^(\d+)([A-Za-zÀ-ÿ"'.].*)$/);
  if (m2) return { num: parseInt(m2[1], 10), rest: m2[2].trim() };
  return null;
}

/** Evita CEP/códigos colados ao PDF (ex.: 59600340CEP :) serem tratados como linha de item. */
function isPlausibleItemStart(st: { num: number; rest: string }): boolean {
  if (st.num <= 0) return false;
  if (st.num > 999) return false;
  if (st.rest.length < 3) return false;
  if (/^CEPT?\s*:?\s*$/i.test(st.rest)) return false;
  if (/^PARCELAS?\b/i.test(st.rest)) return false;
  if (/^DIAS?\b/i.test(st.rest.trim())) return false;
  if (/^Rua\b/i.test(st.rest.trim())) return false;
  if (/^Rodovia\b/i.test(st.rest.trim())) return false;
  if (/^x\d/i.test(st.rest.trim())) return false;
  if (/^UNR?\$/i.test(st.rest.trim())) return false;
  return true;
}

function isJunkContinuation(line: string): boolean {
  if (!line || line.length < 2) return true;
  if (/^OBSERV/i.test(line)) return true;
  if (/^SUB-TOTAL/i.test(line)) return true;
  if (/^R\$\s*0,00$/.test(line)) return true;
  if (/^R\$\d/.test(line)) return true;
  if (/^UND\.?$|^DESC\.?$/i.test(line)) return true;
  if (/^\d+,\d+UNR?\$/i.test(line)) return true;
  if (/^\d{10,}/.test(line.replace(/\D/g, '')) && line.length > 14) return true;
  if (/^\d{5}-\d{3}\b/.test(line)) return true;
  if (/^\d+Rua\b/i.test(line)) return true;
  if (/^\d{1,4}Rodovia\b/i.test(line)) return true;
  if (/^Rodovia\b/i.test(line)) return true;
  if (/\bRodovia\b/i.test(line) && /\b(papagaio|canto|km\s*\d|BR-?\d)/i.test(line)) return true;
  if (/^RN[A-Za-zÀ-ú]/i.test(line)) return true;
  if (/Mossoró|Macau|Betânia|Zona\s+Rural/i.test(line)) return true;
  return false;
}

/** Corta trecho de rodapé/endereço colado na descrição pelo fluxo do PDF (ex.: "900ML 35Rodovia Canto…"). */
function stripAddressNoiseFromDescription(s: string): string {
  let t = s;
  const cutNumRodo = /\s+\d{1,4}Rodovia\b/i.exec(t);
  if (cutNumRodo?.index != null) t = t.slice(0, cutNumRodo.index);
  else {
    const cutRodo = /\s+Rodovia\b/i.exec(t);
    if (cutRodo?.index != null && /\b(papagaio|canto do|BR-?\d|km\s*\d)/i.test(t.slice(cutRodo.index))) {
      t = t.slice(0, cutRodo.index);
    }
  }
  const cutRua = /\s+Rua\s+[A-Za-zÀ-ÿ0-9]/i.exec(t);
  if (cutRua?.index != null) t = t.slice(0, cutRua.index);
  return normalizeWs(t);
}

/** Unidade + quantidade no fim da linha (colunas UND. e QTD. do PDF), não volume na descrição (ex.: 2,7L). */
const GRID_UNIT_TOKEN =
  '(?:UN|UND\\.?|PAR|PÇ|PC|PT|CX|FD|SC|GL|LT|MT|M2|M3|KG|G|ML|BD)';

function parseBrazilianQuantityToken(raw: string): number | null {
  const t = raw.trim();
  if (!/^[\d.,]+$/.test(t)) return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    normalized = t;
  } else if (lastComma > lastDot) {
    normalized = t.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    normalized = t.replace(/,/g, '');
  } else {
    normalized = t.replace(',', '.');
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Ajusta colagens comuns do pdf-parse entre volume, UND e QTD. */
function normalizeGridTailGlitches(s: string): string {
  let d = s;
  d = d.replace(/(\d+(?:[.,]\d+)?)(ML|LT|L)(?=UN\.?\s*[\d.,])/gi, '$1$2 ');
  d = d.replace(/\b(UN|UND\.?)(?=[\d.,])/gi, '$1 ');
  d = d.replace(/([\d.,]{2,})(UN\.?)(?=\s|$|[\d.,])/gi, '$1 $2');
  return d;
}

function stripTrailingCurrencyToken(s: string): string {
  return s.replace(/\s+R\$\s*[\d.,]+\s*$/gi, '').trim();
}

function extractQtyUnitFromGridTail(desc: string): {
  description: string;
  quantity: number | null;
  unit: string | null;
} {
  const work = normalizeGridTailGlitches(stripTrailingCurrencyToken(desc.trim()));

  // Busca o ultimo par UND/QTD da linha, sem exigir que esteja exatamente no final.
  // Em alguns PDFs o texto traz "UN 15,0000 R$ 163,0273 0,00 2.445,41".
  const unitThenQty = new RegExp(`\\b(${GRID_UNIT_TOKEN})\\s*([\\d.,]+)\\b`, 'gi');
  const qtyThenUnit = new RegExp(`\\b([\\d.,]+)\\s*(${GRID_UNIT_TOKEN})\\b`, 'gi');

  let best:
    | { index: number; desc: string; qty: number | null; unit: string | null }
    | null = null;

  for (const m of work.matchAll(unitThenQty)) {
    const idx = m.index ?? -1;
    if (idx < 0) continue;
    const qty = parseBrazilianQuantityToken(m[2]);
    if (qty == null) continue;
    let unit = m[1].toLowerCase().replace(/\.$/, '');
    if (unit === 'und') unit = 'un';
    best = {
      index: idx,
      desc: normalizeWs(work.slice(0, idx)),
      qty,
      unit,
    };
  }

  for (const m of work.matchAll(qtyThenUnit)) {
    const idx = m.index ?? -1;
    if (idx < 0) continue;
    const qty = parseBrazilianQuantityToken(m[1]);
    if (qty == null) continue;
    let unit = m[2].toLowerCase().replace(/\.$/, '');
    if (unit === 'und') unit = 'un';
    if (!best || idx >= best.index) {
      best = {
        index: idx,
        desc: normalizeWs(work.slice(0, idx)),
        qty,
        unit,
      };
    }
  }

  if (best) {
    return { description: best.desc, quantity: best.qty, unit: best.unit };
  }

  return { description: work, quantity: null, unit: null };
}

/** Indica se o texto já contém par UND/QTD da grade (após normalização). */
function joinedPartsHaveGridQty(parts: string[]): boolean {
  let desc = normalizeWs(parts.join(' '));
  if (desc.length < 4) return false;
  desc = stripAddressNoiseFromDescription(desc);
  if (desc.length < 4) return false;
  desc = stripTrailingCurrencyToken(desc);
  const { quantity } = extractQtyUnitFromGridTail(desc);
  return quantity != null;
}

function extractItemsForKnownOcLayout(text: string): ParsedPurchaseOrderItem[] {
  const norm = text.replace(/\r/g, '\n');
  const markerIdx = findGridMarkerIndex(norm);
  if (markerIdx < 0) return [];

  const tail = norm.slice(markerIdx);
  const stopIdx = tail.search(/\n\s*OBSERVAÇÕES\b/i);
  const region = stopIdx >= 0 ? tail.slice(0, stopIdx) : tail;
  const lines = region
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const startLineRe = /^R\$\s*[\d.,]+\s+([\d.,]+)\s+(\d{1,3})\s+(.+)$/i;
  const unitRe = /\b(UN|UND|PC|PÇ|PAR|MT|M2|M3|KG|G|LT|ML)\b/i;
  const out: ParsedPurchaseOrderItem[] = [];

  let current: {
    line_number: number;
    quantity: number | null;
    unit: string | null;
    parts: string[];
  } | null = null;

  const flush = () => {
    if (!current) return;
    let desc = normalizeDescriptionText(normalizeWs(current.parts.join(' ')));
    desc = stripAddressNoiseFromDescription(desc);
    desc = stripNonItemTailFromDescription(desc);
    desc = desc
      .replace(/\s+\d+(?:[.,]\d+)?\s+(?:UN|UND|PC|PÇ|PAR|MT|M2|M3|KG|G|LT|ML)\s+R\$\s*[\d.,]+\s*$/i, '')
      .replace(/\s+\d+(?:[.,]\d+)?\s+(?:UN|UND|PC|PÇ|PAR|MT|M2|M3|KG|G|LT|ML)\s*$/i, '')
      .replace(/\s+R\$\s*[\d.,]+\s*$/i, '')
      .trim();
    if (desc.length < 2) {
      current = null;
      return;
    }
    out.push({
      line_number: current.line_number,
      description: normalizeDescriptionText(desc),
      quantity: current.quantity,
      unit: current.unit,
    });
    current = null;
  };

  for (const ln of lines) {
    const m = ln.match(startLineRe);
    if (m) {
      flush();
      const qty = brNumberToFloat(m[1]);
      const lineNum = parseInt(m[2], 10);
      current = {
        line_number: lineNum,
        quantity: qty,
        unit: null,
        parts: [m[3]],
      };
      const u = m[3].match(unitRe);
      if (u) {
        const uu = u[1].toLowerCase();
        current.unit = uu === 'und' ? 'un' : uu;
      }
      continue;
    }

    if (!current) continue;
    if (/^R\$\s*0,00$/i.test(ln)) continue;
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(ln)) continue;
    if (isHardTableEndLine(ln)) break;
    if (isJunkContinuation(ln)) continue;

    current.parts.push(ln);
    if (!current.unit) {
      const u = ln.match(unitRe);
      if (u) {
        const uu = u[1].toLowerCase();
        current.unit = uu === 'und' ? 'un' : uu;
      }
    }
  }
  flush();

  return out.sort((a, b) => a.line_number - b.line_number);
}

function extractItems(text: string): ParsedPurchaseOrderItem[] {
  const byLayout = extractItemsForKnownOcLayout(text);
  if (byLayout.length) return byLayout;

  const norm = text.replace(/\t/g, ' ');
  const sliceAt = findGridMarkerIndex(norm);
  if (sliceAt < 0) return [];

  const tail = norm.slice(sliceAt);
  const stopIdx = tail.search(
    /\n\s*(?:OBSERVA[ÇC][AÃ]O(?:ES)?|SOLICITA[ÇC][AÃ]O\s+DE\s+MATERIAL|JUSTIFICATIVA|COND\.?\s*PAGTO|TIPO\s*PAGTO|ENDERE[CÇ]O|TELEFONE|CNPJ)\b/im
  );
  const region = (stopIdx === -1 ? tail : tail.slice(0, stopIdx)).replace(/\r/g, '\n');

  const rawLines = region
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Neste layout, linhas tipo "3 PARCELAS" vêm antes da grade; o 1º item vem depois de um preço R$.
  let startIdx = -1;
  let sawGridPrice = false;
  for (let i = 0; i < rawLines.length; i++) {
    if (/^R\$\d/.test(rawLines[i])) sawGridPrice = true;
    if (!sawGridPrice) continue;
    const st = itemStartLine(rawLines[i]);
    if (st && isPlausibleItemStart(st)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    for (let i = 0; i < rawLines.length; i++) {
      const st = itemStartLine(rawLines[i]);
      if (st && isPlausibleItemStart(st)) {
        startIdx = i;
        break;
      }
    }
  }
  if (startIdx === -1) {
    for (let i = 0; i < rawLines.length; i++) {
      if (/^R\$\d/.test(rawLines[i])) {
        for (let j = i + 1; j < Math.min(i + 8, rawLines.length); j++) {
          const st = itemStartLine(rawLines[j]);
          if (st && isPlausibleItemStart(st)) {
            startIdx = j;
            break;
          }
        }
        if (startIdx >= 0) break;
      }
    }
  }

  const sliced = startIdx >= 0 ? rawLines.slice(startIdx) : rawLines;
  const lines: string[] = [];
  for (const ln of sliced) {
    if (isHardTableEndLine(ln)) break;
    lines.push(ln);
  }

  const items: ParsedPurchaseOrderItem[] = [];
  let current: { line_number: number; parts: string[] } | null = null;

  const flush = () => {
    if (!current || current.parts.length === 0) return;
    // parts já são só a descrição (sem o nº da linha); não usar itemStartLine aqui.
    let desc = normalizeWs(current.parts.join(' '));
    if (desc.length < 4) return;
    desc = stripAddressNoiseFromDescription(desc);
    desc = stripNonItemTailFromDescription(desc);
    if (desc.length < 4) return;

    const { description, quantity, unit } = extractQtyUnitFromGridTail(desc);

    items.push({
      line_number: current.line_number,
      description: normalizeDescriptionText(description),
      quantity,
      unit,
    });
  };

  for (const ln of lines) {
    if (/^R\$\d/.test(ln)) {
      if (current && joinedPartsHaveGridQty(current.parts)) {
        flush();
        current = null;
      }
      continue;
    }
    const st = itemStartLine(ln);
    if (st && isPlausibleItemStart(st)) {
      flush();
      current = { line_number: st.num, parts: [st.rest] };
      continue;
    }
    if (current && !isJunkContinuation(ln)) {
      current.parts.push(ln);
    }
  }
  flush();

  items.sort((a, b) => a.line_number - b.line_number);
  return refineParsedItems(items);
}

function parseVendorBlock(text: string): {
  vendor_name: string | null;
  vendor_phone: string | null;
  vendor_contact_name: string | null;
} {
  const fromFornecedorField = (() => {
    const m = /Fornecedor\s*:/i.exec(text);
    if (!m?.index && m?.index !== 0) return null;
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 260);
    let line = normalizeWs(tail)
      .replace(/^\s*\d+\s+/, '')
      .trim();
    if (!line) return null;

    const stops = [
      /\bCNPJ\b/i,
      /\bIE\b/i,
      /\bData\s*Emiss[aã]o\b/i,
      /\bData\s*Entrega\b/i,
      /\bData\s*Necessidade\b/i,
      /\bEndere[cç]o\b/i,
      /\bA\/C\b/i,
      /\bTelefone\b/i,
      /\bEmail\b/i,
      /\bCond\.\s*Pagto\b/i,
      /\bTipo\s*Pagto\b/i,
    ];
    let cut = line.length;
    for (const re of stops) {
      const sm = re.exec(line);
      if (sm?.index != null && sm.index >= 0) cut = Math.min(cut, sm.index);
    }
    line = line.slice(0, cut).trim();
    if (!line || line.length < 3) return null;
    return line;
  })();

  const norm = text.replace(/\t/g, ' ');
  const idx = findGridMarkerIndex(norm);
  if (idx < 0) {
    return { vendor_name: null, vendor_phone: null, vendor_contact_name: null };
  }

  const tail = norm.slice(idx).replace(/\r/g, '\n');
  const rawLines = tail
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const block: string[] = [];
  for (const ln of rawLines) {
    if (/^R\$\d/.test(ln)) break;
    const ist = itemStartLine(ln);
    if (ist && isPlausibleItemStart(ist)) break;
    if (/^UND\.?$|^DESC\.?$/i.test(ln)) break;
    block.push(ln);
    if (block.length > 12) break;
  }

  const phones: string[] = [];
  let contact: string | null = null;
  const nameCandidates: string[] = [];

  for (const ln of block) {
    if (/VENDEDOR/i.test(ln)) {
      const m = ln.match(/^(.+?)\s*-\s*VENDEDOR/i);
      if (m) contact = normalizeWs(m[1]);
      continue;
    }
    if (/^A\/C\s*:/i.test(ln)) {
      const name = normalizeWs(ln.replace(/^A\/C\s*:/i, ''));
      if (name) contact = name;
      continue;
    }
    if (PHONE_LINE.test(ln) || GARBLED_PHONE.test(ln)) {
      phones.push(ln);
      continue;
    }
    if (/^Celular:|^Fornecedor:|^Data\s|^Cond\.|^Tipo\s|^A\/C:|^CNPJ:|^Email:/i.test(ln)) {
      continue;
    }
    if (/@/.test(ln)) continue;
    if (ln.length > 2 && !/^\d+$/.test(ln)) {
      nameCandidates.push(ln);
    }
  }

  let vendor_name: string | null = null;
  const scored = nameCandidates.filter((n) => n.length > 3 && !/@/.test(n));
  const withSuffix = scored.find((n) => /\b(LTDA|S\.A\.|ME\.?|EIRELI|IMPORTA|INDUSTRIA)\b/i.test(n));
  const looksLikeShortCompany = scored.filter(
    (n) => /^[A-ZÀ-Ú0-9][A-ZÀ-Ú0-9 .'&-]{2,60}$/i.test(n) && !/\d{5,}/.test(n)
  );
  vendor_name =
    fromFornecedorField ||
    withSuffix ||
    looksLikeShortCompany[0] ||
    (scored.length ? scored.find((n) => !/^\d+[\s-]/.test(n)) || scored[0] : null);

  const vendor_phone = phones[0] ? normalizeWs(splitConcatenatedPhones(phones[0])) : null;

  return {
    vendor_name,
    vendor_phone,
    vendor_contact_name: contact,
  };
}

export function parsePurchaseOrderFromText(text: string, sourceFilename: string): ParsedPurchaseOrder {
  const normalized = text.replace(/\r/g, '\n').replace(/\t/g, ' ');
  const buyer = extractBuyer(normalized);
  const vendor = parseVendorBlock(normalized);

  let oc_number = extractOcNumber(normalized) || ocNumberFromFilename(sourceFilename);

  const items = refineParsedItems(extractItems(normalized));
  const title = sourceFilename.trim() ? titleFromSourceFilename(sourceFilename) : null;

  const vendorContactMerged =
    [vendor.vendor_contact_name, vendor.vendor_phone].filter(Boolean).join(' · ') || null;

  return {
    oc_number,
    buyer_code: buyer.code,
    buyer_name: buyer.name,
    buyer_phone: null,
    vendor_name: vendor.vendor_name,
    vendor_contact_name: vendorContactMerged,
    delivery_deadline: extractDeliveryDeadline(normalized),
    title,
    items,
  };
}

export function parsePurchaseOrderWarnings(parsed: ParsedPurchaseOrder): string[] {
  const w: string[] = [];
  if (!parsed.oc_number) w.push('Número da OC não detectado; confira o PDF ou informe manualmente.');
  if (!parsed.vendor_name) w.push('Fornecedor não detectado com certeza.');
  if (!parsed.items.length) w.push('Nenhuma linha de item foi lida; adicione os produtos manualmente.');
  else if (
    parsed.items.some(
      (i) => i.quantity == null || !(i.unit && String(i.unit).trim())
    )
  )
    w.push('Alguns itens sem quantidade ou unidade lidas da grade; confira no PDF.');
  if (!parsed.delivery_deadline) w.push('Data de entrega não detectada no PDF; informe manualmente se precisar.');
  return w;
}
