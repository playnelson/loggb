'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  describeReminderRecurrence,
  formatReminderClock,
  reminderMatchesDate,
  type DashboardReminderFrequency,
  type DashboardReminderRow,
} from '@/lib/dashboardReminders';
import {
  Bell,
  CarFront,
  CreditCard,
  Download,
  Loader2,
  Plus,
  Receipt,
  Trash2,
  Wallet,
} from 'lucide-react';

type FinanceTab = 'contas' | 'abastecimentos' | 'despesas' | 'lembretes';

type FinanceAccountRow = {
  id: string;
  title: string;
  amount: number;
  due_date: string;
  template_id?: string | null;
  status: 'pending' | 'paid';
  category: string;
  notes: string;
  paid_at: string | null;
  created_at: string;
};

type FuelLogRow = {
  id: string;
  ref_date: string;
  vehicle: string;
  odometer_km: number | null;
  liters: number;
  price_per_liter: number;
  total_amount: number;
  station: string;
  notes: string;
  created_at: string;
};

type ExpenseRow = {
  id: string;
  ref_date: string;
  description: string;
  category: string;
  amount: number;
  payment_method: string;
  notes: string;
  created_at: string;
};

type FinanceAssetRow = {
  id: string;
  kind: 'veiculo' | 'equipamento';
  name: string;
  code: string;
  active: boolean;
  notes: string;
  created_at: string;
};

