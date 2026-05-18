import ExcelJS from 'exceljs';
import { formatEmployeeName } from '@/lib/employeeName';

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
  return formatEmployeeName(Array.isArray(employees) ? employees[0]?.full_name || '—' : employees.full_name || '—');
}

function buildPossessionDetail(possession: PossessionDetail[] | undefined): string {
  const lines =
    possession
      ?.filter((pos) => Number(pos.quantity) > 0)
      .map((pos) => `${employeeNameFromPossession(pos.employees)}: ${Number(pos.quantity)}`)
      .filter(Boolean) ?? [];
  return lines.length ? lines.join(' | ') : '—';
}

function getCellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text ?? '').join('');
    }
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }
    if ('result' in value && value.result != null) {
      return String(value.result);
    }
  }
  return String(value);
}

function findHeaderRowAndColumns(worksheet: ExcelJS.Worksheet): {
  headerRow: number;
  columns: Record<string, number>;
} {
  const requiredByAlias: Array<{ key: string; aliases: string[] }> = [
    { key: 'descricao', aliases: ['descricao', 'descricao do item', 'material', 'item'] },
    { key: 'codigo', aliases: ['codigo', 'cod', 'sku'] },
    { key: 'categoria', aliases: ['categoria'] },
    { key: 'local', aliases: ['local', 'localizacao'] },
    { key: 'unidade', aliases: ['unidade', 'und', 'unid'] },
    { key: 'consumivel', aliases: ['consumivel'] },
    { key: 'itemUnico', aliases: ['item unico', 'unico'] },
    { key: 'tagCadastro', aliases: ['tag cadastro', 'tag'] },
    { key: 'estoqueAlmox', aliases: ['estoq', 'estoque almox', 'estoque almoxarifado', 'estoque'] },
    { key: 'posseDetalhe', aliases: ['em posse detalhe', 'posse detalhe'] },
    { key: 'posseSoma', aliases: ['em pos', 'em posse soma', 'posse soma', 'em posse'] },
    { key: 'minimo', aliases: ['minimo', 'qtd minimo', 'quantidade minima'] },
    { key: 'totalFisico', aliases: ['total fisico', 'total'] },
  ];

  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const cols: Record<string, number> = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const normalized = normalizeHeader(getCellText(cell.value));
      if (!normalized) return;
      for (const expected of requiredByAlias) {
        if (cols[expected.key] != null) continue;
        if (expected.aliases.some((alias) => normalized.includes(alias))) {
          cols[expected.key] = colNumber;
        }
      }
    });
    if (cols.descricao != null && cols.estoqueAlmox != null) {
      return { headerRow: r, columns: cols };
    }
  }

  throw new Error('Cabecalho do modelo nao encontrado. Verifique os nomes das colunas no template.');
}

function cloneCellStyle(style: Partial<ExcelJS.Style>): Partial<ExcelJS.Style> {
  return JSON.parse(JSON.stringify(style || {})) as Partial<ExcelJS.Style>;
}

export async function downloadInventoryWorkbookFromTemplate(items: InventoryExportItem[]): Promise<void> {
  const response = await fetch(TEMPLATE_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Nao foi possivel carregar o modelo de inventario.');
  }

  const bytes = await response.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('O modelo de inventario nao possui abas.');
  }
  const { headerRow, columns } = findHeaderRowAndColumns(worksheet);

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
  const styleSourceRow = worksheet.getRow(startDataRow);

  const existingLastRow = Math.max(worksheet.actualRowCount, startDataRow);
  for (let r = startDataRow; r <= existingLastRow; r++) {
    const targetRow = worksheet.getRow(r);
    (Object.keys(columns) as Array<keyof (typeof rows)[number]>).forEach((key) => {
      const col = columns[key];
      if (col == null) return;
      const sourceCell = styleSourceRow.getCell(col);
      const targetCell = targetRow.getCell(col);
      targetCell.value = '';
      targetCell.style = cloneCellStyle(sourceCell.style);
    });
    if (styleSourceRow.height != null) targetRow.height = styleSourceRow.height;
    targetRow.commit();
  }

  rows.forEach((row, idx) => {
    const r = startDataRow + idx;
    const targetRow = worksheet.getRow(r);
    (Object.keys(columns) as Array<keyof typeof row>).forEach((key) => {
      const col = columns[key];
      if (col == null) return;
      const sourceCell = styleSourceRow.getCell(col);
      const targetCell = targetRow.getCell(col);
      targetCell.value = row[key] as string | number;
      targetCell.style = cloneCellStyle(sourceCell.style);
    });
    if (styleSourceRow.height != null) targetRow.height = styleSourceRow.height;
    targetRow.commit();
  });

  const maxColumn = Math.max(...Object.values(columns));
  const minColumn = Math.min(...Object.values(columns));
  const lastRow = Math.max(headerRow, startDataRow + rows.length - 1);
  worksheet.autoFilter = {
    from: { row: headerRow, column: minColumn },
    to: { row: lastRow, column: maxColumn },
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const out = await workbook.xlsx.writeBuffer();
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventario_almoxarifado_${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
