'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { formatProductLabelDisplay } from '@/lib/productDisplayText';
import { AlertTriangle, BellRing, CalendarClock } from 'lucide-react';
import { isLikelyMissingColumn } from '@/lib/tenantItems';

type AlertKind = 'calibration' | 'expiration' | 'rental_contract';

type AlertRow = {
  id: string;
  kind: AlertKind;
  title: string;
  subtitle: string;
  dueDate: string;
  sourceHref: string;
  sourceLabel: string;
  daysLeft: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toStartOfDay(value: string | Date): Date {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysUntil(dateIso: string): number {
  const today = toStartOfDay(new Date());
  const due = toStartOfDay(dateIso);
  return Math.round((due.getTime() - today.getTime()) / DAY_MS);
}

function dueTag(daysLeft: number): { label: string; tone: string } {
  if (daysLeft < 0) return { label: `Atrasado ${Math.abs(daysLeft)}d`, tone: 'bg-rose-100 text-rose-700' };
  if (daysLeft === 0) return { label: 'Vence hoje', tone: 'bg-amber-100 text-amber-800' };
  if (daysLeft <= 7) return { label: `${daysLeft}d`, tone: 'bg-amber-100 text-amber-800' };
  return { label: `${daysLeft}d`, tone: 'bg-slate-100 text-slate-700' };
}

export function HomeAlertsFeed() {
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setAlerts([]);
          setLoading(false);
        }
        return;
      }

      const nextAlerts: AlertRow[] = [];

      let itemRes = await supabase
        .from('items')
        .select('id, description, calibration_due_date, expiration_date')
        .eq('user_id', user.id);

      if (
        itemRes.error?.message &&
        (isLikelyMissingColumn(itemRes.error.message, 'calibration_due_date') ||
          isLikelyMissingColumn(itemRes.error.message, 'expiration_date'))
      ) {
        itemRes = { data: [], error: null, count: null, status: 200, statusText: 'OK' };
      }

      for (const item of (itemRes.data || []) as Array<{
        id: string;
        description: string;
        calibration_due_date?: string | null;
        expiration_date?: string | null;
      }>) {
        if (item.calibration_due_date) {
          const d = daysUntil(item.calibration_due_date);
          if (d <= 30) {
            nextAlerts.push({
              id: `cal-${item.id}`,
              kind: 'calibration',
              title: `Aferição: ${formatProductLabelDisplay(item.description)}`,
              subtitle: 'Prazo de aferição do equipamento',
              dueDate: item.calibration_due_date,
              sourceHref: '/inventory',
              sourceLabel: 'Almoxarifado',
              daysLeft: d,
            });
          }
        }
        if (item.expiration_date) {
          const d = daysUntil(item.expiration_date);
          if (d <= 30) {
            nextAlerts.push({
              id: `exp-${item.id}`,
              kind: 'expiration',
              title: `Validade: ${formatProductLabelDisplay(item.description)}`,
              subtitle: 'Prazo de validade do equipamento/material',
              dueDate: item.expiration_date,
              sourceHref: '/inventory',
              sourceLabel: 'Almoxarifado',
              daysLeft: d,
            });
          }
        }
      }

      const rentalsRes = await supabase
        .from('equipment_rentals')
        .select('id, supplier, contract_ref, expected_return_date, status, items(description), employees(full_name)')
        .eq('user_id', user.id)
        .eq('status', 'ativo')
        .not('expected_return_date', 'is', null);

      for (const row of (rentalsRes.data || []) as Array<{
        id: string;
        supplier?: string | null;
        contract_ref?: string | null;
        expected_return_date?: string | null;
        items?: { description: string } | { description: string }[] | null;
        employees?: { full_name: string } | { full_name: string }[] | null;
      }>) {
        if (!row.expected_return_date) continue;
        const d = daysUntil(row.expected_return_date);
        if (d > 30) continue;
        const item = Array.isArray(row.items) ? row.items[0] : row.items;
        const emp = Array.isArray(row.employees) ? row.employees[0] : row.employees;
        nextAlerts.push({
          id: `rent-${row.id}`,
          kind: 'rental_contract',
          title: `Contrato aluguel: ${row.contract_ref || formatProductLabelDisplay(item?.description || 'Equipamento')}`,
          subtitle: `${row.supplier || 'Locadora'}${emp?.full_name ? ` · Resp.: ${emp.full_name}` : ''}`,
          dueDate: row.expected_return_date,
          sourceHref: '/rentals',
          sourceLabel: 'Gestão de aluguéis',
          daysLeft: d,
        });
      }

      nextAlerts.sort((a, b) => a.daysLeft - b.daysLeft || a.title.localeCompare(b.title, 'pt-BR'));

      if (!cancelled) {
        setAlerts(nextAlerts.slice(0, 12));
        setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const groupedTitle = useMemo(() => {
    const overdue = alerts.filter((a) => a.daysLeft < 0).length;
    if (overdue > 0) return `${overdue} alerta(s) em atraso`;
    return 'Próximos vencimentos (30 dias)';
  }, [alerts]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-border shadow-sm p-5 text-sm text-slate-500">
        Carregando feed de lembretes...
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b bg-slate-50 flex items-center justify-between">
        <h2 className="text-sm font-black text-primary uppercase tracking-wide flex items-center gap-2">
          <BellRing size={18} className="text-secondary" />
          Feed de lembretes
        </h2>
        <span className="text-[10px] font-bold text-slate-500">{groupedTitle}</span>
      </div>
      <div className="p-2">
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500 px-3 py-6 text-center">
            Sem alertas próximos de aferição, validade ou contratos de aluguel.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {alerts.map((a) => {
              const tag = dueTag(a.daysLeft);
              return (
                <li key={a.id} className="px-3 py-3 flex items-start gap-3 hover:bg-slate-50/80">
                  <div className="mt-0.5">
                    {a.kind === 'rental_contract' ? (
                      <CalendarClock size={16} className="text-slate-500" />
                    ) : (
                      <AlertTriangle size={16} className="text-slate-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-primary truncate">{a.title}</p>
                    <p className="text-[11px] text-slate-600">{a.subtitle}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {new Date(a.dueDate).toLocaleDateString('pt-BR')} ·{' '}
                      <Link href={a.sourceHref} className="font-bold text-secondary hover:underline">
                        {a.sourceLabel}
                      </Link>
                    </p>
                  </div>
                  <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${tag.tone}`}>{tag.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
