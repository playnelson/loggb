import * as XLSX from 'xlsx-js-style';

interface PossessionDetail {
  quantity: number;
  employees?: { full_name: string } | { full_name: string }[] | null;
}

export interface InventoryExportItem {
  description: string;
  code?: string | null;
  category: string;
  location: string;
  unit: string;
  consumable: boolean;
  unique_item?: boolean;
  tag?: string | null;
  quantity_current: number;
  quantity_min: number;
  possession?: PossessionDetail[];
}

const TEMPLATE_URL = '/templates/LOGGB_Inventario.xlsx';

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w]+/g, ' ')
    .trim();
}

function employeeNameFromPossession(
  employees: { full_name: string } | { full_name: string }[] | null | undefined
): string {
  if (!employees) return '—';
  return Array.isArray(employees) ? employees[0]?.full_name || '—' : employees.full_name || '—';
}

function buildPossessionDetail(possession: PossessionDetail[] | undefined): string {
  const lines =
    possession
      ?.filter((pos) => Number(pos.quantity) > 0)
      .map((pos) => `${employeeNameFromPossession(pos.employees)}: ${Number(pos.quantity)}`)
      .filter(Boolean) ?? [];
  return lines.length ? lines.join(' | ') : '—';
}

function findHeaderRowAndColumns(ws: XLSX.WorkSheet): { headerRow: number; columns: Record<string, number> } {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const requiredByAlias: Array<{ key: string; aliases: string[] }> = [
    { key: 'descricao', aliases: ['descricao', 'descricao do item', 'material', 'item'] },
    { key: 'codigo', aliases: ['codigo', 'cod', 'sku'] },
    { key: 'categoria', aliases: ['categoria'] },
    { key: 'local', aliases: ['local', 'localizacao'] },
    { key: 'unidade', aliases: ['unidade', 'und'] },
    { key: 'consumivel', aliases: ['consumivel'] },
    { key: 'itemUnico', aliases: ['item unico', 'unico'] },
    { key: 'tagCadastro', aliases: ['tag cadastro', 'tag'] },
    { key: 'estoqueAlmox', aliases: ['estoque almox', 'estoque almoxarifado', 'estoque'] },
    { key: 'posseDetalhe', aliases: ['em posse detalhe', 'posse detalhe'] },
    { key: 'posseSoma', aliases: ['em posse soma', 'posse soma', 'em posse'] },
    { key: 'minimo', aliases: ['minimo', 'qtd minimo', 'quantidade minima'] },
    { key: 'totalFisico', aliases: ['total fisico', 'total'] },
  ];

  for (let r = range.s.r; r <= range.e.r; r++) {
    const cols: Record<string, number> = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell || cell.v == null) continue;
      const normalized = normalizeHeader(String(cell.v));
      if (!normalized) continue;
      for (const expected of requiredByAlias) {
        if (cols[expected.key] != null) continue;
        if (expected.aliases.some((alias) => normalized.includes(alias))) {
          cols[expected.key] = c;
        }
      }
    }
    if (cols.descricao != null && cols.estoqueAlmox != null) {
      return { headerRow: r, columns: cols };
    }
  }

  throw new Error('Cabecalho do modelo de inventario nao encontrado.');
}

function setCell(ws: XLSX.WorkSheet, r: number, c: number, value: string | number): void {
  const addr = XLSX.utils.encode_cell({ r, c });
  const prev = ws[addr] as XLSX.CellObject | undefined;
  ws[addr] = {
    ...(prev?.s ? { s: prev.s } : {}),
    t: typeof value === 'number' ? 'n' : 's',
    v: value,
  };
}

export async function downloadInventoryWorkbookFromTemplate(items: InventoryExportItem[]): Promise<void> {
  const response = await fetch(TEMPLATE_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Nao foi possivel carregar o modelo de inventario.');
  }

  const bytes = await response.arrayBuffer();
  const wb = XLSX.read(bytes, { type: 'array' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('O modelo de inventario nao possui abas.');
  }
  const ws = wb.Sheets[firstSheetName];
  const { headerRow, columns } = findHeaderRowAndColumns(ws);

  const rows = items.map((p) => {
    const posTotal = p.possession?.reduce((acc, curr) => acc + Number(curr.quantity || 0), 0) || 0;
    return {
      descricao: p.description || '',
      codigo: p.code || '',
      categoria: p.category || '',
      local: p.location || '',
      unidade: p.unit || '',
      consumivel: p.consumable ? 'Sim' : 'Nao',
      itemUnico: p.unique_item ? 'Sim' : 'Nao',
      tagCadastro: p.tag || '',
      estoqueAlmox: Number(p.quantity_current || 0),
      posseDetalhe: buildPossessionDetail(p.possession),
      posseSoma: posTotal,
      minimo: Number(p.quantity_min || 0),
      totalFisico: Number(p.quantity_current || 0) + posTotal,
    };
  });

  const startDataRow = headerRow + 1;
  const existingRange = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  for (let r = startDataRow; r <= existingRange.e.r; r++) {
    (Object.keys(columns) as Array<keyof typeof rows[number]>).forEach((key) => {
      const col = columns[key];
      if (col == null) return;
      setCell(ws, r, col, '');
    });
  }

  rows.forEach((row, idx) => {
    const r = startDataRow + idx;
    (Object.keys(columns) as Array<keyof typeof row>).forEach((key) => {
      const col = columns[key];
      if (col == null) return;
      setCell(ws, r, col, row[key]);
    });
  });

  const maxColumn = Math.max(existingRange.e.c, ...Object.values(columns));
  const lastRow = Math.max(headerRow, startDataRow + rows.length - 1);
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: existingRange.s.r, c: existingRange.s.c },
    e: { r: lastRow, c: maxColumn },
  });
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: lastRow, c: maxColumn } }) };

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `inventario_almoxarifado_${stamp}.xlsx`);
}
