'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpDown,
  Check,
  Copy,
  Info,
  Ruler,
  Search,
} from 'lucide-react';
import {
  MM_PER_INCH,
  decimalInchesToApproxFraction,
  formatFractionInchesLabel,
  formatInches,
  formatMm,
  inchesToMm,
  mmToInches,
  parseInchInput,
  parseLocaleNumber,
} from '@/lib/mmInchConvert';

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/** Chaves / soquetes métricos comuns. */
const MECHANIC_MM_POPULAR = [
  4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 27, 30, 32, 34, 36, 41, 46, 50, 55, 60,
] as const;

/** SAE típicos de oficina. */
const MECHANIC_SAE: { label: string; inches: number }[] = [
  { label: '1/16"', inches: 1 / 16 },
  { label: '1/8"', inches: 1 / 8 },
  { label: '3/16"', inches: 3 / 16 },
  { label: '1/4"', inches: 1 / 4 },
  { label: '5/16"', inches: 5 / 16 },
  { label: '3/8"', inches: 3 / 8 },
  { label: '7/16"', inches: 7 / 16 },
  { label: '1/2"', inches: 1 / 2 },
  { label: '9/16"', inches: 9 / 16 },
  { label: '5/8"', inches: 5 / 8 },
  { label: '11/16"', inches: 11 / 16 },
  { label: '3/4"', inches: 3 / 4 },
  { label: '13/16"', inches: 13 / 16 },
  { label: '7/8"', inches: 7 / 8 },
  { label: '15/16"', inches: 15 / 16 },
  { label: '1"', inches: 1 },
  { label: '1 1/8"', inches: 1 + 1 / 8 },
  { label: '1 1/4"', inches: 1 + 1 / 4 },
  { label: '1 3/8"', inches: 1 + 3 / 8 },
  { label: '1 1/2"', inches: 1.5 },
  { label: '1 3/4"', inches: 1 + 3 / 4 },
  { label: '2"', inches: 2 },
];

/** Tabela em passos de 1/64 até 2" (referência completa). */
function buildSixtyFourthTable(): { label: string; inches: number; mm: number }[] {
  const rows: { label: string; inches: number; mm: number }[] = [];
  for (let i = 1; i <= 128; i++) {
    const inches = i / 64;
    const g = gcd(i, 64);
    const num = i / g;
    const den = 64 / g;
    const label = `${num}/${den}"`;
    rows.push({ label, inches, mm: inchesToMm(inches) });
  }
  return rows;
}

const FULL_TABLE = buildSixtyFourthTable();

function reformatWithDecimals(mmS: string, inchS: string, d: number): { mm: string; inch: string } {
  const mm = parseLocaleNumber(mmS);
  if (mm !== null) {
    const pol = mmToInches(mm);
    return { mm: formatMm(mm, d), inch: formatInches(pol, d) };
  }
  const pol = parseInchInput(inchS);
  if (pol !== null) {
    return { mm: formatMm(inchesToMm(pol), d), inch: formatInches(pol, d) };
  }
  return { mm: mmS, inch: inchS };
}

