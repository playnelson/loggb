import * as XLSX from 'xlsx-js-style';

/**
 * Planilha modelo para importação de materiais (aba compatível com ImportSpreadsheet modo inventory).
 * A primeira aba deve permanecer como "Materiais" — o importador lê só a primeira planilha.
 */
export function downloadInventoryImportTemplate(): void {
  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
    fill: { patternType: 'solid', fgColor: { rgb: '0F766E' } },
    alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: '0D9488' } },
      bottom: { style: 'thin', color: { rgb: '0D9488' } },
      left: { style: 'thin', color: { rgb: '0D9488' } },
      right: { style: 'thin', color: { rgb: '0D9488' } },
    },
  } as const;

  const titleStyle = {
    font: { bold: true, sz: 18, color: { rgb: '0F172A' } },
    alignment: { vertical: 'center', horizontal: 'left' },
  } as const;

  const subtitleStyle = {
    font: { sz: 11, color: { rgb: '475569' }, italic: true },
    alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
  } as const;

  const exampleStyle = {
    font: { sz: 11, color: { rgb: '334155' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'F8FAFC' } },
    alignment: { vertical: 'center', horizontal: 'left' },
    border: {
      top: { style: 'thin', color: { rgb: 'E2E8F0' } },
      bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
      left: { style: 'thin', color: { rgb: 'E2E8F0' } },
      right: { style: 'thin', color: { rgb: 'E2E8F0' } },
    },
  } as const;

  const numStyle = {
    ...exampleStyle,
    alignment: { vertical: 'center', horizontal: 'right' },
  } as const;

  const headers = [
    'CÓDIGO',
    'DESCRIÇÃO DO ITEM',
    'CATEGORIA',
    'LOCAL',
    'UNIDADE',
    'CONSUMÍVEL',
    'QUANTIDADE EM ESTOQUE',
    'QTD MÍNIMO',
  ];

  const examples = [
    ['FUR-001', 'Furadeira de impacto 110V', 'Ferramenta', 'Prateleira B2', 'un', 'Não', 3, 1],
    ['LV-NIT-GG', 'Luva nitrílica tamanho GG', 'EPI', 'Gaveta EPI', 'par', 'Sim', 80, 15],
    ['', 'Martelo de borracha 40mm', 'Ferramenta', 'Caixa 12', 'un', 'Não', 12, 2],
  ];

  const headerRowIndex = 4;
  const aoa = [
    ['LoggB — modelo de importação'],
    ['Apague as linhas de exemplo e preencha com seus dados. O cabeçalho da linha 5 não deve ser alterado.'],
    [],
    [],
    headers,
    ...examples,
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ];

  ws['!freeze'] = { xSplit: 0, ySplit: headerRowIndex + 1 };
  const lastDataRow = headerRowIndex + examples.length + 20;
  ws['!autofilter'] = { ref: `A${headerRowIndex + 1}:H${lastDataRow}` };

  ws['!cols'] = [
    { wch: 14 },
    { wch: 38 },
    { wch: 14 },
    { wch: 18 },
    { wch: 10 },
    { wch: 12 },
    { wch: 22 },
    { wch: 12 },
  ];

  const titleCell = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[titleCell]) ws[titleCell].s = titleStyle;
  const subCell = XLSX.utils.encode_cell({ r: 1, c: 0 });
  if (ws[subCell]) ws[subCell].s = subtitleStyle;

  for (let c = 0; c < headers.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRowIndex, c });
    const cell = ws[addr];
    if (cell) cell.s = headerStyle;
  }

  for (let r = 0; r < examples.length; r++) {
    const rowIdx = headerRowIndex + 1 + r;
    for (let c = 0; c < headers.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: rowIdx, c });
      const cell = ws[addr];
      if (!cell) continue;
      cell.s = c >= 6 ? numStyle : exampleStyle;
    }
  }

  const instrTitle = {
    font: { bold: true, sz: 16, color: { rgb: '0F172A' } },
    alignment: { vertical: 'center', horizontal: 'left' },
  } as const;
  const instrBody = {
    font: { sz: 12, color: { rgb: '334155' } },
    alignment: { vertical: 'top', horizontal: 'left', wrapText: true },
  } as const;
  const instrBullet = {
    font: { sz: 11, color: { rgb: '475569' } },
    alignment: { vertical: 'top', horizontal: 'left', wrapText: true },
  } as const;

  const instrLines = [
    ['Instruções — importação de materiais'],
    [],
    [
      'Esta pasta contém duas abas. O sistema importa apenas a primeira aba ("Materiais"). Mantenha o cabeçalho (linha 5) e substitua ou apague as linhas de exemplo.',
    ],
    [],
    ['• CÓDIGO: opcional; se vazio, o sistema gera referência a partir da descrição.'],
    ['• DESCRIÇÃO DO ITEM: obrigatória para cada linha nova.'],
    ['• CATEGORIA: ex. Ferramenta, EPI, Consumível.'],
    ['• LOCAL: prateleira, depósito ou endereço interno.'],
    ['• UNIDADE: un, par, m, kg, cx, etc.'],
    ['• CONSUMÍVEL: Sim ou Não (também aceita S, 1, TRUE).'],
    ['• QUANTIDADE EM ESTOQUE: saldo atual no almoxarifado ao importar.'],
    ['• QTD MÍNIMO: ponto de alerta de reposição.'],
    [],
    ['Depois de salvar o arquivo (.xlsx), use Almoxarifado → Importar e selecione esta planilha.'],
  ];

  const wsInstr = XLSX.utils.aoa_to_sheet(instrLines);
  wsInstr['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  wsInstr['!cols'] = [{ wch: 92 }];
  const t0 = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (wsInstr[t0]) wsInstr[t0].s = instrTitle;
  for (let r = 2; r < instrLines.length; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    const cell = wsInstr[addr];
    if (cell && typeof cell.v === 'string' && cell.v.startsWith('•')) {
      cell.s = instrBullet;
    } else if (cell && cell.v) {
      cell.s = instrBody;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Materiais');
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instruções');

  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fileName = `loggb_modelo_importacao_materiais_${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
