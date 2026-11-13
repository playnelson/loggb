/**
 * Documentos para imprimir ou salvar em PDF (pelo "Salvar como PDF" do navegador):
 * - recibo de retirada / comprovante de devolução (uma retirada do carrinho = um recibo);
 * - ficha de controle de entrega de EPI (NR-6), com termo de responsabilidade.
 */
import type { createBrowserClient } from '@supabase/ssr';
import { formatEmployeeName } from '@/lib/employeeName';
import { formatProductLabelDisplay } from '@/lib/productDisplayText';
import { formatQty, movementReasonOf, receiptNumber, MOVEMENT_REASON_LABEL, type MovementReason } from '@/lib/movements';

type SupabaseClient = ReturnType<typeof createBrowserClient>;

/* ------------------------------------------------------------------ empresa */

export type CompanyInfo = {
  companyName: string;
  companyCnpj: string;
  branchOrDept: string;
  responsibleName: string;
};

/** Mesma chave usada desde as fichas antigas — os dados já salvos continuam valendo. */
export const COMPANY_INFO_STORAGE_KEY = 'loggb_epi_ficha_defaults';

export function loadCompanyInfo(): CompanyInfo {
  const empty: CompanyInfo = { companyName: '', companyCnpj: '', branchOrDept: '', responsibleName: '' };
  if (typeof window === 'undefined') return empty;
  try {
    const saved = JSON.parse(localStorage.getItem(COMPANY_INFO_STORAGE_KEY) || '{}') as Partial<CompanyInfo>;
    return {
      companyName: typeof saved.companyName === 'string' ? saved.companyName : '',
      companyCnpj: typeof saved.companyCnpj === 'string' ? saved.companyCnpj : '',
      branchOrDept: typeof saved.branchOrDept === 'string' ? saved.branchOrDept : '',
      responsibleName: typeof saved.responsibleName === 'string' ? saved.responsibleName : '',
    };
  } catch {
    return empty;
  }
}

export function saveCompanyInfo(info: CompanyInfo): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(COMPANY_INFO_STORAGE_KEY, JSON.stringify(info));
  } catch {
    /* armazenamento indisponível (aba anônima etc.) — segue sem salvar */
  }
}

/* ------------------------------------------------------------- timbrado */

/**
 * Layout no modelo do papel timbrado (logo no alto à esquerda, linha azul no rodapé com os
 * dados da empresa). A logo é a da organização (Workspaces › editar organização).
 */
let PRINT_BRAND: { logo: string | null; orgName: string } = { logo: null, orgName: '' };

export function setPrintBranding(brand: { logo: string | null; orgName: string }): void {
  PRINT_BRAND = brand;
}

/** Só imagens embutidas (data URL) entram no documento. */
function safeLogo(src: string | null): string | null {
  return src && /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(src) ? src : null;
}

function pageFooter(): string {
  const c = loadCompanyInfo();
  const name = c.companyName.trim() || PRINT_BRAND.orgName.trim();
  const parts = [
    name ? `<b>${esc(name)}</b>` : '',
    c.companyCnpj.trim() ? `CNPJ: ${esc(c.companyCnpj.trim())}` : '',
    esc(c.branchOrDept.trim()),
  ].filter(Boolean);
  if (parts.length === 0) return '';
  return `<footer class="pagefoot">${parts.join(' &nbsp;·&nbsp; ')}</footer>`;
}

