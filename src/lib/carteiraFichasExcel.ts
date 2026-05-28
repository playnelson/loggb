import ExcelJS from 'exceljs';
import { formatEmployeeName } from '@/lib/employeeName';
import type { FichaPossessionRow, FichaTxtEmployee, FichaTxtMeta } from '@/lib/carteiraFichasTxt';

function formatCpf(cpf: string | null | undefined): string {
  if (!cpf) return '-';
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return cpf;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function filenameSlug(name: string, prefix: string) {
  const s =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'colaborador';
  return `${prefix}_${s}.xlsx`;
}

function setCellBorder(cell: ExcelJS.Cell): void {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  };
}

function styleInfoPairRow(worksheet: ExcelJS.Worksheet, rowIndex: number): void {
  const row = worksheet.getRow(rowIndex);
  row.height = 20;
  row.eachCell((cell) => {
    cell.font = { size: 10, color: { argb: 'FF334155' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    setCellBorder(cell);
  });
}

export async function downloadEpiFichaExcel(
  employee: FichaTxtEmployee,
  rows: FichaPossessionRow[],
  meta: FichaTxtMeta
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LoggB';
  workbook.created = new Date();
  workbook.modified = new Date();

  const ws = workbook.addWorksheet('Ficha EPI');
  ws.columns = [
    { key: 'descricao', width: 46 },
    { key: 'observacao', width: 34 },
    { key: 'unidade', width: 12 },
    { key: 'quantidade', width: 12 },
  ];

  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = `Ficha de EPI - ${formatEmployeeName(employee.full_name)}`;
  ws.getCell('A1').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 13 };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 24;

  ws.addRow([]);
  ws.addRow(['Empresa', meta.companyName || '-', 'CNPJ', meta.companyCnpj || '-']);
  ws.addRow(['Setor/estabelecimento', meta.branchOrDept || '-', 'Data do documento', meta.issuedAtLabel || '-']);
  ws.addRow(['Colaborador', formatEmployeeName(employee.full_name), 'CPF', formatCpf(employee.cpf)]);
  ws.addRow(['Função', employee.role || '-', 'Departamento', employee.department || '-']);
  ws.addRow(['Responsável pela emissão', meta.responsibleName || '-', '', '']);

  ws.mergeCells('B3:C3');
  ws.mergeCells('B4:C4');
  ws.mergeCells('B5:C5');
  ws.mergeCells('B6:C6');
  ws.mergeCells('B7:D7');

  [3, 4, 5, 6, 7].forEach((rowIndex) => styleInfoPairRow(ws, rowIndex));

  ws.addRow([]);
  const headerRowIndex = ws.rowCount + 1;
  ws.addRow(['Descrição do EPI', 'Observação', 'Unidade', 'Quantidade']);
  const headerRow = ws.getRow(headerRowIndex);
  headerRow.height = 21;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    setCellBorder(cell);
  });

  if (rows.length === 0) {
    const emptyRow = ws.addRow(['Nenhum EPI em posse no momento.', '', '', '']);
    ws.mergeCells(`A${emptyRow.number}:D${emptyRow.number}`);
    emptyRow.height = 22;
    emptyRow.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };
    emptyRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    setCellBorder(emptyRow.getCell(1));
  } else {
    const dataStart = ws.rowCount + 1;
    rows.forEach((row) => {
      ws.addRow([row.description, row.remark || '-', row.unit, Number(row.quantity || 0)]);
    });
    const dataEnd = ws.rowCount;
    for (let i = dataStart; i <= dataEnd; i++) {
      const row = ws.getRow(i);
      row.height = 20;
      row.eachCell((cell) => {
        cell.font = { size: 10, color: { argb: 'FF1E293B' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        setCellBorder(cell);
      });
      row.getCell(4).alignment = { vertical: 'middle', horizontal: 'right' };
      row.getCell(4).numFmt = '#,##0';
    }
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: dataEnd, column: 4 },
    };
  }

  ws.views = [{ state: 'frozen', ySplit: headerRowIndex }];

  const out = await workbook.xlsx.writeBuffer();
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameSlug(formatEmployeeName(employee.full_name), 'ficha_epi');
  a.click();
  URL.revokeObjectURL(url);
}
