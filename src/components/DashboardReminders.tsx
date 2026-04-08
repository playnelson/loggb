'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  describeReminderRecurrence,
  formatReminderClock,
  reminderMatchesDate,
  type DashboardReminderFrequency,
  type DashboardReminderRow,
} from '@/lib/dashboardReminders';
import { Bell, Loader2, Plus, Trash2 } from 'lucide-react';

function isMissingRemindersTable(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  const m = String(err.message ?? '').toLowerCase();
  if (m.includes('dashboard_reminders') && (m.includes('does not exist') || m.includes('not find'))) return true;
  if (String(err.code) === '42P01') return true;
  return false;
}

function parseRow(r: Record<string, unknown>): DashboardReminderRow | null {
  const freq = String(r.frequency ?? '');
  if (
    freq !== 'daily' &&
    freq !== 'weekly' &&
    freq !== 'monthly' &&
    freq !== 'yearly' &&
    freq !== 'every_n_days'
  ) return null;
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    body: String(r.body ?? ''),
    frequency: freq as DashboardReminderFrequency,
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

export function DashboardReminders() {
  const [rows, setRows] = useState<DashboardReminderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [frequency, setFrequency] = useState<DashboardReminderFrequency>('daily');
  const [timeLocal, setTimeLocal] = useState('09:00');
  const [weekday, setWeekday] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);

  const todayLabel = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setSchemaError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('dashboard_reminders')
      .select(
        'id, title, body, frequency, reminder_time, weekday, day_of_month, active, sort_order, created_at'
      )
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      if (isMissingRemindersTable(error)) {
        setSchemaError(
          'Tabela dashboard_reminders não encontrada. Execute o script supabase/dashboard_reminders.sql no SQL Editor do Supabase.'
        );
      } else {
        setSchemaError(error.message);
      }
      setRows([]);
      setLoading(false);
      return;
    }

    const list: DashboardReminderRow[] = [];
    for (const r of data || []) {
      const row = parseRow(r as Record<string, unknown>);
      if (row) list.push(row);
    }
    setRows(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dueToday = useMemo(() => {
    const n = new Date();
    return rows.filter((r) => reminderMatchesDate(r, n));
  }, [rows]);

  const addReminder = async () => {
    const t = title.trim();
    if (!t) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload: Record<string, unknown> = {
      user_id: user.id,
      title: t,
      body: body.trim(),
      frequency,
      reminder_time: `${timeLocal}:00`,
      weekday: frequency === 'weekly' ? weekday : null,
      day_of_month: frequency === 'monthly' ? dayOfMonth : null,
      active: true,
      updated_at: new Date().toISOString(),
    };
    const nextOrder = rows.length > 0 ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 0;
    payload.sort_order = nextOrder;

    setSaving(true);
    const { error } = await supabase.from('dashboard_reminders').insert([payload]);
    setSaving(false);
    if (error) {
      alert(`Erro ao criar lembrete: ${error.message}`);
      return;
    }
    setTitle('');
    setBody('');
    setFrequency('daily');
    setTimeLocal('09:00');
    setWeekday(1);
    setDayOfMonth(1);
    void load();
  };

  const remove = async (id: string) => {
    if (!confirm('Remover este lembrete?')) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('dashboard_reminders').delete().eq('id', id).eq('user_id', user.id);
    if (error) alert(`Erro ao remover: ${error.message}`);
    else setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const setActive = async (r: DashboardReminderRow, active: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, active } : x)));
    const { error } = await supabase
      .from('dashboard_reminders')
      .update({ active, updated_at: new Date().toISOString() })
      .eq('id', r.id)
      .eq('user_id', user.id);
    if (error) {
      alert(`Erro ao atualizar: ${error.message}`);
      void load();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-500 gap-2">
        <Loader2 className="animate-spin" size={22} />
        <span className="font-medium">Carregando lembretes…</span>
      </div>
    );
  }

  if (schemaError) {
    return (
      <div className="p-5 bg-amber-50 border border-amber-200 rounded-xl text-amber-950 text-sm leading-relaxed">
        <strong className="font-bold">Lembretes:</strong> {schemaError}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h2 className="text-sm font-black text-primary uppercase tracking-wide flex items-center gap-2">
          <Bell size={18} className="text-secondary" />
          Lembretes recorrentes
        </h2>
        <p className="text-[10px] font-bold text-slate-500 capitalize">{todayLabel}</p>
      </div>

      <div className="p-5 space-y-5">
        {dueToday.length > 0 && (
          <div className="rounded-xl border-2 border-secondary/40 bg-emerald-50/60 p-4 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-900">Hoje no painel</p>
            <ul className="space-y-2">
              {dueToday.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start gap-3 text-sm font-bold text-emerald-950 bg-white/80 rounded-lg border border-emerald-200/80 px-3 py-2"
                >
                  <span className="shrink-0 text-[10px] uppercase bg-emerald-600 text-white px-2 py-0.5 rounded">
                    Hoje · {formatReminderClock(r.reminder_time)}
                  </span>
                  <span className="min-w-0">{r.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
          <p className="text-xs font-bold text-primary">Novo lembrete</p>
          <input
            type="text"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-secondary/40"
            placeholder="Título (ex.: Conferir EPIs)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="w-full min-h-[64px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-secondary/40 resize-y"
            placeholder="Detalhes opcionais…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-slate-500">Repetir</label>
              <select
                className="block px-2 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as DashboardReminderFrequency)}
              >
                <option value="daily">Todo dia</option>
                <option value="weekly">Toda semana</option>
                <option value="monthly">Todo mês</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-slate-500">Horário</label>
              <input
                type="time"
                className="px-2 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium"
                value={timeLocal}
                onChange={(e) => setTimeLocal(e.target.value)}
              />
            </div>
            {frequency === 'weekly' && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-slate-500">Dia</label>
                <select
                  className="block px-2 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium"
                  value={weekday}
                  onChange={(e) => setWeekday(Number(e.target.value))}
                >
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
            {frequency === 'monthly' && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-slate-500">Dia do mês</label>
                <select
                  className="block px-2 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium min-w-[4.5rem]"
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              disabled={saving || !title.trim()}
              onClick={() => void addReminder()}
              className="ml-auto inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
              Adicionar
            </button>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Aparecem destacados quando a data de hoje coincide com a regra (horário local do navegador). Sem e-mail ou SMS.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">Nenhum lembrete ainda. Use o formulário acima.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
            {rows.map((r) => {
              const today = reminderMatchesDate(r, new Date());
              return (
                <li key={r.id} className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 bg-white ${!r.active ? 'opacity-60' : ''}`}>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-primary">{r.title}</p>
                      {today && r.active ? (
                        <span className="text-[10px] font-black uppercase bg-emerald-600 text-white px-2 py-0.5 rounded">
                          Hoje
                        </span>
                      ) : null}
                      {!r.active ? (
                        <span className="text-[10px] font-bold uppercase text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                          Pausado
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[10px] font-medium text-slate-500">{describeReminderRecurrence(r)}</p>
                    {r.body.trim() ? (
                      <p className="text-xs text-slate-600 whitespace-pre-wrap">{r.body}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-2 text-[10px] font-bold text-slate-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300"
                        checked={r.active}
                        onChange={(e) => void setActive(r, e.target.checked)}
                      />
                      Ativo
                    </label>
                    <button
                      type="button"
                      onClick={() => void remove(r.id)}
                      className="p-2 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                      title="Remover"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