export default function ConversorUnidadesPage() {
  const [mmStr, setMmStr] = useState('');
  const [inchStr, setInchStr] = useState('');
  const [decimals, setDecimals] = useState(4);
  const [maxDen, setMaxDen] = useState<16 | 32 | 64 | 128>(64);
  const [tableFilter, setTableFilter] = useState('');
  const [copied, setCopied] = useState<'mm' | 'pol' | 'both' | null>(null);
  const decimalsEffectSkip = useRef(true);

  const applyFromMm = useCallback(
    (s: string) => {
      setMmStr(s);
      const mm = parseLocaleNumber(s);
      if (mm === null) {
        setInchStr('');
        return;
      }
      setInchStr(formatInches(mmToInches(mm), decimals));
    },
    [decimals]
  );

  const applyFromInch = useCallback(
    (s: string) => {
      setInchStr(s);
      const pol = parseInchInput(s);
      if (pol === null) {
        setMmStr('');
        return;
      }
      setMmStr(formatMm(inchesToMm(pol), decimals));
      setInchStr(formatInches(pol, decimals));
    },
    [decimals]
  );

  useEffect(() => {
    if (decimalsEffectSkip.current) {
      decimalsEffectSkip.current = false;
      return;
    }
    const next = reformatWithDecimals(mmStr, inchStr, decimals);
    setMmStr(next.mm);
    setInchStr(next.inch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reaplicar casas ao mudar `decimals`
  }, [decimals]);

  const clear = useCallback(() => {
    setMmStr('');
    setInchStr('');
    setCopied(null);
  }, []);

  const loadPair = useCallback(
    (mm: number, inches: number) => {
      setMmStr(formatMm(mm, decimals));
      setInchStr(formatInches(inches, decimals));
      setCopied(null);
    },
    [decimals]
  );

  /** Troca o papel dos números: o que estava em mm vira polegadas e vice-versa (útil para conferir leitura). */
  const swap = useCallback(() => {
    const mm = parseLocaleNumber(mmStr);
    const pol = parseInchInput(inchStr);
    if (mm !== null && pol !== null) {
      loadPair(inchesToMm(pol), mmToInches(mm));
      return;
    }
    if (pol !== null) {
      loadPair(inchesToMm(pol), pol);
      return;
    }
    if (mm !== null) {
      const i = mmToInches(mm);
      loadPair(mm, i);
    }
  }, [mmStr, inchStr, loadPair]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clear]);

  const mmValue = parseLocaleNumber(mmStr);
  const inchValue = parseInchInput(inchStr);
  const summaryMm = mmValue ?? (inchValue !== null ? inchesToMm(inchValue) : null);
  const summaryInch =
    inchValue ?? (mmValue !== null ? mmToInches(mmValue) : null);

  const fractionApprox =
    summaryInch !== null ? decimalInchesToApproxFraction(summaryInch, maxDen) : null;
  const fractionLabel =
    fractionApprox && fractionApprox.num > 0
      ? formatFractionInchesLabel(fractionApprox, true)
      : fractionApprox
        ? formatFractionInchesLabel(fractionApprox, false)
        : null;

  const formulaLine =
    summaryMm !== null && summaryInch !== null
      ? `${formatMm(summaryMm, decimals)} mm ÷ ${MM_PER_INCH} = ${formatInches(summaryInch, decimals)} pol`
      : summaryMm !== null
        ? `${formatMm(summaryMm, decimals)} mm → pol = ${formatInches(mmToInches(summaryMm), decimals)}`
        : null;

  const copyToClipboard = async (which: 'mm' | 'pol' | 'both') => {
    if (summaryMm === null && summaryInch === null) return;
    let text = '';
    if (which === 'mm' && summaryMm !== null) text = `${formatMm(summaryMm, decimals)} mm`;
    if (which === 'pol' && summaryInch !== null) text = `${formatInches(summaryInch, decimals)} pol`;
    if (which === 'both' && summaryMm !== null && summaryInch !== null) {
      text = `${formatMm(summaryMm, decimals)} mm = ${formatInches(summaryInch, decimals)} pol (${MM_PER_INCH} mm/pol)`;
    }
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  const filteredTable = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return FULL_TABLE;
    return FULL_TABLE.filter((row) => {
      const mmTxt = formatMm(row.mm, 4).toLowerCase();
      const decTxt = row.inches.toString();
      return row.label.toLowerCase().includes(q) || mmTxt.includes(q) || decTxt.includes(q);
    });
  }, [tableFilter]);

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-primary shrink-0"
            aria-label="Voltar"
          >
            <ArrowLeft size={22} />
          </Link>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-amber-100 text-amber-800 shrink-0">
              <Ruler size={28} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-primary">Conversor mm / pol</h1>
              <p className="text-slate-500 text-sm">
                1 polegada = <strong>{MM_PER_INCH} mm</strong> (definição internacional). Decimal + fração SAE.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 font-bold text-slate-600">
            Casas decimais
            <select
              className="font-mono border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
              value={decimals}
              onChange={(e) => setDecimals(Number(e.target.value))}
            >
              {[2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 font-bold text-slate-600">
            Fração até 1/
            <select
              className="font-mono border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
              value={maxDen}
              onChange={(e) => setMaxDen(Number(e.target.value) as 16 | 32 | 64 | 128)}
            >
              <option value={16}>16</option>
              <option value={32}>32</option>
              <option value={64}>64</option>
              <option value={128}>128</option>
            </select>
          </label>
        </div>
      </div>

      {/* Atalhos mecânica */}
      <section className="rounded-2xl border border-amber-200/70 bg-gradient-to-b from-amber-50/90 via-amber-50/40 to-white p-5 md:p-6 shadow-sm space-y-5">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-amber-950">
            Atalhos de oficina
          </h2>
          <p className="text-xs text-amber-900/70 mt-1">
            Clique para preencher. Milímetros comuns e polegadas SAE (parafusos, soquetes, tubos).
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 lg:gap-8">
          <div className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase text-slate-600 tracking-wide">mm → pol</h3>
            <div className="flex flex-wrap gap-1.5">
              {MECHANIC_MM_POPULAR.map((mm) => {
                const pol = mmToInches(mm);
                return (
                  <button
                    key={mm}
                    type="button"
                    onClick={() => loadPair(mm, pol)}
                    className="min-w-[4.75rem] px-2 py-1.5 rounded-lg bg-white border border-amber-200/80 hover:border-secondary hover:bg-teal-50/60 shadow-sm text-left transition-colors"
                  >
                    <span className="block text-xs font-black text-primary leading-none">{mm} mm</span>
                    <span className="block text-[10px] font-mono text-slate-600 tabular-nums mt-0.5">
                      {formatInches(pol, Math.min(decimals, 5))} pol
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase text-slate-600 tracking-wide">SAE → mm</h3>
            <div className="flex flex-wrap gap-1.5">
              {MECHANIC_SAE.map((row) => {
                const mm = inchesToMm(row.inches);
                return (
                  <button
                    key={row.label}
                    type="button"
                    onClick={() => loadPair(mm, row.inches)}
                    className="min-w-[4.75rem] px-2 py-1.5 rounded-lg bg-white border border-amber-200/80 hover:border-secondary hover:bg-teal-50/60 shadow-sm text-left transition-colors"
                  >
                    <span className="block text-xs font-black text-primary leading-none">{row.label}</span>
                    <span className="block text-[10px] font-mono text-slate-600 tabular-nums mt-0.5">
                      {formatMm(mm, decimals)} mm
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Campos principais + resultado */}
      <div className="bg-white rounded-2xl border border-border shadow-sm p-6 md:p-8 space-y-6">
        <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 items-end">
          <div className="space-y-2">
            <label htmlFor="conv-mm" className="text-xs font-bold uppercase text-slate-400 tracking-wide">
              Milímetros (mm)
            </label>
            <input
              id="conv-mm"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Ex.: 25,4 ou 10"
              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-lg text-primary focus:ring-2 focus:ring-secondary/40 focus:border-secondary font-mono tabular-nums"
              value={mmStr}
              onChange={(e) => applyFromMm(e.target.value)}
            />
          </div>

          <div className="flex md:flex-col items-center justify-center gap-2 pb-1 md:pb-3">
            <button
              type="button"
              onClick={swap}
              className="p-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-primary"
              title="Inverter mm ↔ pol (usa o valor atual)"
              aria-label="Inverter unidades"
            >
              <ArrowUpDown size={22} />
            </button>
            <div className="hidden md:block text-slate-300">
              <ArrowLeftRight size={24} aria-hidden />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="conv-pol" className="text-xs font-bold uppercase text-slate-400 tracking-wide">
              Polegadas (decimal ou fração)
            </label>
            <input
              id="conv-pol"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Ex.: 1,375 ou 1 3/8 ou 3/8"
              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-lg text-primary focus:ring-2 focus:ring-secondary/40 focus:border-secondary font-mono tabular-nums"
              value={inchStr}
              onChange={(e) => applyFromInch(e.target.value)}
            />
          </div>
        </div>

        {(summaryMm !== null || summaryInch !== null) && (
          <div className="rounded-xl border border-teal-200/80 bg-teal-50/50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-black uppercase tracking-wide text-teal-900">Resultado</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyToClipboard('both')}
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-white border border-teal-200 text-teal-900 hover:bg-teal-100/80"
                >
                  {copied === 'both' ? <Check size={14} /> : <Copy size={14} />}
                  Copiar linha
                </button>
                {summaryMm !== null && (
                  <button
                    type="button"
                    onClick={() => void copyToClipboard('mm')}
                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-white border border-teal-200 text-teal-900 hover:bg-teal-100/80"
                  >
                    {copied === 'mm' ? <Check size={14} /> : <Copy size={14} />}
                    mm
                  </button>
                )}
                {summaryInch !== null && (
                  <button
                    type="button"
                    onClick={() => void copyToClipboard('pol')}
                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-white border border-teal-200 text-teal-900 hover:bg-teal-100/80"
                  >
                    {copied === 'pol' ? <Check size={14} /> : <Copy size={14} />}
                    pol
                  </button>
                )}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              {summaryMm !== null && (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Milímetros</p>
                  <p className="text-xl font-black text-primary font-mono tabular-nums">{formatMm(summaryMm, decimals)} mm</p>
                </div>
              )}
              {summaryInch !== null && (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Polegadas (decimal)</p>
                  <p className="text-xl font-black text-primary font-mono tabular-nums">{formatInches(summaryInch, decimals)} pol</p>
                </div>
              )}
            </div>
            {fractionLabel && summaryInch !== null && (
              <p className="text-sm font-bold text-teal-950">
                Equivalente SAE: <span className="font-mono">{fractionLabel}</span>
                {fractionApprox && fractionApprox.errorInches > 0.00002 && (
                  <span className="text-xs font-normal text-slate-600 block mt-1">
                    (aproximação até 1/{maxDen}; erro &lt; {fractionApprox.errorInches.toFixed(5)} pol)
                  </span>
                )}
              </p>
            )}
            {formulaLine && (
              <p className="text-xs text-slate-600 font-mono bg-white/70 rounded-lg px-3 py-2 border border-teal-100">{formulaLine}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={clear}
            className="px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Limpar
          </button>
          <span className="text-[10px] text-slate-400">Tecla Esc limpa os campos.</span>
        </div>

        <div className="flex gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl p-3 border border-slate-100">
          <Info size={16} className="shrink-0 text-secondary mt-0.5" />
          <p className="leading-relaxed">
            Na polegada você pode usar <strong>decimal</strong> (1,5) ou <strong>fração</strong> (3/8, 1 3/8, 1-3/8).
            Vírgula ou ponto nos decimais. O conversor só trabalha com mm e pol — sem outras unidades, para evitar confusão na bancada.
          </p>
        </div>
      </div>

      {/* Tabela 1/64 */}
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-4 md:px-6 py-4 border-b bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-bold text-primary text-sm uppercase tracking-wide">Referência 1/64″ → mm</h2>
            <p className="text-xs text-slate-500 mt-1">
              De <strong>1/64″</strong> até <strong>2″</strong> em incrementos de 1/64 — comum em paquímetro e especificações SAE.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="search"
              placeholder="Filtrar fração, mm ou decimal…"
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              className="pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg w-full sm:w-64 bg-white"
            />
          </div>
        </div>
        <div className="overflow-x-auto max-h-[min(420px,50vh)] overflow-y-auto">
          <table className="w-full text-sm text-left">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-slate-200 bg-slate-100 shadow-sm">
                <th className="px-3 md:px-4 py-2.5 font-bold text-slate-600 text-[10px] uppercase">Fração</th>
                <th className="px-3 md:px-4 py-2.5 font-bold text-slate-600 text-[10px] uppercase">pol</th>
                <th className="px-3 md:px-4 py-2.5 font-bold text-slate-600 text-[10px] uppercase">mm</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTable.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-slate-400 text-sm">
                    Nenhuma linha combina com o filtro.
                  </td>
                </tr>
              ) : (
                filteredTable.map((row) => (
                  <tr key={row.label + row.inches} className="hover:bg-amber-50/50">
                    <td className="px-3 md:px-4 py-2 font-bold text-primary whitespace-nowrap">{row.label}</td>
                    <td className="px-3 md:px-4 py-2 font-mono text-slate-600 tabular-nums text-xs">
                      {row.inches.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}
                    </td>
                    <td className="px-3 md:px-4 py-2">
                      <button
                        type="button"
                        onClick={() => loadPair(row.mm, row.inches)}
                        className="font-mono font-bold text-secondary hover:underline tabular-nums text-left text-xs"
                      >
                        {formatMm(row.mm, decimals)} mm
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
