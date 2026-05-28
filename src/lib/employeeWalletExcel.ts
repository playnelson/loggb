import ExcelJS from 'exceljs';
import { formatEmployeeName, normalizeSearchText } from '@/lib/employeeName';

type EmployeeLite = {
  full_name: string;
  role: string | null;
  status: string;
};

type WalletRow = {
  description: string;
  unit: string;
  quantity: number;
  consumable: boolean;
  typeLabel: string;
  category?: string;
};

type MovementRow = {
  created_at?: string | null;
  type?: string;
  quantity?: number;
  tag?: string | null;
  items?: {
    description?: string;
    unit?: string;
    consumable?: boolean;
    category?: string;
  } | null;
};

function isoDateTimeToBr(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function movementClassification(movement: MovementRow): {
  kind: 'Retirada' | 'Devolucao' | 'Descarte';
  flow: 'Saida' | 'Entrada';
  observation: string;
} {
  const type = String(movement.type || '').toUpperCase();
  const tag = String(movement.tag || '').toUpperCase();
  const isDiscard = type === 'IN' && tag.includes('DESCARTE');
  if (type === 'OUT') {
    return {
      kind: 'Retirada',
      flow: 'Saida',
      observation: 'Item entregue ao colaborador.',
    };
  }
  if (isDiscard) {
    return {
      kind: 'Descarte',
      flow: 'Entrada',
      observation: 'Baixa de uso do colaborador; nao retorna ao estoque.',
    };
  }
  return {
    kind: 'Devolucao',
    flow: 'Entrada',
    observation: 'Item devolvido pelo colaborador.',
  };
}

function styleTitleRow(worksheet: ExcelJS.Worksheet, rowIndex: number): void {
  const row = worksheet.getRow(rowIndex);
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
}

function styleHeaderRow(worksheet: ExcelJS.Worksheet, rowIndex: number): void {
  const row = worksheet.getRow(rowIndex);
  row.height = 21;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF0F172A' }, size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
}

function styleDataRows(worksheet: ExcelJS.Worksheet, startRow: number, endRow: number): void {
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    row.height = 20;
    row.eachCell((cell) => {
      cell.font = { size: 10, color: { argb: 'FF1E293B' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    });
  }
}

function buildWalletSheet(
  workbook: ExcelJS.Workbook,
  options: {
    name: string;
    employee: EmployeeLite;
    rows: WalletRow[];
    generatedAt: string;
  }
): void {
  const ws = workbook.addWorksheet(options.name);
  ws.columns = [
    { key: 'material', width: 44 },
    { key: 'tipo', width: 20 },
    { key: 'categoria', width: 18 },
    { key: 'unidade', width: 12 },
    { key: 'quantidade', width: 12 },
  ];

  ws.mergeCells('A1:E1');
  ws.getCell('A1').value = `${options.name} - ${formatEmployeeName(options.employee.full_name)}`;
  styleTitleRow(ws, 1);

  ws.addRow([]);
  ws.addRow(['Colaborador', formatEmployeeName(options.employee.full_name), 'Cargo', options.employee.role || '-', '']);
  ws.addRow(['Status', options.employee.status || '-', 'Gerado em', options.generatedAt, '']);
  ws.mergeCells('B3:C3');
  ws.mergeCells('D3:E3');
  ws.mergeCells('B4:C4');
  ws.mergeCells('D4:E4');

  const infoRows = [3, 4];
  infoRows.forEach((rowIndex) => {
    const row = ws.getRow(rowIndex);
    row.height = 20;
    row.eachCell((cell) => {
      cell.font = { size: 10, color: { argb: 'FF334155' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
      const col = Number(cell.col);
      if (Number.isFinite(col) && col <= 4) {
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      }
    });
  });

  ws.addRow([]);
  const headerRowIdx = ws.rowCount + 1;
  ws.addRow(['Material', 'Tipo', 'Categoria', 'Unidade', 'Quantidade']);
  styleHeaderRow(ws, headerRowIdx);

  if (options.rows.length === 0) {
    const emptyRow = ws.addRow(['Sem itens em posse no momento.', '', '', '', '']);
    ws.mergeCells(`A${emptyRow.number}:E${emptyRow.number}`);
    emptyRow.height = 22;
    emptyRow.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };
    emptyRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    emptyRow.getCell(1).border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
  } else {
    const startData = ws.rowCount + 1;
    options.rows.forEach((row) => {
      ws.addRow([row.description, row.typeLabel, row.category || '-', row.unit, Number(row.quantity || 0)]);
    });
    const endData = ws.rowCount;
    styleDataRows(ws, startData, endData);
    for (let i = startData; i <= endData; i++) {
      ws.getRow(i).getCell(5).numFmt = '#,##0';
      ws.getRow(i).getCell(5).alignment = { vertical: 'middle', horizontal: 'right' };
    }
    ws.autoFilter = {
      from: { row: headerRowIdx, column: 1 },
      to: { row: endData, column: 5 },
    };
  }

  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
}

function buildHistorySheet(
  workbook: ExcelJS.Workbook,
  options: {
    employee: EmployeeLite;
    movements: MovementRow[];
    generatedAt: string;
  }
): void {
  const ws = workbook.addWorksheet('Historico completo');
  ws.columns = [
    { key: 'data', width: 20 },
    { key: 'tipo', width: 14 },
    { key: 'fluxo', width: 10 },
    { key: 'material', width: 42 },
    { key: 'categoria', width: 16 },
    { key: 'unidade', width: 12 },
    { key: 'quantidade', width: 12 },
    { key: 'consumivel', width: 14 },
    { key: 'tag', width: 20 },
    { key: 'obs', width: 46 },
  ];

  ws.mergeCells('A1:J1');
  ws.getCell('A1').value = `Historico completo - ${formatEmployeeName(options.employee.full_name)}`;
  styleTitleRow(ws, 1);

  ws.addRow([]);
  ws.addRow(['Gerado em', options.generatedAt, 'Colaborador', formatEmployeeName(options.employee.full_name), '', '', '', '', '', '']);
  ws.mergeCells('B3:C3');
  ws.mergeCells('D3:E3');
  ws.getRow(3).height = 20;
  ws.getRow(3).eachCell((cell) => {
    cell.font = { size: 10, color: { argb: 'FF334155' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
  });

  ws.addRow([]);
  const headerRow = ws.rowCount + 1;
  ws.addRow([
    'Data/Hora',
    'Classificacao',
    'Fluxo',
    'Material',
    'Categoria',
    'Unidade',
    'Quantidade',
    'Consumivel',
    'TAG',
    'Observacao',
  ]);
  styleHeaderRow(ws, headerRow);

  const startData = ws.rowCount + 1;
  if (options.movements.length === 0) {
    const emptyRow = ws.addRow(['Sem movimentacoes registradas.', '', '', '', '', '', '', '', '', '']);
    ws.mergeCells(`A${emptyRow.number}:J${emptyRow.number}`);
    emptyRow.height = 22;
    emptyRow.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };
    emptyRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  } else {
    options.movements.forEach((movement) => {
      const classification = movementClassification(movement);
      ws.addRow([
        isoDateTimeToBr(movement.created_at || null),
        classification.kind,
        classification.flow,
        String(movement.items?.description || '-'),
        String(movement.items?.category || '-'),
        String(movement.items?.unit || '-'),
        Number(movement.quantity || 0),
        movement.items?.consumable ? 'Sim' : 'Nao',
        String(movement.tag || '-'),
        classification.observation,
      ]);
    });
  }
  const endData = ws.rowCount;
  styleDataRows(ws, startData, endData);
  for (let i = startData; i <= endData; i++) {
    ws.getRow(i).getCell(7).numFmt = '#,##0';
    ws.getRow(i).getCell(7).alignment = { vertical: 'middle', horizontal: 'right' };
  }
  ws.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: Math.max(headerRow, endData), column: 10 },
  };
  ws.views = [{ state: 'frozen', ySplit: headerRow }];
}

export async function downloadEmployeeWalletWorkbook(options: {
  employee: EmployeeLite;
  walletEpiRows: WalletRow[];
  walletOtherRows: WalletRow[];
  movements: MovementRow[];
}): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LoggB';
  workbook.created = new Date();
  workbook.modified = new Date();

  const generatedAt = new Date().toLocaleString('pt-BR');
  buildWalletSheet(workbook, {
    name: 'Carteira EPI',
    employee: options.employee,
    rows: options.walletEpiRows,
    generatedAt,
  });
  buildWalletSheet(workbook, {
    name: 'Demais materiais',
    employee: options.employee,
    rows: options.walletOtherRows,
    generatedAt,
  });
  buildHistorySheet(workbook, {
    employee: options.employee,
    movements: options.movements,
    generatedAt,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = normalizeSearchText(formatEmployeeName(options.employee.full_name)).replace(/\s+/g, '_');
  const out = await workbook.xlsx.writeBuffer();
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `carteira_${safeName}_${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
