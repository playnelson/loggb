/**
 * Fichas de carteira em texto (.txt), organizadas para impressão ou arquivo.
 */
import { formatEmployeeName } from '@/lib/employeeName';

export type FichaTxtMeta = {
  companyName: string;
  companyCnpj: string;
  branchOrDept: string;
  issuedAtLabel: string;
  responsibleName: string;
};

export type FichaTxtEmployee = {
  full_name: string;
  role: string | null;
  cpf?: string | null;
  department?: string | null;
};

export type FichaPossessionRow = {
  description: string;
  unit: string;
  quantity: number;
  /** Usado na ficha de ferramentas / demais materiais */
  category?: string;
  /** Texto curto na ficha de EPI (ex.: tipo de controle) */
  remark?: string;
};

const LINE_WIDTH = 78;

function repeatChar(ch: string, n: number) {
  return ch.repeat(Math.max(0, n));
}

function formatCpfDisplay(cpf: string | null | undefined): string {
  if (!cpf) return '—';
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
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
  return `${prefix}_${s}.txt`;
}

function wrapLine(text: string, width: number): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return [''];
  const out: string[] = [];
  let rest = t;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width);
    if (cut <= 0) cut = width;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function padCell(s: string, w: number) {
  const str = String(s ?? '');
  if (str.length >= w) return str.slice(0, w - 1) + '…';
  return str.padEnd(w, ' ');
}

