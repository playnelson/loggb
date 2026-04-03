'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, Search, ShieldCheck } from 'lucide-react';
import { fetchCaEpiByNumber } from '@/lib/caEpiClient';

function CaConsultaInner() {
  const searchParams = useSearchParams();
  const [ca, setCa] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; label?: string; raw?: unknown; error?: string; hint?: string; officialUrl?: string } | null>(null);

  useEffect(() => {
    const v = searchParams.get('ca');
    if (v) setCa(v);
  }, [searchParams]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = ca.replace(/\D/g, '');
    if (digits.length < 4) {
      setResult({ ok: false, error: 'Informe pelo menos 4 dígitos do CA.' });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetchCaEpiByNumber(digits);
      if (!res.ok) {
        setResult({
          ok: false,
          error: res.error,
          hint: res.hint,
          officialUrl: res.officialUrl,
        });
        return;
      }
      setResult({ ok: true, label: res.label, raw: res.raw });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start gap-3">
        <Link href="/" className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-primary mt-0.5">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <ShieldCheck className="text-secondary" />
            Consulta por CA (EPI)
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Consulta o Certificado de Aprovação para padronizar o nome do equipamento. Em produção, configure{' '}
            <code className="text-xs bg-slate-100 px-1 rounded">CA_EPI_API_BASE</code> apontando para a API Base CAEPI
            (Docker <span className="font-mono text-xs">joaoaugustomv/api_base_ca_epi</span>, endpoint{' '}
            <span className="font-mono text-xs">GET /CA/&#123;numero&#125;</span>).
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="bg-white p-6 rounded-2xl border border-border shadow-sm space-y-4">
        <div>
          <label className="text-xs font-bold uppercase text-slate-400">Número do CA</label>
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              inputMode="numeric"
              className="flex-1 p-3 border border-slate-200 rounded-xl font-mono text-lg"
              placeholder="Ex.: 12345"
              value={ca}
              onChange={(e) => setCa(e.target.value)}
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 bg-primary text-white rounded-xl font-bold flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
              Consultar
            </button>
          </div>
        </div>
      </form>

      {result && (
        <div
          className={`p-6 rounded-2xl border shadow-sm ${
            result.ok ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
          }`}
        >
          {!result.ok ? (
            <div className="space-y-2 text-sm">
              <p className="font-bold text-amber-900">{result.error}</p>
              {result.hint && <p className="text-amber-800">{result.hint}</p>}
              {result.officialUrl && (
                <a
                  href={result.officialUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-secondary font-bold underline"
                >
                  Abrir consulta oficial (MTE)
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-black uppercase text-green-800">Nome padronizado sugerido</p>
              <p className="text-lg font-bold text-primary">{result.label || '—'}</p>
              {result.raw != null && typeof result.raw === 'object' ? (
                <details className="text-xs">
                  <summary className="cursor-pointer font-bold text-slate-600">Ver JSON bruto</summary>
                  <pre className="mt-2 p-3 bg-white rounded-lg overflow-x-auto border text-[11px]">
                    {JSON.stringify(result.raw, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CaConsultaPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-2xl mx-auto py-16 flex justify-center text-slate-400">
          <Loader2 className="animate-spin" size={32} />
        </div>
      }
    >
      <CaConsultaInner />
    </Suspense>
  );
}
