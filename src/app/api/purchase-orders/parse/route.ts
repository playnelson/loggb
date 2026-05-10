import { createRequire } from 'module';
import {
  parsePurchaseOrderFromText,
  parsePurchaseOrderWarnings,
  extractItemsFromPositionedItems,
  refineParsedItems,
  scoreParsedItemsQuality,
  type ParsedPurchaseOrder,
  type PositionedTextItem,
} from '@/lib/purchaseOrderParse';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

const requirePdf = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse = requirePdf('pdf-parse') as (b: Buffer, opts?: any) => Promise<{ text: string }>;

export async function POST(req: Request) {
  try {
    const devSkipAuth =
      process.env.NODE_ENV === 'development' &&
      process.env.NEXT_PUBLIC_ORDENS_COMPRA_DEV_LOCAL === '1';

    if (!devSkipAuth) {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return Response.json({ error: 'Não autenticado.' }, { status: 401 });
      }
    }

    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('multipart/form-data')) {
      return Response.json(
        { error: 'Envie o PDF em multipart/form-data (campo file).' },
        { status: 400 }
      );
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'Arquivo ausente (campo file).' }, { status: 400 });
    }

    const name = file.name || 'ordem.pdf';
    if (!/\.pdf$/i.test(name)) {
      return Response.json({ error: 'Somente arquivos .pdf são aceitos.' }, { status: 415 });
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // Coleta itens com posição X/Y usando o pagerender do pdf-parse (pdf.js).
    // Isso permite reconstruir a tabela de itens pelas coordenadas reais das colunas,
    // independente da ordem de serialização do texto pelo pdf.js.
    const allPositioned: PositionedTextItem[] = [];
    let cumulativeHeight = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderPage = async (pageData: any): Promise<string> => {
      const [, , , pageHeight] = pageData.view as number[];
      const yBase = cumulativeHeight;
      cumulativeHeight += pageHeight + 50;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tc = await pageData.getTextContent({ disableCombineTextItems: false }) as { items: any[] };

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
            // converte coordenada PDF (bottom-up) para top-down global
            y: Math.round(yBase + (pageHeight - y)),
          });
        }

        // monta texto bruto linha a linha para extração de campos de cabeçalho
        if (lastY !== null && Math.abs(lastY - y) > 2) {
          pageText += '\n';
        } else if (lastY !== null && x - lastX > 3) {
          // insere espaço entre tokens na mesma linha quando houver distância visual
          pageText += ' ';
        }
        pageText += it.str;
        lastY = y;
        lastX = x + (it.width || 0);
      }

      return pageText;
    };

    const pdfResult = await pdfParse(buf, { pagerender: renderPage });
    const rawText = pdfResult.text;

    // Extrai campos de cabeçalho (comprador, fornecedor, data, nº OC) do texto
    const parsed: ParsedPurchaseOrder = parsePurchaseOrderFromText(rawText, name);
    const textItems = refineParsedItems(parsed.items);

    // Substitui itens pela extração posicional (muito mais precisa para tabelas)
    const positionedItems = refineParsedItems(extractItemsFromPositionedItems(allPositioned));
    if (positionedItems.length > 0 || textItems.length > 0) {
      const scoreText = scoreParsedItemsQuality(textItems);
      const scorePositioned =
        positionedItems.length > 0
          ? scoreParsedItemsQuality(positionedItems)
          : Number.POSITIVE_INFINITY;
      parsed.items = scorePositioned <= scoreText ? positionedItems : textItems;
    }

    const warnings = parsePurchaseOrderWarnings(parsed);

    return Response.json({
      parsed,
      warnings,
      meta: { filename: name, textLength: rawText.length },
      rawText,
    });
  } catch (e) {
    console.error('purchase-orders/parse', e);
    const msg = e instanceof Error ? e.message : 'Falha ao ler o PDF.';
    return Response.json({ error: msg }, { status: 500 });
  }
}
