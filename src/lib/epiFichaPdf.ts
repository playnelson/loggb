import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export type EpiFichaPdfMeta = {
  companyName: string;
  companyCnpj: string;
  branchOrDept: string;
  issuedAtLabel: string;
  responsibleName: string;
};

export type EpiFichaEmployeeSlice = {
  full_name: string;
  role: string | null;
  cpf?: string | null;
  department?: string | null;
};

function formatCpfDisplay(cpf: string | null | undefined): string {
  if (!cpf) return '—';
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function filenameSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48) || 'colaborador'
  );
}

export function downloadEpiFichaPdf(
  employee: EpiFichaEmployeeSlice,
  epiRows: Array<[string, string, string]>,
  meta: EpiFichaPdfMeta
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;

  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('Ficha de entrega de EPI', pageW / 2, y, { align: 'center' });
  y += 7;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(
    'Documento compatível com as exigências da NR-6 quanto ao registro de entrega de EPI.',
    pageW / 2,
    y,
    { align: 'center', maxWidth: pageW - 28 }
  );
  y += 10;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Empregador', 14, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Razão social / Nome: ${meta.companyName.trim() || '—'}`, 14, y);
  y += 5;
  if (meta.companyCnpj.trim()) {
    doc.text(`CNPJ: ${meta.companyCnpj.trim()}`, 14, y);
    y += 5;
  }
  if (meta.branchOrDept.trim()) {
    doc.text(`Setor / estabelecimento: ${meta.branchOrDept.trim()}`, 14, y);
    y += 5;
  }
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.text('Trabalhador', 14, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(`Nome: ${employee.full_name}`, 14, y);
  y += 5;
  doc.text(`Função: ${employee.role?.trim() || '—'}`, 14, y);
  y += 5;
  doc.text(`CPF: ${formatCpfDisplay(employee.cpf)}`, 14, y);
  y += 5;
  if (employee.department?.trim()) {
    doc.text(`Departamento / lotação: ${employee.department.trim()}`, 14, y);
    y += 5;
  }
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.text(`EPIs em posse — referência em ${meta.issuedAtLabel}`, 14, y);
  y += 2;

  const tableBody =
    epiRows.length > 0
      ? epiRows
      : [
          [
            'Nenhum EPI em posse registrado no sistema nesta data (preencha manualmente se necessário).',
            '—',
            '—',
          ],
        ];

  autoTable(doc, {
    startY: y,
    head: [['Descrição do EPI', 'Unidade', 'Quantidade']],
    body: tableBody,
    styles: { fontSize: 9, cellPadding: 1.8 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255 },
    margin: { left: 14, right: 14 },
  });

  const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  let ty = (lastTable?.finalY ?? y + 40) + 8;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  const declaration = [
    'Declaro ter recebido os Equipamentos de Proteção Individual relacionados acima, em condições de uso adequadas,',
    'comprometendo-me a utilizá-los conforme as orientações de segurança do trabalho e treinamentos recebidos.',
  ];
  declaration.forEach((line) => {
    doc.text(line, 14, ty, { maxWidth: pageW - 28 });
    ty += 4;
  });
  ty += 6;

  doc.setFont('helvetica', 'normal');
  const mid = pageW / 2;
  doc.line(14, ty, mid - 8, ty);
  doc.line(mid + 8, ty, pageW - 14, ty);
  doc.setFontSize(8);
  doc.text('Assinatura do trabalhador', 14, ty + 4);
  const resp = meta.responsibleName.trim();
  doc.text(resp ? `Responsável pela entrega: ${resp}` : 'Responsável pela entrega', mid + 8, ty + 4, {
    maxWidth: pageW - mid - 22,
  });
  doc.text(`Data: ${meta.issuedAtLabel}`, pageW / 2, ty + 14, { align: 'center' });

  doc.save(`ficha_epi_${filenameSlug(employee.full_name)}.pdf`);
}