/* ---------------------------------------------------------------- utilitários */

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatCpf(cpf: string | null | undefined): string {
  if (!cpf) return '';
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function dateBr(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function dateTimeBr(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

const DOC_CSS = `
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:Arial,Helvetica,sans-serif;color:#263238;margin:0;padding:24px;font-size:12px;background:#fff}
  .brand img{display:block;max-height:84px;max-width:240px;object-fit:contain}
  .brand .co{font-weight:700;font-size:16px;color:#2E74B5}
  .ct{width:100%;border-collapse:collapse;margin:0}
  .ct td,.ct th{border:1px solid #595959;padding:4px 7px;font-size:11px;vertical-align:middle;color:#000}
  .ct th{background:#F2F2F2;color:#000;font-size:10.5px;font-weight:700;text-align:center;text-transform:uppercase}
  .ct td.ct-logo{width:160px;text-align:center}
  .ct-logo img{display:inline-block;max-height:64px;max-width:150px;object-fit:contain}
  .ct-logo .co{font-weight:700;font-size:13px;color:#1F4E79}
  .ct td.ct-title{background:#F3F6FA;text-align:center;color:#2F5597;font-weight:700;font-size:18px;text-transform:uppercase;line-height:1.25}
  .ct td.ct-title small{display:block;font-size:12px;font-weight:600}
  .ct td.ct-sub{text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.3px}
  .ct-meta td{font-size:10px;text-transform:uppercase}
  .sec{background:#2F5597;color:#fff;font-weight:700;font-size:11px;text-transform:uppercase;padding:4px 8px;margin-top:8px;border:1px solid #2F5597}
  .ct .lbl{font-weight:700;text-transform:uppercase;color:#000}
  .ct .acc{display:block;color:#455a64;font-size:10px;margin-top:2px}
  .ct-term{border:1px solid #595959;color:#000;border-top:0;padding:8px 10px;font-size:11px;line-height:1.5;text-align:justify}
  .ct-term ol{margin:6px 0 0 16px;padding:0}
  .ct-term li{margin-bottom:3px}
  .ct-sign td{height:58px;vertical-align:top;width:50%}
  .ct-sign td .lbl{display:block;background:#F2F2F2;margin:-4px -7px 4px;padding:3px 7px;border-bottom:1px solid #595959}
  .ct-sign .ln{border-bottom:1px solid #263238;height:26px;margin-top:4px}
  .box{display:inline-block;width:10px;height:10px;border:1px solid #263238;margin:0 3px -1px 6px}
  .pagefoot{margin-top:28px;border-top:1px solid #2E74B5;padding-top:5px;font-size:9px;color:#455a64;text-align:center}
  .doc{max-width:780px;margin:0 auto}
  .toolbar{max-width:780px;margin:0 auto 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;
    background:#eceff1;border:1px solid #cbd5e1;border-radius:8px;padding:10px}
  .toolbar button{font:inherit;font-weight:700;padding:8px 14px;border-radius:3px;border:1px solid #2E74B5;
    background:#2E74B5;color:#fff;cursor:pointer}
  .toolbar button.sec{background:#fff;color:#2E74B5}
  .toolbar span{color:#455a64;font-size:11px}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:10px;margin-bottom:14px}
  header .co{font-weight:700;font-size:14px}
  header .sub{color:#455a64;font-size:11px}
  header .no{text-align:right;font-size:11px;color:#37474f;white-space:nowrap}
  header .no b{font-size:14px;color:#263238}
  h1{font-size:15px;text-align:center;margin:8px 0 12px;letter-spacing:.5px;text-transform:uppercase;color:#1F4E79}
  h2{font-size:12px;margin:16px 0 6px;text-transform:uppercase;color:#37474f}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px}
  .grid div span{color:#607d8b;font-size:10px;text-transform:uppercase;display:block}
  .grid div b{font-size:12px}
  .full{grid-column:1 / -1}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{border:1px solid #94a3b8;padding:5px 6px;text-align:left;vertical-align:top}
  th{background:#DEEAF6;color:#1F4E79;font-size:10px;text-transform:uppercase}
  td.n,th.n{text-align:right;white-space:nowrap}
  td.c,th.c{text-align:center;white-space:nowrap}
  td.sig{width:150px}
  tr{page-break-inside:avoid}
  .term{border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;line-height:1.45;font-size:11px}
  .term ol{margin:6px 0 6px 18px;padding:0}
  .signs{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:40px}
  .signs div{border-top:1px solid #263238;padding-top:4px;text-align:center;font-size:11px}
  .signs small{display:block;color:#455a64}
  .muted{color:#607d8b}
  .foot{margin-top:18px;font-size:9px;color:#607d8b;text-align:center}
  @media print{
    body{padding:0 0 14mm}
    .toolbar{display:none}
    .pagefoot{position:fixed;left:0;right:0;bottom:0;margin:0;background:#fff}
    @page{size:A4;margin:12mm 12mm 14mm}
  }
`;

export function wrapDocument(title: string, body: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${DOC_CSS}</style></head><body>
<div class="toolbar"><button onclick="window.print()">Imprimir / salvar PDF</button>
<button class="sec" onclick="window.close()">Fechar</button>
<span>Para PDF, escolha “Salvar como PDF” no destino da impressão.</span></div>
<div class="doc">${body}${pageFooter()}</div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},300)});</script>
</body></html>`;
}

/**
 * Abre o documento numa nova aba e chama a impressão.
 * A aba é aberta NA HORA do clique (antes de buscar dados) para não ser barrada pelo bloqueador de pop-ups.
 */
export async function openPrintable(
  title: string,
  build: () => Promise<string | { error: string }>
): Promise<void> {
  const w = window.open('', '_blank');
  if (!w) {
    alert('O navegador bloqueou a nova aba. Permita pop-ups para este site e tente de novo.');
    return;
  }
  w.document.open();
  w.document.write(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title></head>` +
      `<body style="font-family:Arial,sans-serif;padding:24px;color:#37474f">Gerando documento…</body></html>`
  );
  w.document.close();
  try {
    const out = await build();
    if (w.closed) return;
    w.document.open();
    if (typeof out === 'string') {
      w.document.write(wrapDocument(title, out));
    } else {
      w.document.write(
        `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title></head>` +
          `<body style="font-family:Arial,sans-serif;padding:24px;color:#b91c1c">${esc(out.error)}</body></html>`
      );
    }
    w.document.close();
  } catch (err) {
    if (w.closed) return;
    w.document.open();
    w.document.write(
      `<body style="font-family:Arial,sans-serif;padding:24px;color:#b91c1c">Erro ao gerar documento: ${esc(
        err instanceof Error ? err.message : String(err)
      )}</body>`
    );
    w.document.close();
  }
}

