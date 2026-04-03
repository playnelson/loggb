import { NextRequest, NextResponse } from 'next/server';

/** Normaliza número do CA (só dígitos). */
function normalizeCa(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length < 4 || d.length > 10) return null;
  return d;
}

/**
 * Consulta CA EPI.
 * Configure CA_EPI_API_BASE na Vercel/host (ex.: URL do container API_BaseCAEPI sem barra final).
 * Ex.: https://seu-servidor.com  → GET {base}/CA/{numero}
 */
export async function GET(req: NextRequest) {
  const caRaw = req.nextUrl.searchParams.get('ca') || '';
  const ca = normalizeCa(caRaw);
  if (!ca) {
    return NextResponse.json({ error: 'Informe um CA válido (apenas números, 4–10 dígitos).' }, { status: 400 });
  }

  const base = process.env.CA_EPI_API_BASE?.replace(/\/$/, '');
  if (base) {
    try {
      const url = `${base}/CA/${encodeURIComponent(ca)}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        next: { revalidate: 3600 },
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { error: 'A API de CA retornou resposta inválida. Verifique CA_EPI_API_BASE.', raw: text.slice(0, 200) },
          { status: 502 }
        );
      }
      if (!res.ok) {
        return NextResponse.json(
          { error: typeof json === 'object' && json && 'detail' in json ? String((json as { detail?: unknown }).detail) : 'CA não encontrado na API configurada.', data: json },
          { status: res.status >= 400 ? res.status : 404 }
        );
      }
      return NextResponse.json({ source: 'proxy', data: json });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Falha ao contatar CA_EPI_API_BASE.' },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({
    error: 'Consulta automática não configurada.',
    hint:
      'Defina a variável de ambiente CA_EPI_API_BASE com a URL da API Base CAEPI (Docker: joaoaugustomv/api_base_ca_epi — endpoint GET /CA/{numero}). ' +
      'Fonte oficial dos dados: FTP MTPS caepi. Enquanto isso, use o site caepi.mte.gov.br manualmente.',
    officialUrl: 'https://caepi.mte.gov.br/internet/ConsultaCAInternet.aspx',
    ca,
  });
}
