import { createRequire } from 'node:module';
import type { PositionedTextItem } from '@/lib/purchaseOrderParse';

const requirePdf = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PDFParser = requirePdf('pdf2json') as any;

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function extractPositionedTextFromPdf2Json(
  buffer: Buffer
): Promise<PositionedTextItem[]> {
  return await new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parser = new PDFParser(null, 1) as any;

    parser.on('pdfParser_dataError', (err: unknown) => {
      reject(err instanceof Error ? err : new Error('Falha no pdf2json.'));
    });

    parser.on('pdfParser_dataReady', (pdfData: unknown) => {
      const items: PositionedTextItem[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pages = ((pdfData as any)?.Pages || []) as any[];
      let yBase = 0;

      for (const page of pages) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const texts = (page?.Texts || []) as any[];
        let maxY = 0;

        for (const t of texts) {
          const xRaw = Number(t?.x ?? 0);
          const yRaw = Number(t?.y ?? 0);
          if (Number.isFinite(yRaw)) maxY = Math.max(maxY, yRaw);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const runs = (t?.R || []) as any[];
          const text = runs
            .map((r) => safeDecode(String(r?.T || '')))
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
          if (!text) continue;
          items.push({
            // pdf2json costuma usar coordenada em unidade menor; escala para manter separação
            x: Math.round(xRaw * 10),
            y: Math.round((yBase + yRaw) * 10),
            text,
          });
        }

        const pageH = Number(page?.H ?? 0);
        const height = Number.isFinite(pageH) && pageH > 0 ? pageH : maxY + 30;
        yBase += height + 10;
      }

      resolve(items);
    });

    parser.parseBuffer(buffer);
  });
}
