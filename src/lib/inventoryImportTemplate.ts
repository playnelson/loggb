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
    font: { bold: true, sz: 18, color: { rgb: '263238' } },
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
    'DESCRIÇÃO DO ITEM',
    'CATEGORIA',
    'UNIDADE',
    'CONSUMÍVEL',
    'ITEM ÚNICO',
    'TAG',
    'QUANTIDADE EM ESTOQUE',
    'QTD MÍNIMO',
    'LOCAL',
  ];
  /** Colunas numéricas (alinhadas à direita). */
  const numCols = new Set([6, 7]);

  const examples = [
    ['Luva nitrílica tamanho GG', 'EPI', 'par', 'Sim', 'Não', '', 80, 15, 'Gaveta EPI'],
    ['Furadeira de impacto 110V', 'Ferramenta', 'un', 'Não', 'Não', '', 3, 1, 'Prateleira B2'],
    ['Rádio Motorola DEP450, carregador, bateria, antena', 'Equipamento', 'un', 'Não', 'Sim', 'RAD-001', 1, 0, 'Armário rádios'],
    ['Rádio Motorola DEP450, carregador, bateria, antena', 'Equipamento', 'un', 'Não', 'Sim', 'RAD-002', 1, 0, 'Armário rádios'],
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
  const lastCol = XLSX.utils.encode_col(headers.length - 1);
  ws['!autofilter'] = { ref: `A${headerRowIndex + 1}:${lastCol}${lastDataRow}` };

  ws['!cols'] = [
    { wch: 52 },
    { wch: 14 },
    { wch: 10 },
    { wch: 12 },
    { wch: 11 },
    { wch: 12 },
    { wch: 22 },
    { wch: 12 },
    { wch: 18 },
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
      cell.s = numCols.has(c) ? numStyle : exampleStyle;
    }
  }

  const instrTitle = {
    font: { bold: true, sz: 16, color: { rgb: '263238' } },
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
    ['• Não existe coluna de código: o LoggB gera o código de cada item sozinho.'],
    ['• DESCRIÇÃO DO ITEM: obrigatória. Item com a mesma descrição de um já cadastrado atualiza o cadastro e o saldo.'],
    [
      '• KIT: se a descrição tiver vírgulas, é um kit. A primeira parte é o item; o resto é o que acompanha. Ex.: "Rádio Motorola DEP450, carregador, bateria, antena" = rádio que acompanha carregador, bateria e antena. Os acessórios não têm saldo próprio: saem e voltam junto com o item.',
    ],
    ['• CATEGORIA: ex. EPI, Ferramenta, Equipamento. A categoria define em qual almoxarifado o item aparece.'],
    ['• UNIDADE: un, par, m, kg, cx, etc.'],
    ['• CONSUMÍVEL: Sim ou Não (também aceita S, 1, TRUE).'],
    [
      '• ITEM ÚNICO: Sim para itens controlados um a um (rádio, furadeira com patrimônio). Use uma linha para cada unidade, com quantidade 1 e a TAG dela.',
    ],
    ['• TAG: identificação da unidade (patrimônio, nº de série). Preencher a TAG já marca a linha como item único.'],
    ['• QUANTIDADE EM ESTOQUE: saldo atual no almoxarifado ao importar.'],
    ['• QTD MÍNIMO: ponto de alerta de reposição.'],
    ['• LOCAL: prateleira, armário ou endereço interno.'],
    ['• CA do EPI: não vai na planilha. Ele é preenchido na hora da entrega ao colaborador (e pode ser corrigido depois no Histórico).'],
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
