'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowLeftRight, Ruler } from 'lucide-react';
import {
  MM_PER_INCH,
  formatInches,
  formatMm,
  inchesToMm,
  mmToInches,
  parseLocaleNumber,
} from '@/lib/mmInchConvert';

/** Medidas típicas de chaves / soquetes métricos (automotivo e oficina). */
const POPULAR_MM: number[] = [
  6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 30, 32,
];

/** Frações SAE muito usadas em ferramentas e parafusos imperiais. */
const POPULAR_SAE: { label: string; inches: number }[] = [
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
];

/** Medidas típicas de chaves, soquetes e parafusos métricos. */
const MECHANIC_MM_POPULAR = [
  6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 27, 30, 32, 36, 41, 46, 50,
] as const;

/** Frações SAE muito usadas em ferramentas e fixações. */
const MECHANIC_SAE: { label: string; inches: number }[] = [
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
  { label: '1 1/2"', inches: 1.5 },
  { label: '2"', inches: 2 },
];

const INCH_PRESETS: { label: string; inches: number }[] = [
  { label: '1/16"', inches: 1 / 16 },
  { label: '1/8"', inches: 1 / 8 },
  { label: '3/16"', inches: 3 / 16 },
  { label: '1/4"', inches: 1 / 4 },
  { label: '5/16"', inches: 5 / 16 },
  { label: '3/8"', inches: 3 / 8 },
  { label: '7/16"', inches: 7 / 16 },
  { label: '1/2"', inches: 1 / 2 },
  { label: '5/8"', inches: 5 / 8 },
  { label: '3/4"', inches: 3 / 4 },
  { label: '7/8"', inches: 7 / 8 },
  { label: '1"', inches: 1 },
  { label: '1½"', inches: 1.5 },
  { label: '2"', inches: 2 },
];

export default function ConversorUnidadesPage() {
  const [mmStr, setMmStr] = useState('');
  const [inchStr, setInchStr] = useState('');

  const applyFromMm = useCallback((s: string) => {
    setMmStr(s);
    const mm = parseLocaleNumber(s);
    if (mm === null) {
      setInchStr('');
      return;
    }
    setInchStr(formatInches(mmToInches(mm)));
  }, []);

  const applyFromInch = useCallback((s: string) => {
    setInchStr(s);
    const pol = parseLocaleNumber(s);
    if (pol === null) {
      setMmStr('');
      return;
    }
    setMmStr(formatMm(inchesToMm(pol)));
  }, []);

  const clear = useCallback(() => {
    setMmStr('');
    setInchStr('');
  }, []);

  const loadPair = useCallback((mm: number, inches: number) => {
    setMmStr(formatMm(mm));
    setInchStr(formatInches(inches));
  }, []);

  const tableRows = useMemo(
    () =>
      INCH_PRESETS.map((p) => ({
        label: p.label,
        inches: p.inches,
        mm: inchesToMm(p.inches),
      })),
    []
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-primary"
          aria-label="Voltar"
        >
          <ArrowLeft size={22} />
        </Link>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-100 text-amber-800">
            <Ruler size={28} strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-primary">Conversor mm / pol</h1>
            <p className="text-slate-500 text-sm">
              1 pol (polegada) = {MM_PER_INCH} mm — padrão internacional.
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-amber-200/70 bg-gradient-to-b from-amber-50/90 via-amber-50/40 to-white p-5 md:p-6 shadow-sm space-y-5">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-amber-950">
            Conversões mais usadas na mecânica
          </h2>
          <p className="text-xs text-amber-900/70 mt-1">
            Chaves, soquetes e medidas SAE — clique para carregar nos campos abaixo.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 lg:gap-8">
          <div className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase text-slate-600 tracking-wide">
              Milímetros → pol
            </h3>
            <div className="flex flex-wrap gap-2">
              {MECHANIC_MM_POPULAR.map((mm) => {
                const pol = mmToInches(mm);
                return (
                  <button
                    key={mm}
                    type="button"
                    onClick={() => loadPair(mm, pol)}
                    className="min-w-[5.5rem] px-2.5 py-2 rounded-xl bg-white border border-amber-200/80 hover:border-secondary hover:bg-teal-50/60 shadow-sm text-left transition-colors"
                  >
                    <span className="block text-sm font-black text-primary leading-none">{mm} mm</span>
                    <span className="block text-[11px] font-mono text-slate-600 tabular-nums mt-1">
                      = {formatInches(pol)} pol
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase text-slate-600 tracking-wide">
              Polegadas SAE (fração) → mm
            </h3>
            <div className="flex flex-wrap gap-2">
              {MECHANIC_SAE.map((row) => {
                const mm = inchesToMm(row.inches);
                return (
                  <button
                    key={row.label}
                    type="button"
                    onClick={() => loadPair(mm, row.inches)}
                    className="min-w-[5.5rem] px-2.5 py-2 rounded-xl bg-white border border-amber-200/80 hover:border-secondary hover:bg-teal-50/60 shadow-sm text-left transition-colors"
                  >
                    <span className="block text-sm font-black text-primary leading-none">{row.label}</span>
                    <span className="block text-[11px] font-mono text-slate-600 tabular-nums mt-1">
                      = {formatMm(mm)} mm
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

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
              placeholder="Ex.: 25,4"
              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-lg text-primary focus:ring-2 focus:ring-secondary/40 focus:border-secondary"
              value={mmStr}
              onChange={(e) => applyFromMm(e.target.value)}
            />
          </div>

          <div className="hidden md:flex items-center justify-center pb-3 text-slate-300">
            <ArrowLeftRight size={28} aria-hidden />
          </div>

          <div className="space-y-2">
            <label htmlFor="conv-pol" className="text-xs font-bold uppercase text-slate-400 tracking-wide">
              Polegadas (pol), decimal
            </label>
            <input
              id="conv-pol"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Ex.: 1"
              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-lg text-primary focus:ring-2 focus:ring-secondary/40 focus:border-secondary"
              value={inchStr}
              onChange={(e) => applyFromInch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={clear}
            className="px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Limpar
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Use vírgula ou ponto nos decimais. Ao digitar em um campo, o outro é atualizado na hora.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b bg-slate-50">
          <h2 className="font-bold text-primary text-sm uppercase tracking-wide">Tabela completa (frações em pol)</h2>
          <p className="text-xs text-slate-500 mt-1">Mesma base: {MM_PER_INCH} mm por polegada.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80">
                <th className="px-4 py-3 font-bold text-slate-500 text-xs uppercase">Polegada (fração)</th>
                <th className="px-4 py-3 font-bold text-slate-500 text-xs uppercase">pol (decimal)</th>
                <th className="px-4 py-3 font-bold text-slate-500 text-xs uppercase">mm</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tableRows.map((row) => (
                <tr key={row.label} className="hover:bg-amber-50/40">
                  <td className="px-4 py-2.5 font-bold text-primary">{row.label}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-600 tabular-nums">
                    {row.inches.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => loadPair(row.mm, row.inches)}
                      className="font-mono font-bold text-secondary hover:underline tabular-nums text-left"
                      title="Copiar para os campos acima"
                    >
                      {formatMm(row.mm)} mm
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