function companyHeader(company: CompanyInfo, rightHtml: string): string {
  const name = company.companyName.trim() || PRINT_BRAND.orgName.trim() || 'Empresa (preencha em Colaboradores → Fichas)';
  const sub = [company.companyCnpj.trim() ? `CNPJ ${esc(company.companyCnpj.trim())}` : '', esc(company.branchOrDept.trim())]
    .filter(Boolean)
    .join(' · ');
  const logo = safeLogo(PRINT_BRAND.logo);
  const left = logo
    ? `<div class="brand"><img src="${logo}" alt="${esc(PRINT_BRAND.orgName || name)}"></div>`
    : `<div class="brand"><div class="co">${esc(name)}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  return `<header>${left}<div class="no">${rightHtml}</div></header>`;
}

/* -------------------------------------------------------------------- recibo */

type ReceiptRow = {
  id: string;
  created_at: string;
  quantity: number;
  type: string;
  reason?: string | null;
  tag?: string | null;
  note?: string | null;
  document?: string | null;
  batch_id?: string | null;
  ca_number?: string | null;
  employee_id?: string | null;
  work_site_id?: string | null;
  items?: {
    description?: string;
    unit?: string;
    category?: string;
    ca_number?: string | null;
    consumable?: boolean | null;
    accessories?: string[] | null;
  } | null;
  employees?: { full_name?: string; cpf?: string | null; role?: string | null; department?: string | null } | null;
  work_sites?: { name?: string; kind?: string } | null;
};

const RECEIPT_SELECT =
  'id, created_at, quantity, type, reason, tag, note, document, batch_id, ca_number, employee_id, work_site_id, ' +
  'items(description, unit, category, ca_number, consumable, accessories), employees(full_name, cpf, role, department), work_sites(name, kind)';

function receiptTitle(reason: MovementReason, toSite: boolean): string {
  if (reason === 'saida') return toSite ? 'Guia de envio de material' : 'Recibo de retirada de material';
  if (reason === 'devolucao') return 'Comprovante de devolução de material';
  if (reason === 'descarte') return 'Registro de descarte de EPI';
  return `Comprovante de movimentação — ${MOVEMENT_REASON_LABEL[reason]}`;
}

function receiptDeclaration(reason: MovementReason, toSite: boolean): string {
  if (reason === 'saida' && toSite) {
    return 'Declaro que recebi no local acima os materiais relacionados, nas quantidades indicadas, e me responsabilizo por sua guarda até a devolução ou o consumo na obra.';
  }
  if (reason === 'saida') {
    return 'Declaro que recebi os materiais acima relacionados em perfeitas condições de uso. Comprometo-me a utilizá-los somente para a finalidade a que se destinam, a zelar por sua guarda e conservação e a devolvê-los quando solicitado ou no meu desligamento da empresa (materiais não consumíveis). Em caso de dano ou extravio, comunicarei imediatamente o almoxarifado.';
  }
  if (reason === 'devolucao') {
    return 'O almoxarifado declara ter recebido de volta os materiais acima relacionados, nas quantidades indicadas.';
  }
  if (reason === 'descarte') {
    return 'Os itens acima foram recolhidos para descarte (desgaste, dano ou fim da vida útil) e não retornam ao estoque.';
  }
  return 'Movimentação registrada no sistema conforme os dados acima.';
}

/**
 * Monta o recibo de uma retirada (todas as linhas do mesmo lote) ou de uma única movimentação.
 */
export async function buildReceiptHtml(
  supabase: SupabaseClient,
  key: { batchId?: string | null; movementId?: string | null },
  company: CompanyInfo
): Promise<string | { error: string }> {
  let q = supabase.from('movements').select(RECEIPT_SELECT);
  if (key.batchId) q = q.eq('batch_id', key.batchId);
  else if (key.movementId) q = q.eq('id', key.movementId);
  else return { error: 'Recibo sem identificação.' };
  const { data, error } = await q.order('created_at', { ascending: true }).order('id', { ascending: true });
  if (error) return { error: `Erro ao carregar o recibo: ${error.message}` };
  const rows = ((data as unknown) as ReceiptRow[]) || [];
  if (rows.length === 0) return { error: 'Nenhuma movimentação encontrada para este recibo.' };

  const first = rows[0];
  const reason = movementReasonOf(first);
  const emp = one(first.employees);
  const site = one(first.work_sites);
  const toSite = !emp && !!site;
  const number = receiptNumber(first.batch_id || first.id);
  const title = receiptTitle(reason, toSite);

  const docs = [...new Set(rows.map((r) => r.document?.trim()).filter(Boolean))] as string[];
  const notes = [...new Set(rows.map((r) => r.note?.trim()).filter(Boolean))] as string[];
  const hasCa = rows.some((r) => (r.ca_number || one(r.items)?.ca_number || '').trim());
  const hasTag = rows.some((r) => (r.tag || '').trim() && movementReasonOf(r) !== 'descarte');

  const companyName = company.companyName.trim() || PRINT_BRAND.orgName.trim() || 'a empresa';
  const logo = safeLogo(PRINT_BRAND.logo);
  const logoCell = logo
    ? `<img src="${logo}" alt="${esc(companyName)}">`
    : `<div class="co">${esc(companyName)}</div>`;
  // Entrega a colaborador com algo que volta (não consumível) = termo de responsabilidade (modelo das cautelas).
  const durable = rows.filter((r) => !one(r.items)?.consumable);
  const isTermo = reason === 'saida' && !!emp && durable.length > 0;
  const heading = isTermo ? 'Termo de responsabilidade' : title;
  const subHeading = isTermo ? 'Entrega de materiais e equipamentos' : '';
  const control = toSite ? 'Controle de materiais em obra' : emp ? 'Gestão patrimonial – controle de equipamentos e materiais' : 'Controle de estoque';

  const header = `<table class="ct"><tr><td class="ct-logo">${logoCell}</td>
<td class="ct-title">${esc(heading)}${subHeading ? `<small>${esc(subHeading)}</small>` : ''}</td></tr>
<tr><td colspan="2" class="ct-sub">${esc(control)}</td></tr></table>
<table class="ct ct-meta"><tr><td>Recibo nº: <b>${esc(number)}</b></td><td>Data: <b>${esc(dateTimeBr(first.created_at))}</b></td>${
    docs.length ? `<td>Documento: <b>${esc(docs.join(', '))}</b></td>` : ''
  }</tr></table>`;

  let n = 0;
  const secTitle = (t: string) => `<div class="sec">${++n}. ${esc(t)}</div>`;

  let party = '';
  if (emp) {
    party = `${secTitle('Identificação do colaborador')}
<table class="ct"><tr><td style="width:65%"><span class="lbl">Nome:</span> ${esc(formatEmployeeName(emp.full_name))}</td>
<td><span class="lbl">CPF:</span> ${esc(formatCpf(emp.cpf) || '—')}</td></tr>
<tr><td><span class="lbl">Função:</span> ${esc(emp.role || '—')}</td><td><span class="lbl">Setor:</span> ${esc(emp.department || '—')}</td></tr></table>`;
  } else if (site) {
    party = `${secTitle(site.kind === 'sede' ? 'Sede' : 'Canteiro / local')}
<table class="ct"><tr><td><span class="lbl">Local:</span> ${esc(site.name)}</td></tr></table>`;
  }

  const lines = rows
    .map((r, i) => {
      const it = one(r.items);
      const ca = (r.ca_number || it?.ca_number || '').trim();
      const tag = movementReasonOf(r) === 'descarte' ? '' : (r.tag || '').trim();
      const acc = (it?.accessories ?? []).filter(Boolean);
      return `<tr><td class="c">${i + 1}</td><td>${esc(formatProductLabelDisplay(it?.description || '—'))}${
        acc.length ? `<span class="acc">Acompanha: ${esc(acc.map((a) => formatProductLabelDisplay(a)).join(', '))}</span>` : ''
      }</td>${hasTag ? `<td>${esc(tag || '—')}</td>` : ''}${hasCa ? `<td class="c">${esc(ca || '—')}</td>` : ''}<td class="n">${esc(
        formatQty(r.quantity)
      )}</td><td class="c">${esc(it?.unit || 'un')}</td></tr>`;
    })
    .join('');
  const itemsSec = `${secTitle(
    reason === 'devolucao' ? 'Itens devolvidos' : reason === 'descarte' ? 'Itens descartados' : 'Itens entregues'
  )}
<table class="ct"><thead><tr><th class="c">#</th><th>Item</th>${hasTag ? '<th>TAG / Nº de série</th>' : ''}${
    hasCa ? '<th class="c">Nº CA</th>' : ''
  }<th class="n">Qtd.</th><th class="c">Un.</th></tr></thead><tbody>${lines}</tbody></table>
