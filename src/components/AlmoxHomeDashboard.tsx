'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { fetchAlmoxDashboardSnapshot, type AlmoxDashboardSnapshot } from '@/lib/almoxDashboard';
import { formatProductLabelDisplay } from '@/lib/productDisplayText';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Loader2,
  Package,
  TrendingDown,
} from 'lucide-react';

function StatCard({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: ReactNode;
  tone: 'slate' | 'amber' | 'emerald' | 'rose';
}) {
  const ring =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50/80'
      : tone === 'emerald'
        ? 'border-emerald-200 bg-emerald-50/80'
        : tone === 'rose'
          ? 'border-rose-200 bg-rose-50/80'
          : 'border-slate-200 bg-slate-50/80';
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${ring}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
          <p className="text-2xl font-black text-primary mt-1 tabular-nums">{value}</p>
          {sub ? <p className="text-xs text-slate-600 mt-1">{sub}</p> : null}
        </div>
        <div className="text-slate-500 opacity-90">{icon}</div>
      </div>
    </div>
  );
}

export function AlmoxHomeDashboard() {
  const [snap, setSnap] = useState<AlmoxDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setSnap(null);
          setLoading(false);
        }
        return;
      }
      const data = await fetchAlmoxDashboardSnapshot(supabase, user.id);
      if (!cancelled) {
        setSnap(data);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lowStock = useMemo(() => {
    if (!snap?.items.length) return [];
    return snap.items
      .filter((i) => i.quantity_min > 0 && i.quantity_current < i.quantity_min)
      .sort((a, b) => a.quantity_current - b.quantity_current)
      .slice(0, 10);
  }, [snap]);

  const categoriesTop = useMemo(() => {
    if (!snap?.items.length) return [];
    const m = new Map<string, number>();
    for (const i of snap.items) {
      const k = i.category?.trim() || 'Sem categoria';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [snap]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2">
        <Loader2 className="animate-spin" size={22} />
        <span className="font-medium">Carregando resumo…</span>
      </div>
    );
  }

  if (!snap) {
    return <p className="text-center text-slate-500 py-12">Faça login para ver o painel.</p>;
  }

  if (snap.error) {
    return (
      <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-sm">
        Não foi possível carregar o estoque: {snap.error}
      </div>
    );
  }

  const nItems = snap.items.length;
  const qtyTotal = snap.items.reduce((a, i) => a + i.quantity_current, 0);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Itens cadastrados"
          value={nItems}
          sub="SKUs no almoxarifado"
          icon={<Package size={22} />}
          tone="slate"
        />
        <StatCard
          label="Unidades em estoque"
          value={qtyTotal}
          sub="Soma do saldo no almox."
          icon={<BarChart3 size={22} />}
          tone="slate"
        />
        <StatCard
          label={`Saídas (${30}d)`}
          value={snap.totalOutLast30}
          sub={`${snap.movementsLast30} movimentos no período`}
          icon={<ArrowUpRight size={22} />}
          tone="amber"
        />
        <StatCard
          label={`Entradas (${30}d)`}
          value={snap.totalInLast30}
          sub="Soma das quantidades IN"
          icon={<ArrowDownLeft size={22} />}
          tone="emerald"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-slate-50 flex items-center justify-between">
            <h2 className="text-sm font-black text-primary uppercase tracking-wide flex items-center gap-2">
              <TrendingDown size={18} className="text-secondary" />
              Mais saídas (90 dias)
            </h2>
            <Link href="/history" className="text-xs font-bold text-secondary hover:underline">
              Histórico
            </Link>
          </div>
          <div className="p-2 max-h-[340px] overflow-y-auto">
            {snap.topOut.length === 0 ? (
              <p className="text-sm text-slate-500 px-3 py-8 text-center">Nenhuma saída registrada neste período.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {snap.topOut.map((row, idx) => (
                  <li key={row.item_id} className="px-3 py-2.5 flex items-center gap-3 hover:bg-slate-50/80">
                    <span className="text-xs font-black text-slate-400 w-6 tabular-nums">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-primary truncate">
                        {formatProductLabelDisplay(row.description)}
                      </p>
                      <p className="text-[10px] text-slate-500 font-medium">
                        {row.movements_count} saída(s) · {row.out_qty} {row.unit}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-slate-50 flex items-center justify-between">
            <h2 className="text-sm font-black text-primary uppercase tracking-wide flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-600" />
              Abaixo do mínimo
            </h2>
            <Link href="/inventory" className="text-xs font-bold text-secondary hover:underline">
              Almoxarifado
            </Link>
          </div>
          <div className="p-2 max-h-[340px] overflow-y-auto">
            {lowStock.length === 0 ? (
              <p className="text-sm text-slate-500 px-3 py-8 text-center">
                Nenhum item abaixo do estoque mínimo.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {lowStock.map((i) => (
                  <li key={i.id} className="px-3 py-2.5 flex items-center gap-3 hover:bg-amber-50/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-primary truncate">
                        {formatProductLabelDisplay(i.description)}
                      </p>
                      <p className="text-[10px] text-slate-600 font-medium">
                        Saldo {i.quantity_current} {i.unit} · mín. {i.quantity_min}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-sm p-5">
        <h2 className="text-sm font-black text-primary uppercase tracking-wide mb-4">Itens por categoria</h2>
        {categoriesTop.length === 0 ? (
          <p className="text-sm text-slate-500">Sem dados.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categoriesTop.map(([name, count]) => (
              <span
                key={name}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700"
              >
                {name}
                <span className="tabular-nums text-secondary">{count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