type FinanceAccountTemplateRow = {
  id: string;
  title: string;
  amount: number;
  due_day: number;
  category: string;
  active: boolean;
  last_generated_month: string | null;
  notes: string;
  created_at: string;
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const currency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

function parseN(v: string): number {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function toSafeFileName(v: string): string {
  return v
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function isMissingTable(err: { message?: string; code?: string } | null, table: string): boolean {
  if (!err) return false;
  const m = String(err.message ?? '').toLowerCase();
  if (m.includes(table) && (m.includes('does not exist') || m.includes('not find'))) return true;
  return String(err.code) === '42P01';
}

function parseReminderRow(r: Record<string, unknown>): DashboardReminderRow | null {
  const frequency = String(r.frequency ?? '');
  const allowed: DashboardReminderFrequency[] = ['daily', 'weekly', 'monthly', 'yearly', 'every_n_days'];
  if (!allowed.includes(frequency as DashboardReminderFrequency)) return null;
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    body: String(r.body ?? ''),
    frequency: frequency as DashboardReminderFrequency,
    reminder_time: String(r.reminder_time ?? '09:00:00'),
    weekday: r.weekday == null ? null : Number(r.weekday),
    day_of_month: r.day_of_month == null ? null : Number(r.day_of_month),
    month_of_year: r.month_of_year == null ? null : Number(r.month_of_year),
    interval_days: r.interval_days == null ? null : Number(r.interval_days),
    active: Boolean(r.active),
    sort_order: Number(r.sort_order ?? 0),
    created_at: String(r.created_at),
  };
}

export default function FinanceiroPage() {
  const [loading, setLoading] = useState(true);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FinanceTab>('contas');

  const [accounts, setAccounts] = useState<FinanceAccountRow[]>([]);
  const [accountTemplates, setAccountTemplates] = useState<FinanceAccountTemplateRow[]>([]);
  const [assets, setAssets] = useState<FinanceAssetRow[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [reminders, setReminders] = useState<DashboardReminderRow[]>([]);

  const [accTitle, setAccTitle] = useState('');
  const [accAmount, setAccAmount] = useState('');
  const [accDueDate, setAccDueDate] = useState(todayIso());
  const [accCategory, setAccCategory] = useState('Geral');
  const [tplTitle, setTplTitle] = useState('');
  const [tplAmount, setTplAmount] = useState('');
  const [tplDueDay, setTplDueDay] = useState(5);
  const [tplCategory, setTplCategory] = useState('Geral');

  const [fuelDate, setFuelDate] = useState(todayIso());
  const [fuelAssetId, setFuelAssetId] = useState('');
  const [fuelTargetType, setFuelTargetType] = useState<'veiculo' | 'equipamento'>('veiculo');
  const [fuelTargetName, setFuelTargetName] = useState('');
  const [fuelTargetCode, setFuelTargetCode] = useState('');
  const [fuelLiters, setFuelLiters] = useState('');
  const [fuelPrice, setFuelPrice] = useState('');
  const [fuelOdometer, setFuelOdometer] = useState('');
  const [fuelStation, setFuelStation] = useState('');
  const [fuelReportTarget, setFuelReportTarget] = useState<string>('all');
  const [assetKind, setAssetKind] = useState<'veiculo' | 'equipamento'>('veiculo');
  const [assetName, setAssetName] = useState('');
  const [assetCode, setAssetCode] = useState('');

  const [expDate, setExpDate] = useState(todayIso());
  const [expDescription, setExpDescription] = useState('');
  const [expCategory, setExpCategory] = useState('Geral');
  const [expAmount, setExpAmount] = useState('');
  const [expMethod, setExpMethod] = useState('PIX');

  const [remTitle, setRemTitle] = useState('');
  const [remBody, setRemBody] = useState('');
  const [remFrequency, setRemFrequency] = useState<DashboardReminderFrequency>('daily');
  const [remTime, setRemTime] = useState('09:00');
  const [remWeekday, setRemWeekday] = useState(1);
  const [remDayOfMonth, setRemDayOfMonth] = useState(1);
  const [remMonthOfYear, setRemMonthOfYear] = useState(1);
  const [remIntervalDays, setRemIntervalDays] = useState(7);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setSchemaError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setAccounts([]);
      setFuelLogs([]);
      setExpenses([]);
      setReminders([]);
      setLoading(false);
      return;
    }

    const [accR, tplR, assetsR, fuelR, expR, remR] = await Promise.all([
      supabase
        .from('finance_accounts')
        .select('id, title, amount, due_date, status, category, notes, paid_at, template_id, created_at')
        .eq('user_id', user.id)
        .order('due_date', { ascending: true }),
      supabase
        .from('finance_account_templates')
        .select('id, title, amount, due_day, category, active, last_generated_month, notes, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('finance_assets')
        .select('id, kind, name, code, active, notes, created_at')
        .eq('user_id', user.id)
        .order('kind', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('finance_fuel_logs')
        .select('id, ref_date, vehicle, odometer_km, liters, price_per_liter, total_amount, station, notes, created_at')
        .eq('user_id', user.id)
        .order('ref_date', { ascending: false }),
      supabase
        .from('finance_expenses')
        .select('id, ref_date, description, category, amount, payment_method, notes, created_at')
        .eq('user_id', user.id)
        .order('ref_date', { ascending: false }),
      supabase
        .from('dashboard_reminders')
        .select(
          'id, title, body, frequency, reminder_time, weekday, day_of_month, month_of_year, interval_days, active, sort_order, created_at'
        )
        .eq('user_id', user.id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);

    const financeMissing =
      isMissingTable(accR.error, 'finance_accounts') ||
      isMissingTable(tplR.error, 'finance_account_templates') ||
      isMissingTable(assetsR.error, 'finance_assets') ||
      isMissingTable(fuelR.error, 'finance_fuel_logs') ||
      isMissingTable(expR.error, 'finance_expenses');
    if (financeMissing) {
      setSchemaError('Módulo financeiro não encontrado. Execute o script supabase/finance_hub.sql no Supabase.');
      setLoading(false);
      return;
    }

    if (accR.error || tplR.error || assetsR.error || fuelR.error || expR.error || remR.error) {
      setSchemaError(
        accR.error?.message ||
          tplR.error?.message ||
          assetsR.error?.message ||
          fuelR.error?.message ||
          expR.error?.message ||
          remR.error?.message ||
          'Erro ao carregar módulo financeiro.'
      );
      setLoading(false);
      return;
    }

    setAccounts((accR.data || []).map((r: unknown) => r as FinanceAccountRow));
    setAccountTemplates((tplR.data || []).map((r: unknown) => r as FinanceAccountTemplateRow));
    setAssets((assetsR.data || []).map((r: unknown) => r as FinanceAssetRow));
    setFuelLogs((fuelR.data || []).map((r: unknown) => r as FuelLogRow));
    setExpenses((expR.data || []).map((r: unknown) => r as ExpenseRow));
    setReminders(
      (remR.data || [])
        .map((r: unknown) => parseReminderRow(r as Record<string, unknown>))
        .filter(Boolean) as DashboardReminderRow[]
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const now = new Date();
    const m = now.getMonth();
    const y = now.getFullYear();
    const inMonth = (isoDate: string) => {
      const d = new Date(`${isoDate}T00:00:00`);
      return d.getMonth() === m && d.getFullYear() === y;
    };

    const contasMes = accounts.filter((a) => inMonth(a.due_date)).reduce((s, a) => s + Number(a.amount || 0), 0);
    const abastMes = fuelLogs.filter((f) => inMonth(f.ref_date)).reduce((s, f) => s + Number(f.total_amount || 0), 0);
    const despMes = expenses.filter((e) => inMonth(e.ref_date)).reduce((s, e) => s + Number(e.amount || 0), 0);
    return { contasMes, abastMes, despMes, totalMes: contasMes + abastMes + despMes };
  }, [accounts, fuelLogs, expenses]);

  const dueToday = useMemo(() => {
    const n = new Date();
    return reminders.filter((r) => reminderMatchesDate(r, n));
  }, [reminders]);

  const fuelTargets = useMemo(() => {
    return Array.from(new Set(fuelLogs.map((f) => String(f.vehicle || '').trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR')
    );
  }, [fuelLogs]);

  const filteredFuelLogs = useMemo(() => {
    if (fuelReportTarget === 'all') return fuelLogs;
    return fuelLogs.filter((f) => f.vehicle === fuelReportTarget);
  }, [fuelLogs, fuelReportTarget]);

  const activeAssets = useMemo(() => assets.filter((a) => a.active), [assets]);

  const addAccount = async () => {
    if (!accTitle.trim()) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('finance_accounts').insert([
      {
        user_id: user.id,
        title: accTitle.trim(),
        amount: parseN(accAmount),
        due_date: accDueDate,
        category: accCategory.trim() || 'Geral',
        status: 'pending',
        updated_at: new Date().toISOString(),
      },
    ]);
    setSaving(false);
    if (error) return alert(`Erro: ${error.message}`);
    setAccTitle('');
    setAccAmount('');
    setAccCategory('Geral');
    void load();
  };

  const addAccountTemplate = async () => {
    if (!tplTitle.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('finance_account_templates').insert([
      {
        user_id: user.id,
        title: tplTitle.trim(),
        amount: parseN(tplAmount),
        due_day: tplDueDay,
        category: tplCategory.trim() || 'Geral',
        active: true,
        updated_at: new Date().toISOString(),
      },
    ]);
    setSaving(false);
    if (error) return alert(`Erro: ${error.message}`);
    setTplTitle('');
    setTplAmount('');
    setTplDueDay(5);
    setTplCategory('Geral');
    void load();
  };

  const generateRecurringAccounts = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const monthKey = `${y}-${String(m).padStart(2, '0')}`;
    let created = 0;
    for (const t of accountTemplates.filter((x) => x.active)) {
      const lastDay = new Date(y, m, 0).getDate();
      const day = Math.min(Math.max(1, t.due_day), lastDay);
      const dueDate = `${monthKey}-${String(day).padStart(2, '0')}`;
      const existing = accounts.find((a) => a.template_id === t.id && a.due_date === dueDate);
      if (existing) continue;
      const { error } = await supabase.from('finance_accounts').insert([
        {
          user_id: user.id,
          title: t.title,
          amount: t.amount,
          due_date: dueDate,
          status: 'pending',
          category: t.category || 'Geral',
          template_id: t.id,
          updated_at: new Date().toISOString(),
        },
      ]);
      if (!error) created += 1;
      await supabase
        .from('finance_account_templates')
        .update({ last_generated_month: monthKey, updated_at: new Date().toISOString() })
        .eq('id', t.id)
        .eq('user_id', user.id);
    }
    alert(created > 0 ? `${created} conta(s) recorrente(s) gerada(s) para ${monthKey}.` : 'Nenhuma conta nova para gerar neste mês.');
    void load();
  };

  const setTemplateActive = async (row: FinanceAccountTemplateRow, active: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from('finance_account_templates')
      .update({ active, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('user_id', user.id);
    if (error) return alert(`Erro: ${error.message}`);
    void load();
  };

  const addAsset = async () => {
    if (!assetName.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('finance_assets').insert([
      {
        user_id: user.id,
        kind: assetKind,
        name: assetName.trim(),
        code: assetCode.trim(),
        active: true,
        updated_at: new Date().toISOString(),
      },
    ]);
    setSaving(false);
    if (error) return alert(`Erro: ${error.message}`);
    setAssetKind('veiculo');
    setAssetName('');
    setAssetCode('');
    void load();
  };

  const setAssetActive = async (row: FinanceAssetRow, active: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from('finance_assets')
      .update({ active, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('user_id', user.id);
    if (error) return alert(`Erro: ${error.message}`);
    void load();
  };

  const toggleAccountPaid = async (row: FinanceAccountRow) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const next = row.status === 'paid' ? 'pending' : 'paid';
    const { error } = await supabase
      .from('finance_accounts')
      .update({ status: next, paid_at: next === 'paid' ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('user_id', user.id);
    if (error) return alert(`Erro: ${error.message}`);
    void load();
  };

  const removeRow = async (
    table:
      | 'finance_accounts'
      | 'finance_account_templates'
      | 'finance_assets'
      | 'finance_fuel_logs'
      | 'finance_expenses'
      | 'dashboard_reminders',
    id: string
  ) => {
    if (!confirm('Remover este registro?')) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from(table).delete().eq('id', id).eq('user_id', user.id);
    if (error) return alert(`Erro: ${error.message}`);
    void load();
  };

  const addFuel = async () => {
    const liters = parseN(fuelLiters);
    const price = parseN(fuelPrice);
    if (!(fuelAssetId || fuelTargetName.trim()) || liters <= 0) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const total = liters * price;
    const selectedAsset = activeAssets.find((a) => a.id === fuelAssetId);
    const idPart = selectedAsset
      ? selectedAsset.code.trim()
        ? ` [${selectedAsset.code.trim()}]`
        : ''
      : fuelTargetCode.trim()
        ? ` [${fuelTargetCode.trim()}]`
        : '';
    const targetLabel = selectedAsset
      ? `${selectedAsset.kind === 'veiculo' ? 'VEICULO' : 'EQUIPAMENTO'}: ${selectedAsset.name}${idPart}`
      : `${fuelTargetType === 'veiculo' ? 'VEICULO' : 'EQUIPAMENTO'}: ${fuelTargetName.trim()}${idPart}`;
    const { error } = await supabase.from('finance_fuel_logs').insert([
      {
        user_id: user.id,
        ref_date: fuelDate,
        vehicle: targetLabel,
        odometer_km: fuelOdometer.trim() ? parseN(fuelOdometer) : null,
        liters,
        price_per_liter: price,
        total_amount: total,
        station: fuelStation.trim(),
        updated_at: new Date().toISOString(),
      },
    ]);
    setSaving(false);
    if (error) return alert(`Erro: ${error.message}`);
    setFuelAssetId('');
    setFuelTargetType('veiculo');
    setFuelTargetName('');
    setFuelTargetCode('');
    setFuelLiters('');
    setFuelPrice('');
    setFuelOdometer('');
    setFuelStation('');
    void load();
  };

  const exportFuelTxt = (target: string) => {
    const logs = target === 'all' ? fuelLogs : fuelLogs.filter((f) => f.vehicle === target);
    if (logs.length === 0) {
      alert('Nenhum abastecimento para gerar relatório.');
      return;
    }
    const totalLiters = logs.reduce((s, l) => s + Number(l.liters || 0), 0);
    const totalValue = logs.reduce((s, l) => s + Number(l.total_amount || 0), 0);
    const avgPrice = totalLiters > 0 ? totalValue / totalLiters : 0;
    const title = target === 'all' ? 'TODOS OS ITENS' : target;
    const lines: string[] = [];
    lines.push('RELATORIO DE ABASTECIMENTOS - LOGGB');
    lines.push(`EMITIDO EM: ${new Date().toLocaleString('pt-BR')}`);
    lines.push(`ITEM: ${title}`);
    lines.push(`REGISTROS: ${logs.length}`);
    lines.push(`TOTAL LITROS: ${totalLiters.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    lines.push(`TOTAL GASTO: ${currency(totalValue)}`);
    lines.push(`PRECO MEDIO/L: ${currency(avgPrice)}`);
    lines.push('');
    lines.push('DATA | ITEM | LITROS | PRECO/L | TOTAL | KM | POSTO');
    lines.push('-------------------------------------------------------------');
    logs.forEach((l) => {
      lines.push(
        [
          new Date(`${l.ref_date}T00:00:00`).toLocaleDateString('pt-BR'),
          l.vehicle,
          Number(l.liters || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          currency(Number(l.price_per_liter || 0)),
          currency(Number(l.total_amount || 0)),
          l.odometer_km != null ? Number(l.odometer_km).toLocaleString('pt-BR') : '-',
          l.station || '-',
        ].join(' | ')
      );
    });
    const content = lines.join('\r\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    const safe = toSafeFileName(target === 'all' ? 'geral' : target);
    a.href = url;
    a.download = `abastecimentos_${safe}_${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addExpense = async () => {
    if (!expDescription.trim()) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('finance_expenses').insert([
      {
        user_id: user.id,
        ref_date: expDate,
        description: expDescription.trim(),
        category: expCategory.trim() || 'Geral',
        amount: parseN(expAmount),
        payment_method: expMethod.trim() || 'Nao informado',
        updated_at: new Date().toISOString(),
      },
    ]);
    setSaving(false);
    if (error) return alert(`Erro: ${error.message}`);
    setExpDescription('');
    setExpCategory('Geral');
    setExpAmount('');
    setExpMethod('PIX');
    void load();
  };

  const addReminder = async () => {
    if (!remTitle.trim()) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const payload: Record<string, unknown> = {
      user_id: user.id,
      title: remTitle.trim(),
      body: remBody.trim(),
      frequency: remFrequency,
      reminder_time: `${remTime}:00`,
      weekday: remFrequency === 'weekly' ? remWeekday : null,
      day_of_month: remFrequency === 'monthly' || remFrequency === 'yearly' ? remDayOfMonth : null,
      month_of_year: remFrequency === 'yearly' ? remMonthOfYear : null,
      interval_days: remFrequency === 'every_n_days' ? remIntervalDays : null,
      active: true,
      sort_order: reminders.length > 0 ? Math.max(...reminders.map((r) => r.sort_order)) + 1 : 0,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('dashboard_reminders').insert([payload]);
    setSaving(false);
    if (error) return alert(`Erro ao criar lembrete: ${error.message}`);
    setRemTitle('');
    setRemBody('');
    setRemFrequency('daily');
    setRemTime('09:00');
    setRemWeekday(1);
    setRemDayOfMonth(1);
    setRemMonthOfYear(1);
    setRemIntervalDays(7);
    void load();
  };

  const setReminderActive = async (r: DashboardReminderRow, active: boolean) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from('dashboard_reminders')
      .update({ active, updated_at: new Date().toISOString() })
      .eq('id', r.id)
      .eq('user_id', user.id);
    if (error) return alert(`Erro: ${error.message}`);
    void load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2">
        <Loader2 className="animate-spin" size={22} />
        <span className="font-medium">Carregando módulo financeiro…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">Controle Financeiro</h1>
          <p className="text-slate-500 text-sm">Contas, abastecimentos, despesas e lembretes recorrentes em um único módulo.</p>
        </div>
      </div>

      {schemaError ? (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm">
          <strong>Módulo Financeiro:</strong> {schemaError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] uppercase font-bold text-slate-500">Contas (mês)</p>
          <p className="text-xl font-black text-primary">{currency(totals.contasMes)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] uppercase font-bold text-slate-500">Abastecimentos (mês)</p>
          <p className="text-xl font-black text-primary">{currency(totals.abastMes)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] uppercase font-bold text-slate-500">Despesas (mês)</p>
          <p className="text-xl font-black text-primary">{currency(totals.despMes)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] uppercase font-bold text-slate-500">Total previsto (mês)</p>
          <p className="text-xl font-black text-secondary">{currency(totals.totalMes)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { id: 'contas', label: 'Contas', icon: <CreditCard size={16} /> },
          { id: 'abastecimentos', label: 'Abastecimentos', icon: <CarFront size={16} /> },
          { id: 'despesas', label: 'Despesas', icon: <Receipt size={16} /> },
          { id: 'lembretes', label: 'Lembretes', icon: <Bell size={16} /> },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id as FinanceTab)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border ${
              activeTab === t.id ? 'bg-primary text-white border-primary' : 'bg-white text-primary border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'contas' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-border shadow-sm grid md:grid-cols-5 gap-2 items-end">
            <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Título da conta" value={accTitle} onChange={(e) => setAccTitle(e.target.value)} />
            <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Valor (R$)" value={accAmount} onChange={(e) => setAccAmount(e.target.value)} />
            <input type="date" className="px-3 py-2 rounded-lg border border-slate-200 text-sm" value={accDueDate} onChange={(e) => setAccDueDate(e.target.value)} />
            <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Categoria" value={accCategory} onChange={(e) => setAccCategory(e.target.value)} />
            <button type="button" disabled={saving || !accTitle.trim()} onClick={() => void addAccount()} className="inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
              <Plus size={16} /> Adicionar
            </button>
          </div>
          <div className="bg-white p-4 rounded-xl border border-border shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase text-slate-500">Contas recorrentes</p>
              <button
                type="button"
                onClick={() => void generateRecurringAccounts()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-primary text-xs font-bold hover:bg-slate-100"
              >
                <Plus size={14} /> Gerar contas recorrentes do mês
              </button>
            </div>
            <div className="grid md:grid-cols-5 gap-2 items-end">
              <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Título recorrente" value={tplTitle} onChange={(e) => setTplTitle(e.target.value)} />
              <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Valor (R$)" value={tplAmount} onChange={(e) => setTplAmount(e.target.value)} />
              <input type="number" min={1} max={31} className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Dia do vencimento" value={tplDueDay} onChange={(e) => setTplDueDay(Number(e.target.value || 1))} />
              <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Categoria" value={tplCategory} onChange={(e) => setTplCategory(e.target.value)} />
              <button type="button" disabled={saving || !tplTitle.trim()} onClick={() => void addAccountTemplate()} className="inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
                <Plus size={16} /> Adicionar recorrente
              </button>
            </div>
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
              {accountTemplates.map((t) => (
                <li key={t.id} className={`px-3 py-2 flex items-center gap-2 ${t.active ? 'bg-white' : 'bg-slate-50/70'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-primary truncate">{t.title}</div>
                    <div className="text-[10px] text-slate-500">
                      dia {t.due_day} · {currency(Number(t.amount || 0))} · {t.category}
                      {t.last_generated_month ? ` · último: ${t.last_generated_month}` : ''}
                    </div>
                  </div>
                  <label className="text-[10px] font-bold text-slate-600 flex items-center gap-1">
                    <input type="checkbox" checked={t.active} onChange={(e) => void setTemplateActive(t, e.target.checked)} />
                    Ativo
                  </label>
                  <button type="button" onClick={() => void removeRow('finance_account_templates', t.id)} className="p-2 rounded text-slate-500 hover:bg-rose-50 hover:text-rose-700">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Conta</th>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Vencimento</th>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Valor</th>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Status</th>
                  <th className="px-4 py-2 text-right text-[10px] uppercase text-slate-500">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2">
                      <div className="font-bold text-primary">{a.title}</div>
                      <div className="text-[10px] text-slate-500">{a.category}</div>
                    </td>
                    <td className="px-4 py-2">{new Date(`${a.due_date}T00:00:00`).toLocaleDateString('pt-BR')}</td>
                    <td className="px-4 py-2 font-bold">{currency(Number(a.amount || 0))}</td>
                    <td className="px-4 py-2">
                      <button type="button" onClick={() => void toggleAccountPaid(a)} className={`text-[11px] font-bold px-2 py-1 rounded ${a.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                        {a.status === 'paid' ? 'Pago' : 'Pendente'}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => void removeRow('finance_accounts', a.id)} className="p-2 rounded text-slate-500 hover:bg-rose-50 hover:text-rose-700">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'abastecimentos' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-border shadow-sm grid md:grid-cols-8 gap-2 items-end">
            <input type="date" className="px-3 py-2 rounded-lg border border-slate-200 text-sm" value={fuelDate} onChange={(e) => setFuelDate(e.target.value)} />
            <select
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
              value={fuelAssetId}
              onChange={(e) => {
                const id = e.target.value;
                setFuelAssetId(id);
                const selected = activeAssets.find((a) => a.id === id);
                if (selected) {
                  setFuelTargetType(selected.kind);
                  setFuelTargetName(selected.name);
                  setFuelTargetCode(selected.code || '');
                }
              }}
            >
              <option value="">Selecionar cadastrado…</option>
              {activeAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {(a.kind === 'veiculo' ? 'VEICULO' : 'EQUIPAMENTO') + ': ' + a.name + (a.code ? ` [${a.code}]` : '')}
                </option>
              ))}
            </select>
            <select className="px-3 py-2 rounded-lg border border-slate-200 text-sm" value={fuelTargetType} onChange={(e) => setFuelTargetType(e.target.value as 'veiculo' | 'equipamento')}>
              <option value="veiculo">Veículo</option>
              <option value="equipamento">Equipamento</option>
            </select>
            <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder={fuelTargetType === 'veiculo' ? 'Nome do veículo' : 'Nome do equipamento'} value={fuelTargetName} onChange={(e) => setFuelTargetName(e.target.value)} />
            <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Placa / TAG / ID" value={fuelTargetCode} onChange={(e) => setFuelTargetCode(e.target.value)} />
            <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Litros" value={fuelLiters} onChange={(e) => setFuelLiters(e.target.value)} />
            <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Preço/litro" value={fuelPrice} onChange={(e) => setFuelPrice(e.target.value)} />
            <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="KM/Horas (opcional)" value={fuelOdometer} onChange={(e) => setFuelOdometer(e.target.value)} />
            <button type="button" disabled={saving || !(fuelAssetId || fuelTargetName.trim())} onClick={() => void addFuel()} className="inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
              <Plus size={16} /> Lançar
            </button>
          </div>
          <div className="bg-white p-4 rounded-xl border border-border shadow-sm space-y-3">
            <p className="text-xs font-bold uppercase text-slate-500">Cadastro de veículos e equipamentos</p>
            <div className="grid md:grid-cols-4 gap-2 items-end">
              <select className="px-3 py-2 rounded-lg border border-slate-200 text-sm" value={assetKind} onChange={(e) => setAssetKind(e.target.value as 'veiculo' | 'equipamento')}>
                <option value="veiculo">Veículo</option>
                <option value="equipamento">Equipamento</option>
              </select>
              <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Nome do item" value={assetName} onChange={(e) => setAssetName(e.target.value)} />
              <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Placa / TAG / ID" value={assetCode} onChange={(e) => setAssetCode(e.target.value)} />
              <button type="button" disabled={saving || !assetName.trim()} onClick={() => void addAsset()} className="inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
                <Plus size={16} /> Cadastrar item
              </button>
            </div>
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
              {assets.map((a) => (
                <li key={a.id} className={`px-3 py-2 flex items-center gap-2 ${a.active ? 'bg-white' : 'bg-slate-50/70'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-primary truncate">{a.kind === 'veiculo' ? 'VEICULO' : 'EQUIPAMENTO'}: {a.name}</div>
                    <div className="text-[10px] text-slate-500">{a.code || 'Sem identificação'}</div>
                  </div>
                  <label className="text-[10px] font-bold text-slate-600 flex items-center gap-1">
                    <input type="checkbox" checked={a.active} onChange={(e) => void setAssetActive(a, e.target.checked)} />
                    Ativo
                  </label>
                  <button type="button" onClick={() => void removeRow('finance_assets', a.id)} className="p-2 rounded text-slate-500 hover:bg-rose-50 hover:text-rose-700">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white p-4 rounded-xl border border-border shadow-sm flex flex-wrap items-end gap-2">
            <div className="min-w-[280px]">
              <label className="text-[10px] uppercase font-bold text-slate-500">Relatório por veículo/equipamento</label>
              <select className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm" value={fuelReportTarget} onChange={(e) => setFuelReportTarget(e.target.value)}>
                <option value="all">Todos</option>
                {fuelTargets.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <button type="button" onClick={() => exportFuelTxt(fuelReportTarget)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-primary text-sm font-bold hover:bg-slate-50">
              <Download size={16} /> Baixar TXT
            </button>
            {fuelTargets.map((t) => (
              <button key={t} type="button" onClick={() => exportFuelTxt(t)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100">
                <Download size={14} /> {t}
              </button>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Data</th>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Veículo</th>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Litros</th>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Preço/L</th>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Total</th>
                  <th className="px-4 py-2 text-right text-[10px] uppercase text-slate-500">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredFuelLogs.map((f) => (
                  <tr key={f.id}>
                    <td className="px-4 py-2">{new Date(`${f.ref_date}T00:00:00`).toLocaleDateString('pt-BR')}</td>
                    <td className="px-4 py-2 font-bold text-primary">{f.vehicle}</td>
                    <td className="px-4 py-2">{Number(f.liters || 0).toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-2">{currency(Number(f.price_per_liter || 0))}</td>
                    <td className="px-4 py-2 font-bold">{currency(Number(f.total_amount || 0))}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => void removeRow('finance_fuel_logs', f.id)} className="p-2 rounded text-slate-500 hover:bg-rose-50 hover:text-rose-700">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'despesas' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-border shadow-sm grid md:grid-cols-6 gap-2 items-end">
            <input type="date" className="px-3 py-2 rounded-lg border border-slate-200 text-sm" value={expDate} onChange={(e) => setExpDate(e.target.value)} />
            <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Descrição" value={expDescription} onChange={(e) => setExpDescription(e.target.value)} />
            <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Categoria" value={expCategory} onChange={(e) => setExpCategory(e.target.value)} />
            <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Valor (R$)" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} />
            <input className="px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Pagamento (PIX, cartão...)" value={expMethod} onChange={(e) => setExpMethod(e.target.value)} />
            <button type="button" disabled={saving || !expDescription.trim()} onClick={() => void addExpense()} className="inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
              <Plus size={16} /> Lançar
            </button>
          </div>
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Data</th>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Descrição</th>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Categoria</th>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Pagamento</th>
                  <th className="px-4 py-2 text-left text-[10px] uppercase text-slate-500">Valor</th>
                  <th className="px-4 py-2 text-right text-[10px] uppercase text-slate-500">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2">{new Date(`${e.ref_date}T00:00:00`).toLocaleDateString('pt-BR')}</td>
                    <td className="px-4 py-2 font-bold text-primary">{e.description}</td>
                    <td className="px-4 py-2">{e.category}</td>
                    <td className="px-4 py-2">{e.payment_method}</td>
                    <td className="px-4 py-2 font-bold">{currency(Number(e.amount || 0))}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => void removeRow('finance_expenses', e.id)} className="p-2 rounded text-slate-500 hover:bg-rose-50 hover:text-rose-700">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'lembretes' && (
        <div className="space-y-4">
          {dueToday.length > 0 && (
            <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
              <p className="text-[11px] font-black uppercase text-emerald-900">Vencem hoje</p>
              <ul className="mt-2 space-y-2">
                {dueToday.map((r) => (
                  <li key={r.id} className="text-sm font-bold text-emerald-950 bg-white border border-emerald-200 rounded px-3 py-2">
                    {r.title} · {formatReminderClock(r.reminder_time)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-white p-4 rounded-xl border border-border shadow-sm space-y-3">
            <p className="text-xs font-bold text-primary inline-flex items-center gap-2">
              <Wallet size={16} /> Novo lembrete recorrente
            </p>
            <input className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Título" value={remTitle} onChange={(e) => setRemTitle(e.target.value)} />
            <textarea className="w-full min-h-[70px] px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Detalhes opcionais" value={remBody} onChange={(e) => setRemBody(e.target.value)} />
            <div className="grid md:grid-cols-5 gap-2 items-end">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500">Repetição</label>
                <select className="w-full px-2 py-2 rounded-lg border border-slate-200 text-sm" value={remFrequency} onChange={(e) => setRemFrequency(e.target.value as DashboardReminderFrequency)}>
                  <option value="daily">Todo dia</option>
                  <option value="weekly">Toda semana</option>
                  <option value="monthly">Todo mês</option>
                  <option value="yearly">Todo ano</option>
                  <option value="every_n_days">A cada N dias</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500">Horário</label>
                <input type="time" className="w-full px-2 py-2 rounded-lg border border-slate-200 text-sm" value={remTime} onChange={(e) => setRemTime(e.target.value)} />
              </div>
              {remFrequency === 'weekly' && (
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500">Dia da semana</label>
                  <select className="w-full px-2 py-2 rounded-lg border border-slate-200 text-sm" value={remWeekday} onChange={(e) => setRemWeekday(Number(e.target.value))}>
                    <option value={0}>Domingo</option>
                    <option value={1}>Segunda</option>
                    <option value={2}>Terça</option>
                    <option value={3}>Quarta</option>
                    <option value={4}>Quinta</option>
                    <option value={5}>Sexta</option>
                    <option value={6}>Sábado</option>
                  </select>
                </div>
              )}
              {(remFrequency === 'monthly' || remFrequency === 'yearly') && (
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500">Dia do mês</label>
                  <select className="w-full px-2 py-2 rounded-lg border border-slate-200 text-sm" value={remDayOfMonth} onChange={(e) => setRemDayOfMonth(Number(e.target.value))}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}
              {remFrequency === 'yearly' && (
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500">Mês</label>
                  <select className="w-full px-2 py-2 rounded-lg border border-slate-200 text-sm" value={remMonthOfYear} onChange={(e) => setRemMonthOfYear(Number(e.target.value))}>
                    {['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'].map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
              )}
              {remFrequency === 'every_n_days' && (
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500">Intervalo (dias)</label>
                  <input type="number" min={1} max={365} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-sm" value={remIntervalDays} onChange={(e) => setRemIntervalDays(Number(e.target.value || 1))} />
                </div>
              )}
              <button type="button" disabled={saving || !remTitle.trim()} onClick={() => void addReminder()} className="inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
                <Plus size={16} /> Adicionar
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <ul className="divide-y divide-slate-100">
              {reminders.map((r) => (
                <li key={r.id} className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${r.active ? 'bg-white' : 'bg-slate-50/60'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-primary text-sm">{r.title}</p>
                      {reminderMatchesDate(r, new Date()) ? (
                        <span className="text-[10px] font-black uppercase bg-emerald-600 text-white px-2 py-0.5 rounded">Hoje</span>
                      ) : null}
                    </div>
                    <p className="text-[10px] font-medium text-slate-500">{describeReminderRecurrence(r)}</p>
                    {r.body ? <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap">{r.body}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] font-bold text-slate-600 flex items-center gap-1">
                      <input type="checkbox" checked={r.active} onChange={(e) => void setReminderActive(r, e.target.checked)} />
                      Ativo
                    </label>
                    <button type="button" onClick={() => void removeRow('dashboard_reminders', r.id)} className="p-2 rounded text-slate-500 hover:bg-rose-50 hover:text-rose-700">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

