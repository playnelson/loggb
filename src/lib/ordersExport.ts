import * as XLSX from 'xlsx-js-style';
import type { EmployeeLite, PurchaseOrderItemRow, PurchaseOrderRow } from '@/lib/purchaseOrders';

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatPtBrDateTime(v: string | null | undefined): string {
  const d = safeDate(v);
  if (!d) return '—';
  return d.toLocaleString('pt-BR');
}

function parsePriceToNumberBRL(v: string | null | undefined): number | null {
  if (!v) return null;
  const raw = v.trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/\s/g, '')
    .replace(/^R\$\s?/i, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

type ExportInput = {
  orders: PurchaseOrderRow[];
  items: PurchaseOrderItemRow[];
  employees: EmployeeLite[];
  title?: string;
};

export function downloadOrdersSpreadsheet({ orders, items, employees, title = 'Pedidos de Compra' }: ExportInput): void {
  const employeeNameById = new Map(employees.map((e) => [e.id, e.full_name]));
  const itemsByOrderId = new Map<string, PurchaseOrderItemRow[]>();
  for (const it of items) {
    const bucket = itemsByOrderId.get(it.order_id) || [];
    bucket.push(it);
    itemsByOrderId.set(it.order_id, bucket);
  }

  const generatedAt = new Date();
  const subtitle = `Gerado em ${generatedAt.toLocaleString('pt-BR')}`;

  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: '0F172A' } },
    alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
  } as const;

  const titleStyle = {
    font: { bold: true, sz: 16, color: { rgb: '0F172A' } },
    alignment: { vertical: 'center', horizontal: 'left' },
  } as const;

  const subtitleStyle = {
    font: { sz: 10, color: { rgb: '64748B' } },
    alignment: { vertical: 'center', horizontal: 'left' },
  } as const;

  const moneyStyle = {
    numFmt: '"R$" #,##0.00',
    alignment: { horizontal: 'right' },
  } as const;

  const intStyle = {
    numFmt: '0',
    alignment: { horizontal: 'right' },
  } as const;

  const wb = XLSX.utils.book_new();

  // Sheet 1: Pedidos (resumo)
  const resumoHeader = [
    'ID do pedido',
    'Solicitante',
    'Estágio',
    'Criado em',
    'Atualizado em',
    'Qtd. itens',
    'Qtd. pedida',
    'Qtd. recebida',
    'Observações',
  ];

  const resumoRows = orders.map((o) => {
    const lineItems = itemsByOrderId.get(o.id) || [];
    const qtyReq = lineItems.reduce((acc, it) => acc + (it.quantity_requested || 0), 0);
    const qtyRec = lineItems.reduce((acc, it) => acc + (it.quantity_received || 0), 0);
    return [
      o.id,
      employeeNameById.get(o.requester_employee_id) || '—',
      o.stage,
      formatPtBrDateTime(o.created_at),
      formatPtBrDateTime(o.updated_at),
      lineItems.length,
      qtyReq,
      qtyRec,
      o.notes || '',
    ];
  });

  const wsResumo = XLSX.utils.aoa_to_sheet([
    [title],
    [subtitle],
    [],
    resumoHeader,
    ...resumoRows,
  ]);

  wsResumo['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: resumoHeader.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: resumoHeader.length - 1 } },
  ];

  wsResumo['!freeze'] = { xSplit: 0, ySplit: 4 };
  wsResumo['!autofilter'] = { ref: `A4:I${4 + Math.max(resumoRows.length, 1)}` };
  wsResumo['!cols'] = [
    { wch: 40 },
    { wch: 22 },
    { wch: 12 },
    { wch: 20 },
    { wch: 20 },
    { wch: 10 },
    { wch: 12 },
    { wch: 13 },
    { wch: 45 },
  ];

  // styles
  wsResumo['A1'].s = titleStyle;
  wsResumo['A2'].s = subtitleStyle;
  for (let c = 0; c < resumoHeader.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 3, c });
    const cell = wsResumo[addr];
    if (cell) cell.s = headerStyle;
  }
  for (let r = 0; r < resumoRows.length; r++) {
    const rowIndex = 4 + r;
    // Qtd itens, pedida, recebida
    for (const c of [5, 6, 7]) {
      const addr = XLSX.utils.encode_cell({ r: rowIndex, c });
      const cell = wsResumo[addr];
      if (cell) cell.s = intStyle;
    }
  }

  XLSX.utils.book_append_sheet(wb, wsResumo, 'Pedidos');

  // Sheet 2: Itens (detalhado)
  const itensHeader = [
    'ID do pedido',
    'Produto',
    'Fornecedor',
    'Un',
    'Qtd. pedida',
    'Qtd. recebida',
    'Preço (texto)',
    'Preço (R$)',
    'Link',
    'Observações',
    'Criado em',
    'Atualizado em',
  ];

  const itensRows = items.map((it) => {
    const priceN = parsePriceToNumberBRL(it.product_price);
    return [
      it.order_id,
      it.product_name || '',
      it.vendor || '',
      it.unit || 'un',
      it.quantity_requested ?? 0,
      it.quantity_received ?? 0,
      it.product_price || '',
      priceN ?? null,
      it.product_url || '',
      it.notes || '',
      formatPtBrDateTime(it.created_at),
      formatPtBrDateTime(it.updated_at),
    ];
  });

  const wsItens = XLSX.utils.aoa_to_sheet([
    ['Itens dos pedidos'],
    [subtitle],
    [],
    itensHeader,
    ...itensRows,
  ]);

  wsItens['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: itensHeader.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: itensHeader.length - 1 } },
  ];

  wsItens['!freeze'] = { xSplit: 0, ySplit: 4 };
  wsItens['!autofilter'] = { ref: `A4:L${4 + Math.max(itensRows.length, 1)}` };
  wsItens['!cols'] = [
    { wch: 40 },
    { wch: 34 },
    { wch: 20 },
    { wch: 6 },
    { wch: 12 },
    { wch: 13 },
    { wch: 14 },
    { wch: 12 },
    { wch: 40 },
    { wch: 35 },
    { wch: 20 },
    { wch: 20 },
  ];

  wsItens['A1'].s = titleStyle;
  wsItens['A2'].s = subtitleStyle;
  for (let c = 0; c < itensHeader.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 3, c });
    const cell = wsItens[addr];
    if (cell) cell.s = headerStyle;
  }
  for (let r = 0; r < itensRows.length; r++) {
    const rowIndex = 4 + r;
    for (const c of [4, 5]) {
      const addr = XLSX.utils.encode_cell({ r: rowIndex, c });
      const cell = wsItens[addr];
      if (cell) cell.s = intStyle;
    }
    const moneyAddr = XLSX.utils.encode_cell({ r: rowIndex, c: 7 });
    const moneyCell = wsItens[moneyAddr];
    if (moneyCell && typeof moneyCell.v === 'number') moneyCell.s = moneyStyle;
  }

  XLSX.utils.book_append_sheet(wb, wsItens, 'Itens');

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const fileName = `pedidos_${generatedAt.getFullYear()}-${pad2(generatedAt.getMonth() + 1)}-${pad2(generatedAt.getDate())}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

