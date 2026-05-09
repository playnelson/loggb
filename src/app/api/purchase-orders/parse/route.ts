import { createRequire } from 'module';
import {
  parsePurchaseOrderFromText,
  parsePurchaseOrderWarnings,
  type ParsedPurchaseOrder,
} from '@/lib/purchaseOrderParse';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

const requirePdf = createRequire(import.meta.url);
const pdfParseBuffer = requirePdf('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: 'Não autenticado.' }, { status: 401 });
    }

    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('multipart/form-data')) {
      return Response.json({ error: 'Envie o PDF em multipart/form-data (campo file).' }, { status: 400 });
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
    const { text } = await pdfParseBuffer(buf);

    const parsed: ParsedPurchaseOrder = parsePurchaseOrderFromText(text, name);
    const warnings = parsePurchaseOrderWarnings(parsed);

    return Response.json({
      parsed,
      warnings,
      meta: { filename: name, textLength: text.length },
    });
  } catch (e) {
    console.error('purchase-orders/parse', e);
    const msg = e instanceof Error ? e.message : 'Falha ao ler o PDF.';
    return Response.json({ error: msg }, { status: 500 });
  }
}