${notes.length ? `<table class="ct"><tr><td><span class="lbl">Observação:</span> ${esc(notes.join(' · '))}</td></tr></table>` : ''}`;

  const termo = isTermo
    ? `${secTitle('Termo de responsabilidade')}
<div class="ct-term">Pelo presente termo, eu, colaborador identificado acima, declaro ter recebido de <b>${esc(companyName)}</b>,
a título de empréstimo e para uso exclusivo nas minhas atividades de trabalho, os itens relacionados acima, em perfeito estado,
comprometendo-me a mantê-los em bom estado de conservação e ficando ciente de que:
${TERMO_CLAUSES}</div>`
    : `${secTitle('Declaração')}<div class="ct-term">${esc(receiptDeclaration(reason, toSite))}</div>`;

  const partyName = emp ? formatEmployeeName(emp.full_name) : '';
  const staffName = company.responsibleName.trim();
  const signCell = (label: string, name: string) =>
    `<td><span class="lbl">${esc(label)}</span><br>Nome por extenso: ${esc(name)}<div class="ln"></div></td>`;
  const [leftLabel, rightLabel] =
    reason === 'devolucao'
      ? ['Quem devolveu', 'Recebido por']
      : reason === 'descarte'
        ? ['Colaborador', 'Almoxarifado']
        : [emp ? 'Colaborador' : toSite ? `Responsável em ${site?.name ?? 'local'}` : 'Recebedor', 'Entregue por'];
  const signs = `<table class="ct ct-sign"><tr>${signCell(leftLabel, partyName)}${signCell(rightLabel, staffName)}</tr></table>`;

  const devolucao = isTermo
    ? `${secTitle('Devolução')}
