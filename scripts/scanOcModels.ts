import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  extractItemsFromPositionedItems,
  parsePurchaseOrderFromText,
  parsePurchaseOrderWarnings,
  refineParsedItems,
  scoreParsedItemsQuality,
  type ParsedPurchaseOrder,
  type PositionedTextItem,
} from '../src/lib/purchaseOrderParse';

const requirePdf = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse = requirePdf('pdf-parse') as (b: Buffer, opts?: any) => Promise<{ text: string }>;

interface FileReport {
  file: string;
  ocNumber: string | null;
  vendor: string | null;
  deliveryDeadline: string | null;
  items: number;
  missingQty: number;
  missingUnit: number;
  suspiciousLongDescriptions: number;
  duplicateLineNumbers: number;
  issueExamples: string[];
  warnings: string[];
  mode: 'text' | 'positioned';
  scoreText: number;
  scorePositioned: number;
}

function countDuplicateLineNumbers(parsed: ParsedPurchaseOrder): number {
  const seen = new Set<number>();
  let duplicates = 0;
  for (const item of parsed.items) {
    if (seen.has(item.line_number)) duplicates += 1;
    seen.add(item.line_number);
  }
  return duplicates;
}

async function parsePdfWithPositions(filePath: string): Promise<{
  textBased: ParsedPurchaseOrder;
  positioned: ParsedPurchaseOrder;
}> {
  const allPositioned: PositionedTextItem[] = [];
  let cumulativeHeight = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderPage = async (pageData: any): Promise<string> => {
    const [, , , pageHeight] = pageData.view as number[];
    const yBase = cumulativeHeight;
    cumulativeHeight += pageHeight + 50;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tc = (await pageData.getTextContent({
      disableCombineTextItems: false,
    })) as { items: any[] };

    let lastY: number | null = null;
    let lastX = 0;
    let pageText = '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const it of tc.items as any[]) {
      if (!it.str) continue;
      const x = it.transform[4] as number;
      const y = it.transform[5] as number;

      if (it.str.trim()) {
        allPositioned.push({
          text: it.str.trim(),
          x: Math.round(x),
          y: Math.round(yBase + (pageHeight - y)),
        });
      }

      if (lastY !== null && Math.abs(lastY - y) > 2) {
        pageText += '\n';
      } else if (lastY !== null && x - lastX > 3) {
        pageText += ' ';
      }
      pageText += it.str;
      lastY = y;
      lastX = x + (it.width || 0);
    }

    return pageText;
  };

  const buf = await fs.readFile(filePath);
  const pdfResult = await pdfParse(buf, { pagerender: renderPage });
  const parsed = parsePurchaseOrderFromText(pdfResult.text, path.basename(filePath));
  const positioned = {
    ...parsed,
    items: refineParsedItems([...parsed.items]),
  };
  const positionedItems = extractItemsFromPositionedItems(allPositioned);
  if (positionedItems.length > 0) positioned.items = refineParsedItems(positionedItems);
  return { textBased: parsed, positioned };
}

async function run() {
  const modelsDir = process.argv[2] || 'C:/Users/yuris/Documents/PRIVATE';
  const entries = await fs.readdir(modelsDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && /\.pdf$/i.test(e.name))
    .map((e) => path.join(modelsDir, e.name))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  if (files.length === 0) {
    console.log(`Nenhum PDF encontrado em: ${modelsDir}`);
    process.exit(1);
  }

  const reports: FileReport[] = [];
  for (const filePath of files) {
    const both = await parsePdfWithPositions(filePath);
    const scoreText = scoreParsedItemsQuality(both.textBased.items);
    const scorePositioned = scoreParsedItemsQuality(both.positioned.items);
    const mode = scorePositioned <= scoreText ? 'positioned' : 'text';
    const parsed = mode === 'positioned' ? both.positioned : both.textBased;
    const warnings = parsePurchaseOrderWarnings(parsed);
    const missingQty = parsed.items.filter((i) => i.quantity == null).length;
    const missingUnit = parsed.items.filter((i) => !(i.unit && String(i.unit).trim())).length;
    const suspiciousLongDescriptions = parsed.items.filter((i) => i.description.length > 120).length;
    const duplicateLineNumbers = countDuplicateLineNumbers(parsed);
    const issueExamples = parsed.items
      .filter(
        (i) =>
          i.quantity == null ||
          !(i.unit && String(i.unit).trim()) ||
          i.description.length > 120
      )
      .slice(0, 4)
      .map(
        (i) =>
          `#${i.line_number} q=${i.quantity ?? 'null'} un=${i.unit ?? 'null'} desc="${i.description.slice(0, 180)}"`
      );

    reports.push({
      file: path.basename(filePath),
      ocNumber: parsed.oc_number,
      vendor: parsed.vendor_name,
      deliveryDeadline: parsed.delivery_deadline,
      items: parsed.items.length,
      missingQty,
      missingUnit,
      suspiciousLongDescriptions,
      duplicateLineNumbers,
      issueExamples,
      warnings,
      mode,
      scoreText,
      scorePositioned,
    });
  }

  const outDir = path.resolve('reports');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'oc-model-scan.json');
  await fs.writeFile(outPath, JSON.stringify({ scannedAt: new Date().toISOString(), modelsDir, reports }, null, 2));

  console.log(`\nScan concluido: ${reports.length} arquivo(s).`);
  for (const r of reports) {
    const issues =
      r.warnings.length +
      r.missingQty +
      r.missingUnit +
      r.suspiciousLongDescriptions +
      r.duplicateLineNumbers;
    console.log(
      `- ${r.file}: itens=${r.items}, fornecedor=${r.vendor || 'N/D'}, prazo=${r.deliveryDeadline || 'N/D'}, issues=${issues}`
    );
  }
  console.log(`\nRelatorio salvo em: ${outPath}`);
}

void run().catch((err) => {
  console.error('Falha no scan de modelos de OC:', err);
  process.exit(1);
});
