/**
 * Extrai campos de ordens de compra a partir do texto de PDFs (layout típico ERP / OC brasileira).
 * Resultados são heurísticos; o usuário pode corrigir antes de salvar.
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
  vendor_phone: string | null;
  vendor_contact_name: string | null;
  store_name: string | null;
  delivery_deadline: string | null;
  request_date: string | null;
  approval_status: string | null;
  title: string | null;
  items: ParsedPurchaseOrderItem[];
}

const PHONE_LINE =
  /^(?:\(?\d{2}\)?\s*)?\d{4,5}[-.\s]?\d{3,4}(?:\s*\/\s*(?:\(?\d{2}\)?\s*)?\d{4,5}[-.\s]?\d{3,4})?$/;
const GARBLED_PHONE = /^\d{2,3}\d{3,4}-\d{6,}\d{2,3}-\d{3,4}$/;

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
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

function extractStore(text: string): string | null {
  const afterBuyer = text.match(/Comprador\s*:\s*\n\s*\S+\s+[^\n]+\n\s*([^\n]+)/i);
  if (afterBuyer) {
    const line = afterBuyer[1].trim();
    if (/^\d{2,4}_[A-Z0-9_]+$/i.test(line) || /^[A-Z0-9_]{4,}$/i.test(line)) {
      return line;
    }
  }
  return null;
}

function extractApprovalStatus(text: string): string | null {
  const m = text.match(/Status\s*da\s*Aprovação\s*\n\s*([A-ZÁ-Ú0-9_]+)/i);
  return m ? m[1].trim() : null;
}

function extractDates(text: string): { request: string | null; delivery: string | null } {
  let request: string | null = null;
  const req = text.match(/No\.?\s*Solicitação\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (req) request = parseBrDate(req[1]);

  let delivery: string | null = null;
  const de = text.match(/Data\s*Entrega\s*:\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (de) delivery = parseBrDate(de[1]);

  if (!delivery) {
    const dn = text.match(/Data\s*Necessidade\s*:\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (dn) delivery = parseBrDate(dn[1]);
  }

  if (!delivery) {
    const itemBlock = text.match(/\bITEM\s*\n\s*BOLETO\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (itemBlock) delivery = parseBrDate(itemBlock[1]);
  }

  return { request, delivery };
}

function itemStartLine(line: string): { num: number; rest: string } | null {
  const m = line.match(/^(\d+)\s+([A-Za-zÀ-ÿ0-9"'.].*)$/);
  if (m) return { num: parseInt(m[1], 10), rest: m[2].trim() };
  const m2 = line.match(/^(\d+)([A-Za-zÀ-ÿ"'.].*)$/);
  if (m2) return { num: parseInt(m2[1], 10), rest: m2[2].trim() };
  return null;
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
  return false;
}

function extractItems(text: string): ParsedPurchaseOrderItem[] {
  const marker = 'TOTALDESCRIÇÃOQTD.';
  const idx = text.indexOf(marker);
  if (idx === -1) return [];

  const tail = text.slice(idx + marker.length);
  const stopIdx = tail.search(/\n\s*OBSERVAÇÕES\b/im);
  const region = (stopIdx === -1 ? tail : tail.slice(0, stopIdx)).replace(/\r/g, '\n');

  const rawLines = region
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let startIdx = -1;
  for (let i = 0; i < rawLines.length; i++) {
    if (itemStartLine(rawLines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    for (let i = 0; i < rawLines.length; i++) {
      if (/^R\$\d/.test(rawLines[i])) {
        for (let j = i + 1; j < Math.min(i + 8, rawLines.length); j++) {
          if (itemStartLine(rawLines[j])) {
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
    const merged = normalizeWs(current.parts.join(' '));
    const start = itemStartLine(merged);
    if (!start) return;
    let desc = start.rest;
    let qty: number | null = null;
    let unit: string | null = null;

    const qtyMatch =
      desc.match(
        /(.+?)\s+([\d.,]+)\s*(UN|UND|MT|M2|M3|KG|G|L|ML|PAR|PÇ|PC|CX|FD|SC|GL|LT)\s*$/i
      ) || desc.match(/(.+?)\s*-\s*([\d.,]+)\s*(L|ML)\s*$/i);
    if (qtyMatch) {
      desc = normalizeWs(qtyMatch[1]);
      const qRaw = qtyMatch[2].replace(/\./g, '').replace(',', '.');
      const q = parseFloat(qRaw);
      qty = Number.isFinite(q) ? q : null;
      unit = qtyMatch[3].toLowerCase();
      if (unit === 'und') unit = 'un';
    }

    if (desc.length >= 4) {
      items.push({
        line_number: current.line_number,
        description: desc,
        quantity: qty,
        unit,
      });
    }
  };

  for (const ln of lines) {
    if (/^R\$\d/.test(ln)) {
      flush();
      current = null;
      continue;
    }
    const st = itemStartLine(ln);
    if (st) {
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
  const marker = 'TOTALDESCRIÇÃOQTD.';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    return { vendor_name: null, vendor_phone: null, vendor_contact_name: null };
  }

  const tail = text.slice(idx + marker.length).replace(/\r/g, '\n');
  const rawLines = tail
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const block: string[] = [];
  for (const ln of rawLines) {
    if (/^R\$\d/.test(ln)) break;
    if (itemStartLine(ln)) break;
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
    if (ln.length > 2 && !/^\d+$/.test(ln)) {
      nameCandidates.push(ln);
    }
  }

  let vendor_name: string | null = null;
  const scored = nameCandidates.filter((n) => n.length > 3);
  const withSuffix = scored.find((n) => /\b(LTDA|S\.A\.|ME\.?|EIRELI|IMPORTA|INDUSTRIA)\b/i.test(n));
  vendor_name = withSuffix || (scored.length ? scored[scored.length - 1] : null);

  const vendor_phone = phones[0] ? normalizeWs(phones[0]) : null;

  return {
    vendor_name,
    vendor_phone,
    vendor_contact_name: contact,
  };
}

export function parsePurchaseOrderFromText(text: string, sourceFilename: string): ParsedPurchaseOrder {
  const normalized = text.replace(/\r/g, '\n');
  const buyer = extractBuyer(normalized);
  const vendor = parseVendorBlock(normalized);
  const dates = extractDates(normalized);

  let oc_number = extractOcNumber(normalized) || ocNumberFromFilename(sourceFilename);

  const items = extractItems(normalized);
  const title =
    vendor.vendor_name ||
    (oc_number ? `OC ${oc_number}` : sourceFilename.replace(/\.[^.]+$/i, ''));

  return {
    oc_number,
    buyer_code: buyer.code,
    buyer_name: buyer.name,
    buyer_phone: null,
    vendor_name: vendor.vendor_name,
    vendor_phone: vendor.vendor_phone,
    vendor_contact_name: vendor.vendor_contact_name,
    store_name: extractStore(normalized),
    delivery_deadline: dates.delivery,
    request_date: dates.request,
    approval_status: extractApprovalStatus(normalized),
    title,
    items,
  };
}

export function parsePurchaseOrderWarnings(parsed: ParsedPurchaseOrder): string[] {
  const w: string[] = [];
  if (!parsed.oc_number) w.push('Número da OC não detectado; confira o PDF ou informe manualmente.');
  if (!parsed.vendor_name) w.push('Fornecedor não detectado com certeza.');
  if (!parsed.items.length) w.push('Nenhuma linha de item foi lida; adicione os produtos manualmente.');
  return w;
}