<table class="ct"><tr><td><span class="lbl">Data da devolução:</span> ____/____/________</td></tr></table>
<table class="ct"><thead><tr><th>Item</th><th class="c">Devolveu?</th><th>Observação (dano, falta etc.)</th></tr></thead><tbody>${durable
        .map((r) => {
          const it = one(r.items);
          const tag = (r.tag || '').trim();
          return `<tr><td>${esc(formatProductLabelDisplay(it?.description || '—'))}${tag ? ` <span class="muted">(${esc(tag)})</span>` : ''}</td>
<td class="c"><span class="box"></span>Sim <span class="box"></span>Não</td><td></td></tr>`;
        })
        .join('')}</tbody></table>
<table class="ct ct-sign"><tr>${signCell('Colaborador', partyName)}${signCell('Recebido por', '')}</tr></table>`
    : '';

  return `${header}
${party}
${itemsSec}
${termo}
${signs}
${devolucao}
<p class="foot">Documento de controle interno – arquivar o original assinado na pasta do colaborador/obra. Gerado pelo LoggB em ${esc(
    dateTimeBr(new Date())
  )} · Recibo ${esc(number)}</p>`;
}

/* ------------------------------------------------------------ ficha de EPI */

/** Cláusulas do termo de responsabilidade (modelo das cautelas). */
const TERMO_CLAUSES = `<ol>
<li>os itens são de uso pessoal e intransferível, não podendo ser emprestados, cedidos ou retirados da obra sem autorização;</li>
<li>em caso de defeito, dano, extravio, furto ou roubo, devo comunicar imediatamente o meu superior; nos casos de furto ou roubo, devo apresentar o Boletim de Ocorrência;</li>
<li>se os itens forem danificados, inutilizados ou extraviados por mau uso, negligência ou descuido, autorizo o desconto do valor do reparo ou da reposição em meu salário ou em minhas verbas rescisórias, conforme o art. 462, § 1º, da CLT. Defeitos de fabricação e o desgaste natural pelo uso não serão cobrados;</li>
<li>ao término do serviço, na mudança de função ou de obra, no desligamento ou quando solicitado, devolverei os itens completos e em bom estado, considerado o tempo de uso;</li>
<li>enquanto os itens estiverem em minha posse, estarei sujeito a conferência a qualquer momento, sem aviso prévio.</li>
</ol>`;

export type EpiFichaEmployee = {
  id: string;
  full_name: string;
  cpf?: string | null;
  role?: string | null;
  department?: string | null;
};

type EpiMoveRow = {
  id: string;
  created_at: string;
  quantity: number;
  type: string;
  reason?: string | null;
  tag?: string | null;
  note?: string | null;
  document?: string | null;
  batch_id?: string | null;
  ca_number?: string | null;
  employee_id?: string | null;
  work_site_id?: string | null;
  items?: { description?: string; unit?: string; category?: string; consumable?: boolean; ca_number?: string | null } | null;
};

function isEpiCategory(category: string | null | undefined): boolean {
  return String(category || '').trim().toUpperCase() === 'EPI';
}

const EPI_MOVE_LABEL: Partial<Record<MovementReason, string>> = {
  saida: 'Entrega',
  devolucao: 'Devolução',
  descarte: 'Descarte / troca',
  importacao: 'Saldo importado',
};

/**
 * Ficha de controle de entrega de EPI (NR-6): termo de responsabilidade, entregas com data e nº do CA,
 * devoluções/descartes e EPIs em uso. Uma linha de assinatura por entrega.
 */
export async function buildEpiFichaHtml(
  supabase: SupabaseClient,
  employee: EpiFichaEmployee,
  company: CompanyInfo,
  opts: { since?: string | null; issuedAt?: string | null } = {}
): Promise<string | { error: string }> {
  const all: EpiMoveRow[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await supabase
      .from('movements')
      .select(
        'id, created_at, quantity, type, reason, tag, note, document, batch_id, ca_number, employee_id, work_site_id, items(description, unit, category, consumable, ca_number)'
      )
      .eq('employee_id', employee.id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) return { error: `Erro ao carregar as movimentações: ${error.message}` };
    const chunk = ((data as unknown) as EpiMoveRow[]) || [];
    all.push(...chunk);
    if (chunk.length < 1000) break;
  }

  const epiRows = all.filter((m) => {
    const it = one(m.items);
    return it && isEpiCategory(it.category) && EPI_MOVE_LABEL[movementReasonOf(m)];
  });

  // EPIs em uso: saídas − devoluções − descartes, sobre o histórico INTEIRO (o período só filtra a tabela).
  const balance = new Map<string, { description: string; unit: string; ca: string; qty: number; last: string }>();
  for (const m of epiRows) {
    const it = one(m.items)!;
    const key = formatProductLabelDisplay(it.description || '—');
    const cur = balance.get(key) || { description: key, unit: it.unit || 'un', ca: '', qty: 0, last: m.created_at };
    const q = Number(m.quantity) || 0;
    if (m.type === 'OUT') {
      // Descartável (máscara, protetor auricular…): a nova entrega substitui a anterior, não soma.
      cur.qty = it.consumable ? q : cur.qty + q;
      cur.last = m.created_at;
      cur.ca = (m.ca_number || it.ca_number || cur.ca || '').trim();
    } else {
      cur.qty = Math.max(0, cur.qty - q);
    }
    balance.set(key, cur);
  }
  const sinceMs = opts.since ? new Date(`${opts.since}T00:00:00`).getTime() : null;
  const tableRows = sinceMs == null ? epiRows : epiRows.filter((m) => new Date(m.created_at).getTime() >= sinceMs);
  const inUse = [...balance.values()]
    .map((b) => ({ ...b, qty: Math.round(b.qty * 1000) / 1000 }))
    .filter((b) => b.qty > 0)
    .sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));

  const issued = opts.issuedAt ? new Date(`${opts.issuedAt}T12:00:00`) : new Date();

  const movesHtml = tableRows.length
    ? tableRows
        .map((m) => {
          const it = one(m.items)!;
          const r = movementReasonOf(m);
          const ca = (m.ca_number || it.ca_number || '').trim();
          const extra = [m.document?.trim() ? `Doc. ${m.document.trim()}` : '', m.note?.trim() || '']
            .filter(Boolean)
            .join(' · ');
          return `<tr><td class="c">${esc(dateBr(m.created_at))}</td><td>${esc(EPI_MOVE_LABEL[r])}</td><td>${esc(
            formatProductLabelDisplay(it.description || '—')
          )}${extra ? `<br><span class="muted">${esc(extra)}</span>` : ''}</td><td class="c">${esc(ca || '—')}</td><td class="n">${esc(
            formatQty(m.quantity)
          )} ${esc(it.unit || 'un')}</td><td class="sig"></td></tr>`;
        })
        .join('')
    : `<tr><td colspan="6" class="muted">Nenhuma entrega de EPI registrada${opts.since ? ' no período' : ''}.</td></tr>`;

  // Linhas em branco para entregas futuras anotadas à mão.
  const blank = Array.from({ length: 5 })
    .map(() => '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td class="sig"></td></tr>')
    .join('');

  const inUseHtml = inUse.length
    ? `<table><thead><tr><th>EPI</th><th class="c">Nº CA</th><th class="n">Qtd. em uso</th><th class="c">Última entrega</th></tr></thead><tbody>${inUse
        .map(
          (b) =>
            `<tr><td>${esc(b.description)}</td><td class="c">${esc(b.ca || '—')}</td><td class="n">${esc(formatQty(b.qty))} ${esc(
              b.unit
            )}</td><td class="c">${esc(dateBr(b.last))}</td></tr>`
        )
        .join('')}</tbody></table>`
    : '<p class="muted">Nenhum EPI em uso pelo colaborador no momento.</p>';

  const name = formatEmployeeName(employee.full_name);
  return `${companyHeader(company, `Emitida em<br><b>${esc(dateBr(issued))}</b>`)}
