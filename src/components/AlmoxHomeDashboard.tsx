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
  Wallet,
  Bell,
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
  const [financeSummary, setFinanceSummary] = useState<{
    pendingAccountsMonth: number;
    fuelMonth: number;
    expensesMonth: number;
    remindersToday: number;
  } | null>(null);

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
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      const [accR, fuelR, expR, remR] = await Promise.all([
        supabase
          .from('finance_accounts')
          .select('amount, status, due_date')
          .eq('user_id', user.id)
          .eq('status', 'pending')
          .gte('due_date', monthStart)
          .lte('due_date', monthEnd),
        supabase
          .from('finance_fuel_logs')
          .select('total_amount, ref_date')
          .eq('user_id', user.id)
          .gte('ref_date', monthStart)
          .lte('ref_date', monthEnd),
        supabase
          .from('finance_expenses')
          .select('amount, ref_date')
          .eq('user_id', user.id)
          .gte('ref_date', monthStart)
          .lte('ref_date', monthEnd),
        supabase
          .from('dashboard_reminders')
          .select('id, frequency, weekday, day_of_month, month_of_year, interval_days, active, created_at')
          .eq('user_id', user.id)
          .eq('active', true),
      ]);
      if (!cancelled) {
        setSnap(data);
        if (!accR.error && !fuelR.error && !expR.error && !remR.error) {
          const pendingAccountsMonth = (accR.data || []).reduce(
            (s: number, r: unknown) => s + Number((r as { amount: number }).amount || 0),
            0
          );
          const fuelMonth = (fuelR.data || []).reduce(
            (s: number, r: unknown) => s + Number((r as { total_amount: number }).total_amount || 0),
            0
          );
          const expensesMonth = (expR.data || []).reduce(
            (s: number, r: unknown) => s + Number((r as { amount: number }).amount || 0),
            0
          );
          const remindersToday = (remR.data || []).filter((r: unknown) => {
            const row = r as {
              frequency: string;
              weekday: number | null;
              day_of_month: number | null;
              month_of_year: number | null;
              interval_days: number | null;
              active: boolean;
              created_at: string;
            };
            if (row.frequency === 'daily') return true;
            if (row.frequency === 'weekly') return row.weekday === now.getDay();
            if (row.frequency === 'monthly') {
              if (row.day_of_month == null) return false;
              const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
              return now.getDate() === Math.min(last, row.day_of_month);
            }
            if (row.frequency === 'yearly') {
              if (row.day_of_month == null || row.month_of_year == null) return false;
              if (row.month_of_year !== now.getMonth() + 1) return false;
              const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
              return now.getDate() === Math.min(last, row.day_of_month);
            }
            if (row.frequency === 'every_n_days') {
              if (!row.interval_days || row.interval_days <= 0) return false;
              const c = new Date(row.created_at);
              const c0 = new Date(c.getFullYear(), c.getMonth(), c.getDate()).getTime();
              const n0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
              const diff = Math.floor((n0 - c0) / 86400000);
              return diff >= 0 && diff % row.interval_days === 0;
            }
            return false;
          }).length;
          setFinanceSummary({ pendingAccountsMonth, fuelMonth, expensesMonth, remindersToday });
        } else {
          setFinanceSummary(null);
        }
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

      {financeSummary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Contas pendentes (mês)"
            value={financeSummary.pendingAccountsMonth.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            sub="Financeiro > Contas"
            icon={<Wallet size={22} />}
            tone="rose"
          />
          <StatCard
            label="Abastecimentos (mês)"
            value={financeSummary.fuelMonth.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            sub="Financeiro > Abastecimentos"
            icon={<ArrowUpRight size={22} />}
            tone="amber"
          />
          <StatCard
            label="Despesas (mês)"
            value={financeSummary.expensesMonth.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            sub="Financeiro > Despesas"
            icon={<ArrowDownLeft size={22} />}
            tone="slate"
          />
          <StatCard
            label="Lembretes hoje"
            value={financeSummary.remindersToday}
            sub="Financeiro > Lembretes"
            icon={<Bell size={22} />}
            tone="emerald"
          />
        </div>
      )}

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
