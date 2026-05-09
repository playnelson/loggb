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

/**
 * Dado o conjunto de tokens de texto com suas posições X/Y,
 * reconstrói a tabela de itens da OC identificando as colunas
 * por posição (ITEM, DESCRIÇÃO, UND., QTD.) em vez de heurística de texto.
 */
export function extractItemsFromPositionedItems(
  items: PositionedTextItem[]
): ParsedPurchaseOrderItem[] {
  if (items.length === 0) return [];

  const Y_TOL = 5; // pixels de tolerância para considerar mesma linha

  // --- agrupa em linhas por Y ---
  const rowMap = new Map<number, { x: number; text: string }[]>();
  for (const item of items) {
    let rowY = -1;
    for (const ry of rowMap.keys()) {
      if (Math.abs(ry - item.y) <= Y_TOL) { rowY = ry; break; }
    }
    if (rowY < 0) { rowY = item.y; rowMap.set(rowY, []); }
    rowMap.get(rowY)!.push({ x: item.x, text: item.text });
  }

  const rows = [...rowMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([y, cells]) => ({ y, cells: [...cells].sort((a, b) => a.x - b.x) }));

  // --- localiza linha de cabeçalho ---
  let headerIdx = -1;
  let descX = -1, undX = -1, qtdX = -1, itemX = -1;

  for (let i = 0; i < rows.length; i++) {
    const norm = rows[i].cells.map(c => ({
      x: c.x,
      key: c.text.toUpperCase().replace(/[\s.]/g, ''),
    }));
    const d = norm.find(c => c.key.startsWith('DESCRI'));
    const u = norm.find(c => c.key === 'UND' || c.key === 'UNIDADE');
    const q = norm.find(c => c.key === 'QTD' || c.key === 'QUANTIDADE');
    const it = norm.find(c => c.key === 'ITEM');
    if (d && (u || q)) {
      headerIdx = i;
      descX = d.x; if (u) undX = u.x; if (q) qtdX = q.x; if (it) itemX = it.x;
      break;
    }
  }

  if (headerIdx < 0 || descX < 0) return [];

  // limite direito da coluna de descrição
  const descRight = Math.min(
    undX >= 0 ? undX - 2 : Infinity,
    qtdX >= 0 ? qtdX - 2 : Infinity
  );
  const COL_TOL = 45;
  const result: ParsedPurchaseOrderItem[] = [];

  for (const row of rows.slice(headerIdx + 1)) {
    // coluna ITEM: número inteiro 1–999
    const lineCell = row.cells.find(c => {
      if (itemX >= 0 && Math.abs(c.x - itemX) > COL_TOL) return false;
      const n = parseInt(c.text, 10);
      return isFinite(n) && n > 0 && n <= 999 && c.text.trim() === String(n);
    });
    if (!lineCell) continue;

    // coluna DESCRIÇÃO: todos os tokens entre descX e undX/qtdX
    const descTokens = row.cells.filter(c => c.x >= descX - 10 && c.x < descRight);
    const description = descTokens.map(c => c.text).join(' ').trim();
    if (description.length < 2) continue;

    // coluna UND
    let unit: string | null = null;
    if (undX >= 0) {
      const cell = row.cells.find(c => Math.abs(c.x - undX) <= COL_TOL);
      if (cell) { unit = cell.text.toLowerCase().replace(/\.$/, ''); if (unit === 'und') unit = 'un'; }
    }

    // coluna QTD
    let quantity: number | null = null;
    if (qtdX >= 0) {
      const cell = row.cells.find(c => Math.abs(c.x - qtdX) <= COL_TOL);
      if (cell) quantity = brNumberToFloat(cell.text);
    }

    result.push({ line_number: parseInt(lineCell.text, 10), description, quantity, unit });
  }

  return result.sort((a, b) => a.line_number - b.line_number);
}

// ---------------------------------------------------------------------------

const PHONE_LINE =
  /^(?:\(?\d{2}\)?\s*)?\d{4,5}[-.\s]?\d{3,4}(?:\s*\/\s*(?:\(?\d{2}\)?\s*)?\d{4,5}[-.\s]?\d{3,4})?$/;
const GARBLED_PHONE = /^\d{2,3}\d{3,4}-\d{6,}\d{2,3}-\d{3,4}$/;

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
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
  const patterns: RegExp[] = [
    /Data\s*Entrega\s*:\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s*Entrega\s*:\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s+de\s+Entrega\s*:\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Entrega\s*:\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s*Entrega\s*[:\s]+\s*(\d{2}\/\d{2}\/\d{4})/i,
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

function extractItems(text: string): ParsedPurchaseOrderItem[] {
  const norm = text.replace(/\t/g, ' ');
  const markers = ['TOTALDESCRIÇÃOQTD.', 'DESCRIÇÃOQTD.', 'DESCRIÇÃOQTD'];
  let sliceAt = -1;
  for (const m of markers) {
    const i = norm.indexOf(m);
    if (i >= 0) {
      sliceAt = i + m.length;
      break;
    }
  }
  if (sliceAt < 0) return [];

  const tail = norm.slice(sliceAt);
  const stopIdx = tail.search(/\n\s*OBSERVAÇÕES\b/im);
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
    if (/^OBSERVAÇÕES\b/i.test(ln)) break;
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
    if (desc.length < 4) return;

    const { description, quantity, unit } = extractQtyUnitFromGridTail(desc);

    items.push({
      line_number: current.line_number,
      description,
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
  return items;
}

function parseVendorBlock(text: string): {
  vendor_name: string | null;
  vendor_phone: string | null;
  vendor_contact_name: string | null;
} {
  const norm = text.replace(/\t/g, ' ');
  const markers = ['TOTALDESCRIÇÃOQTD.', 'DESCRIÇÃOQTD.', 'DESCRIÇÃOQTD'];
  let idx = -1;
  for (const m of markers) {
    const i = norm.indexOf(m);
    if (i >= 0) {
      idx = i + m.length;
      break;
    }
  }
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

  const items = extractItems(normalized);
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