<h1>Ficha de controle de entrega de EPI</h1>
<div class="grid">
<div class="full"><span>Colaborador</span><b>${esc(name)}</b></div>
<div><span>CPF</span><b>${esc(formatCpf(employee.cpf) || '—')}</b></div>
<div><span>Função</span><b>${esc(employee.role || '—')}</b></div>
<div class="full"><span>Setor / departamento</span><b>${esc(employee.department || '—')}</b></div>
</div>

<h2>Termo de responsabilidade</h2>
<div class="term">
Declaro que recebi da empresa acima, gratuitamente, os Equipamentos de Proteção Individual (EPI) relacionados nesta ficha,
com Certificado de Aprovação (CA) válido, e que fui orientado(a) e treinado(a) sobre o uso correto, a guarda e a conservação de cada um.
Comprometo-me, conforme a NR-6, a:
<ol>
<li>usar o EPI apenas para a finalidade a que se destina;</li>
<li>responsabilizar-me pela limpeza, guarda e conservação;</li>
<li>comunicar à empresa qualquer dano, extravio ou alteração que o torne impróprio para uso, e solicitar a troca;</li>
<li>cumprir as determinações da empresa sobre o uso adequado;</li>
<li>devolver os EPIs não consumíveis quando solicitado ou no meu desligamento.</li>
</ol>
Estou ciente de que a recusa injustificada ao uso do EPI fornecido constitui ato faltoso (art. 158, parágrafo único, da CLT).
</div>
<div class="signs"><div>${esc(name)}<small>Assinatura do colaborador</small></div><div>${esc(
    company.responsibleName.trim() || 'Nome legível'
  )}<small>Responsável pela entrega</small></div></div>

<h2>Registro de entregas, devoluções e trocas${opts.since ? ` (desde ${esc(dateBr(`${opts.since}T12:00:00`))})` : ''}</h2>
<table><thead><tr><th class="c">Data</th><th>Movimento</th><th>Descrição do EPI</th><th class="c">Nº CA</th><th class="n">Qtd.</th><th class="sig">Assinatura do colaborador</th></tr></thead>
<tbody>${movesHtml}${blank}</tbody></table>