function blockTitle(title: string) {
  const inner = ` ${title} `;
  const pad = Math.max(0, LINE_WIDTH - 2 - inner.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return `${repeatChar('═', left)}${inner}${repeatChar('═', right)}`;
}

function sectionHeader(label: string) {
  return [
    '',
    repeatChar('─', LINE_WIDTH),
    `  ${label}`,
    repeatChar('─', LINE_WIDTH),
  ].join('\n');
}

function kv(label: string, value: string) {
  return `  ${label.padEnd(22, ' ')} ${value || '—'}`;
}

function buildFooter(kind: 'epi' | 'ferramentas') {
  const note =
    kind === 'epi'
      ? 'Relação de EPIs do colaborador: não consumíveis em posse e consumíveis com saldo retirado (em uso). ' +
        'Descarte de EPI consumível é registrado no sistema (não retorna ao estoque). ' +
        'Documento para uso interno; complemente conforme política da empresa e NR aplicável.'
      : 'Relação de ferramentas e demais materiais não consumíveis (exceto categoria EPI) em posse do colaborador, ' +
        'conforme cadastro do sistema na data acima. Documento para uso interno e arquivo.';

  const lines = wrapLine(note, LINE_WIDTH - 2);
  return [
    '',
    sectionHeader('OBSERVAÇÃO'),
    ...lines.map((ln) => `  ${ln}`),
    '',
    repeatChar('═', LINE_WIDTH),
    '  FIM DO DOCUMENTO',
    repeatChar('═', LINE_WIDTH),
    '',
  ].join('\n');
}

function buildHeaderDocTitle(title: string, subtitle: string, generatedAt: string) {
  return [
    repeatChar('═', LINE_WIDTH),
    blockTitle(title),
    repeatChar('═', LINE_WIDTH),
    '',
    `  ${subtitle}`,
    `  Arquivo gerado em (sistema): ${generatedAt}`,
    '',
  ].join('\n');
}

export function buildEpiFichaTxtContent(
  employee: FichaTxtEmployee,
  rows: FichaPossessionRow[],
  meta: FichaTxtMeta,
  generatedAt: string
): string {
  const parts: string[] = [];
  parts.push(
    buildHeaderDocTitle(
      'FICHA DE EPI — CONTROLE DE POSSE',
      'Equipamentos de Proteção Individual (não consumíveis) em posse do colaborador.',
      generatedAt
    )
  );

  parts.push(sectionHeader('DADOS DO EMPREGADOR'));
  parts.push(kv('Razão social / nome', meta.companyName.trim()));
  parts.push(kv('CNPJ', meta.companyCnpj.trim() || '—'));
  parts.push(kv('Setor / estabelecimento', meta.branchOrDept.trim() || '—'));

  parts.push(sectionHeader('DADOS DO COLABORADOR'));
  parts.push(kv('Nome completo', formatEmployeeName(employee.full_name)));
  parts.push(kv('CPF', formatCpfDisplay(employee.cpf)));
  parts.push(kv('Função / cargo', employee.role?.trim() || '—'));
  parts.push(kv('Departamento', employee.department?.trim() || '—'));

  parts.push(sectionHeader('RESPONSÁVEL PELA EMISSÃO'));
  parts.push(kv('Data do documento', meta.issuedAtLabel || '—'));
  parts.push(kv('Responsável (entrega / arquivo)', meta.responsibleName.trim() || '—'));

  parts.push(sectionHeader('RELACAO DE EPIs EM POSSE'));
  if (rows.length === 0) {
    parts.push('  (Nenhum EPI não consumível em posse no momento.)');
  } else {
    const nW = 4;
    const dW = 46;
    const uW = 8;
    const qW = 8;
    parts.push(
      `  ${padCell('#', nW)} ${padCell('Descrição do EPI', dW)} ${padCell('Un.', uW)} ${padCell('Qtd', qW)}`
    );
    parts.push(`  ${repeatChar('─', nW)} ${repeatChar('─', dW)} ${repeatChar('─', uW)} ${repeatChar('─', qW)}`);
    rows.forEach((r, i) => {
      const descSource = r.remark ? `${r.description} — ${r.remark}` : r.description;
      const descLines = wrapLine(descSource, dW);
      descLines.forEach((line, li) => {
        const num = li === 0 ? String(i + 1) : '';
        const qty = li === 0 ? String(r.quantity) : '';
        const unit = li === 0 ? r.unit : '';
        parts.push(
          `  ${padCell(num, nW)} ${padCell(line, dW)} ${padCell(unit, uW)} ${padCell(qty, qW)}`
        );
      });
    });
    parts.push('');
    parts.push(`  Total de linhas: ${rows.length}`);
  }

  parts.push(buildFooter('epi'));
  return parts.join('\n');
}

export function buildFerramentasFichaTxtContent(
  employee: FichaTxtEmployee,
  rows: FichaPossessionRow[],
  meta: FichaTxtMeta,
  generatedAt: string
): string {
  const parts: string[] = [];
  parts.push(
    buildHeaderDocTitle(
      'FICHA DE FERRAMENTAS E DEMAIS MATERIAIS',
      'Materiais não consumíveis em posse (exceto categoria EPI).',
      generatedAt
    )
  );

  parts.push(sectionHeader('DADOS DO EMPREGADOR'));
  parts.push(kv('Razão social / nome', meta.companyName.trim()));
  parts.push(kv('CNPJ', meta.companyCnpj.trim() || '—'));
  parts.push(kv('Setor / estabelecimento', meta.branchOrDept.trim() || '—'));

  parts.push(sectionHeader('DADOS DO COLABORADOR'));
  parts.push(kv('Nome completo', formatEmployeeName(employee.full_name)));
  parts.push(kv('CPF', formatCpfDisplay(employee.cpf)));
  parts.push(kv('Função / cargo', employee.role?.trim() || '—'));
  parts.push(kv('Departamento', employee.department?.trim() || '—'));

  parts.push(sectionHeader('RESPONSÁVEL PELA EMISSÃO'));
  parts.push(kv('Data do documento', meta.issuedAtLabel || '—'));
  parts.push(kv('Responsável (entrega / arquivo)', meta.responsibleName.trim() || '—'));

  parts.push(sectionHeader('RELACAO DE MATERIAIS EM POSSE'));
  if (rows.length === 0) {
    parts.push('  (Nenhum material deste tipo em posse no momento.)');
  } else {
    const nW = 4;
    const cW = 14;
    const dW = 30;
    const uW = 6;
    const qW = 6;
    parts.push(
      `  ${padCell('#', nW)} ${padCell('Categoria', cW)} ${padCell('Descrição', dW)} ${padCell('Un.', uW)} ${padCell('Qtd', qW)}`
    );
    parts.push(
      `  ${repeatChar('─', nW)} ${repeatChar('─', cW)} ${repeatChar('─', dW)} ${repeatChar('─', uW)} ${repeatChar('─', qW)}`
    );
    rows.forEach((r, i) => {
      const cat = (r.category || '—').trim() || '—';
      const descLines = wrapLine(r.description, dW);
      descLines.forEach((line, li) => {
        const num = li === 0 ? String(i + 1) : '';
        const catCell = li === 0 ? cat : '';
        const qty = li === 0 ? String(r.quantity) : '';
        const unit = li === 0 ? r.unit : '';
        parts.push(
          `  ${padCell(num, nW)} ${padCell(catCell, cW)} ${padCell(line, dW)} ${padCell(unit, uW)} ${padCell(qty, qW)}`
        );
      });
    });
    parts.push('');
    parts.push(`  Total de linhas: ${rows.length}`);
  }

  parts.push(buildFooter('ferramentas'));
  return parts.join('\n');
}

function triggerTxtDownload(filename: string, content: string) {
  const bom = '\uFEFF';
  const blob = new Blob([bom + content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadEpiFichaTxt(employee: FichaTxtEmployee, rows: FichaPossessionRow[], meta: FichaTxtMeta) {
  const generatedAt = new Date().toLocaleString('pt-BR');
  const content = buildEpiFichaTxtContent(employee, rows, meta, generatedAt);
  triggerTxtDownload(filenameSlug(formatEmployeeName(employee.full_name), 'ficha_epi'), content);
}

export function downloadFerramentasFichaTxt(
  employee: FichaTxtEmployee,
  rows: FichaPossessionRow[],
  meta: FichaTxtMeta
) {
  const generatedAt = new Date().toLocaleString('pt-BR');
  const content = buildFerramentasFichaTxtContent(employee, rows, meta, generatedAt);
  triggerTxtDownload(filenameSlug(formatEmployeeName(employee.full_name), 'ficha_ferramentas'), content);
}
