export type DashboardReminderFrequency = 'daily' | 'weekly' | 'monthly';

export type DashboardReminderRow = {
  id: string;
  title: string;
  body: string;
  frequency: DashboardReminderFrequency;
  reminder_time: string;
  weekday: number | null;
  day_of_month: number | null;
  active: boolean;
  sort_order: number;
  created_at: string;
};

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function lastDayOfMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** Whether this reminder's calendar rule matches "today" in local time. */
export function reminderMatchesDate(r: DashboardReminderRow, now: Date): boolean {
  if (!r.active) return false;
  if (r.frequency === 'daily') return true;
  if (r.frequency === 'weekly') {
    if (r.weekday == null) return false;
    return now.getDay() === r.weekday;
  }
  if (r.frequency === 'monthly') {
    if (r.day_of_month == null) return false;
    const last = lastDayOfMonth(now);
    const dom = r.day_of_month;
    const effective = Math.min(dom, last);
    return now.getDate() === effective;
  }
  return false;
}

/** HH:MM from Postgres time string (e.g. "09:00:00" or "09:00"). */
export function formatReminderClock(reminderTime: string): string {
  const t = reminderTime.trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = String(Number(m[1])).padStart(2, '0');
  const min = m[2];
  return `${h}:${min}`;
}

export function describeReminderRecurrence(r: DashboardReminderRow): string {
  const clock = formatReminderClock(r.reminder_time);
  if (r.frequency === 'daily') return `Todo dia · ${clock}`;
  if (r.frequency === 'weekly') {
    const w = r.weekday != null ? WEEKDAY_LABELS[r.weekday] ?? '?' : '?';
    return `Toda semana (${w}) · ${clock}`;
  }
  if (r.frequency === 'monthly') {
    const d = r.day_of_month ?? '?';
    return `Todo mês (dia ${d}) · ${clock}`;
  }
  return clock;
}