<h2>EPIs em uso nesta data</h2>
${inUseHtml}
<p class="foot">Registro de fornecimento de EPI conforme NR-6. Gerado pelo LoggB em ${esc(dateTimeBr(new Date()))}.</p>`;
}

/* ------------------------------------------------------- folha de contagem */

export type CountSheetLine = {
  description: string;
  location?: string | null;
  unit: string;
  system_qty?: number | null;
};

/** Folha de contagem para anotar à mão (contagem cega esconde o saldo do sistema). */
export function buildCountSheetHtml(
  title: string,
  lines: CountSheetLine[],
  company: CompanyInfo,
  opts: { blind: boolean }
): string {
  const sorted = [...lines].sort(
    (a, b) =>
      String(a.location || '').localeCompare(String(b.location || ''), 'pt-BR') ||
      a.description.localeCompare(b.description, 'pt-BR')
  );
  const rows = sorted
    .map(
      (l, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(formatProductLabelDisplay(l.description))}</td><td>${esc(
          l.location || '—'
        )}</td><td class="c">${esc(l.unit || 'un')}</td>${
          opts.blind ? '' : `<td class="n">${esc(formatQty(l.system_qty ?? 0))}</td>`
        }<td class="sig"></td><td style="width:120px"></td></tr>`
    )
    .join('');
  return `${companyHeader(company, `Folha de contagem<br><b>${esc(dateBr(new Date()))}</b>`)}
<h1>${esc(title)}</h1>
<p class="muted">${sorted.length} item(ns), em ordem de local.${
    opts.blind ? ' Contagem cega: o saldo do sistema não aparece nesta folha.' : ''
  } Anote a quantidade encontrada e lance no LoggB em Inventário.</p>
<table><thead><tr><th class="c">#</th><th>Descrição</th><th>Local</th><th class="c">Un.</th>${
    opts.blind ? '' : '<th class="n">Sistema</th>'
  }<th class="sig">Contado</th><th>Obs.</th></tr></thead><tbody>${rows}</tbody></table>
<div class="signs"><div>Nome legível<small>Conferente</small></div><div>${esc(
    company.responsibleName.trim() || 'Nome legível'
  )}<small>Responsável pelo almoxarifado</small></div></div>`;
}

export type QrLabelItem = {
  id: string;
  description: string;
  tag?: string | null;
  location?: string | null;
  unit?: string | null;
};

/** Link gravado no QR: abre o item direto no almoxarifado (pede login se preciso). */
export function itemQrUrl(origin: string, itemId: string): string {
  return `${origin.replace(/\/+$/, '')}/inventory?item=${encodeURIComponent(itemId)}`;
}

/** Etiquetas com QR code (3 por linha em A4), uma por item. */
export async function buildQrLabelsHtml(items: QrLabelItem[], origin: string): Promise<string> {
  const QRCode = (await import('qrcode')).default;
  const cells: string[] = [];
  for (const it of items) {
    const svg = await QRCode.toString(itemQrUrl(origin, it.id), {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
    });
    cells.push(`<div class="lbl"><div class="qr">${svg}</div><div class="txt">
<div class="d">${esc(it.description)}</div>
${it.tag ? `<div class="t">TAG ${esc(it.tag)}</div>` : ''}
${it.location ? `<div class="l">${esc(it.location)}</div>` : ''}
</div></div>`);
  }
  return `<style>
.lbls{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
.lbl{border:1px dashed #94a3b8;border-radius:2mm;padding:3mm;display:flex;gap:3mm;align-items:center;break-inside:avoid;page-break-inside:avoid;min-height:28mm}
.lbl .qr{width:24mm;height:24mm;flex:none}.lbl .qr svg{width:100%;height:100%}
.lbl .txt{min-width:0;font-size:9pt;line-height:1.25}
.lbl .d{font-weight:700;color:#263238;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.lbl .t{margin-top:1mm;font-weight:700;font-family:monospace;color:#37474f}
.lbl .l{margin-top:1mm;color:#607d8b;font-size:8pt}
</style>
<p class="muted">${items.length} etiqueta(s). Recorte na linha tracejada. Ao ler o QR com o celular, o item abre no LoggB.</p>
<div class="lbls">${cells.join('')}</div>`;
}


type FerrPossessionRow = {
  item_id: string;
  quantity: number;
  items?: {
    description?: string;
    unit?: string;
    category?: string | null;
    consumable?: boolean | null;
    accessories?: string[] | null;
    tag?: string | null;
  } | null;
};

/**
 * Ficha de ferramentas e equipamentos (tudo que não é EPI nem consumível) em posse do colaborador,
 * no modelo do termo de responsabilidade das cautelas.
 */
export async function buildFerramentasFichaHtml(
  supabase: SupabaseClient,
  employee: EpiFichaEmployee,
  company: CompanyInfo
): Promise<string | { error: string }> {
  const { data, error } = await supabase
    .from('possession')
    .select('item_id, quantity, items(description, unit, category, consumable, accessories, tag)')
    .eq('employee_id', employee.id)
    .gt('quantity', 0);
  if (error) return { error: error.message };
  const rows = ((data ?? []) as FerrPossessionRow[])
    .map((r) => ({ ...r, items: one(r.items) }))
    .filter((r) => r.items && !r.items.consumable && !String(r.items.category ?? '').trim().toUpperCase().startsWith('EPI'))
    .sort((a, b) => String(a.items?.description).localeCompare(String(b.items?.description), 'pt-BR'));
  if (rows.length === 0) return { error: 'Este colaborador não tem ferramentas ou equipamentos em posse.' };

  // Data e TAG da última entrega de cada item para este colaborador.
  const last = new Map<string, { at: string; tag: string }>();
  const { data: moves } = await supabase
    .from('movements')
    .select('item_id, created_at, tag')
    .eq('employee_id', employee.id)
    .eq('type', 'OUT')
    .in('item_id', rows.map((r) => r.item_id))
    .order('created_at', { ascending: false })
    .limit(2000);
  for (const m of (moves ?? []) as { item_id: string; created_at: string; tag: string | null }[]) {
    if (!last.has(m.item_id)) last.set(m.item_id, { at: m.created_at, tag: (m.tag || '').trim() });
  }

  const companyName = company.companyName.trim() || PRINT_BRAND.orgName.trim() || 'a empresa';
  const logo = safeLogo(PRINT_BRAND.logo);
  const logoCell = logo ? `<img src="${logo}" alt="${esc(companyName)}">` : `<div class="co">${esc(companyName)}</div>`;
  const tagOf = (r: FerrPossessionRow) => {
    const t = last.get(r.item_id)?.tag || '';
    return t && t.toUpperCase() !== 'DESCARTE' ? t : (r.items?.tag || '').trim();
  };
  const hasTag = rows.some((r) => tagOf(r));

  let n = 0;
  const secTitle = (t: string) => `<div class="sec">${++n}. ${esc(t)}</div>`;
  const name = formatEmployeeName(employee.full_name);

  const header = `<table class="ct"><tr><td class="ct-logo">${logoCell}</td>
<td class="ct-title">Termo de responsabilidade<small>Ferramentas e equipamentos em posse</small></td></tr>
<tr><td colspan="2" class="ct-sub">Gestão patrimonial – controle de equipamentos e materiais</td></tr></table>
<table class="ct ct-meta"><tr><td>Emissão: <b>${esc(dateTimeBr(new Date()))}</b></td><td>Itens: <b>${rows.length}</b></td></tr></table>`;

  const party = `${secTitle('Identificação do colaborador')}
<table class="ct"><tr><td style="width:65%"><span class="lbl">Nome:</span> ${esc(name)}</td>
<td><span class="lbl">CPF:</span> ${esc(formatCpf(employee.cpf) || '—')}</td></tr>
<tr><td><span class="lbl">Função:</span> ${esc(employee.role || '—')}</td><td><span class="lbl">Setor:</span> ${esc(employee.department || '—')}</td></tr></table>`;

  const lines = rows
    .map((r, i) => {
      const it = r.items!;
      const acc = (it.accessories ?? []).filter(Boolean);
      const when = last.get(r.item_id)?.at;
      return `<tr><td class="c">${i + 1}</td><td>${esc(formatProductLabelDisplay(it.description || '—'))}${
        acc.length ? `<span class="acc">Acompanha: ${esc(acc.map((a) => formatProductLabelDisplay(a)).join(', '))}</span>` : ''
      }</td>${hasTag ? `<td>${esc(tagOf(r) || '—')}</td>` : ''}<td class="c">${esc(when ? dateBr(when) : '—')}</td><td class="n">${esc(
        formatQty(r.quantity)
      )}</td><td class="c">${esc(it.unit || 'un')}</td></tr>`;
    })
    .join('');
  const itemsSec = `${secTitle('Itens em posse')}
<table class="ct"><thead><tr><th class="c">#</th><th>Item</th>${hasTag ? '<th>TAG / Nº de série</th>' : ''}<th class="c">Entregue em</th><th class="n">Qtd.</th><th class="c">Un.</th></tr></thead><tbody>${lines}</tbody></table>`;

  const termo = `${secTitle('Termo de responsabilidade')}
<div class="ct-term">Pelo presente termo, eu, colaborador identificado acima, declaro estar em posse dos itens relacionados acima,
recebidos de <b>${esc(companyName)}</b> a título de empréstimo e para uso exclusivo nas minhas atividades de trabalho,
comprometendo-me a mantê-los em bom estado de conservação e ficando ciente de que:
${TERMO_CLAUSES}</div>`;

  const signCell = (label: string, who: string) =>
    `<td><span class="lbl">${esc(label)}</span><br>Nome por extenso: ${esc(who)}<div class="ln"></div></td>`;
  const signs = `<table class="ct ct-sign"><tr>${signCell('Colaborador', name)}${signCell('Responsável', company.responsibleName.trim())}</tr></table>`;

  const devolucao = `${secTitle('Devolução')}
<table class="ct"><tr><td><span class="lbl">Data da devolução:</span> ____/____/________</td></tr></table>
<table class="ct"><thead><tr><th>Item</th><th class="c">Devolveu?</th><th>Observação (dano, falta etc.)</th></tr></thead><tbody>${rows
    .map((r) => {
      const tag = tagOf(r);
      return `<tr><td>${esc(formatProductLabelDisplay(r.items?.description || '—'))}${tag ? ` <span class="muted">(${esc(tag)})</span>` : ''}</td>
<td class="c"><span class="box"></span>Sim <span class="box"></span>Não</td><td></td></tr>`;
    })
    .join('')}</tbody></table>
<table class="ct ct-sign"><tr>${signCell('Colaborador', name)}${signCell('Recebido por', '')}</tr></table>`;

  return `${header}
${party}
${itemsSec}
${termo}
${signs}
${devolucao}
<p class="foot">Documento de controle interno – arquivar o original assinado na pasta do colaborador. Gerado pelo LoggB em ${esc(
    dateTimeBr(new Date())
  )}</p>`;
}
