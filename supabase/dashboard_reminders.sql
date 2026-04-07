-- Lembretes recorrentes no resumo da home (aba Resumo). Execute no SQL Editor do Supabase (uma vez).

create table if not exists public.dashboard_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  frequency text not null,
  reminder_time time not null default '09:00:00'::time,
  weekday smallint null,
  day_of_month smallint null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboard_reminders_frequency_check check (
    frequency in ('daily', 'weekly', 'monthly')
  ),
  constraint dashboard_reminders_weekday_check check (
    weekday is null or (weekday >= 0 and weekday <= 6)
  ),
  constraint dashboard_reminders_dom_check check (
    day_of_month is null or (day_of_month >= 1 and day_of_month <= 31)
  ),
  constraint dashboard_reminders_daily_fields check (
    frequency <> 'daily' or (weekday is null and day_of_month is null)
  ),
  constraint dashboard_reminders_weekly_fields check (
    frequency <> 'weekly' or weekday is not null
  ),
  constraint dashboard_reminders_monthly_fields check (
    frequency <> 'monthly' or day_of_month is not null
  )
);

create index if not exists dashboard_reminders_user_sort_idx
  on public.dashboard_reminders (user_id, active, sort_order, created_at);

comment on table public.dashboard_reminders is 'Lembretes recorrentes exibidos no painel Resumo da home (sem envio externo).';

alter table public.dashboard_reminders enable row level security;

drop policy if exists "dashboard_reminders_select_own" on public.dashboard_reminders;
create policy "dashboard_reminders_select_own"
on public.dashboard_reminders for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "dashboard_reminders_insert_own" on public.dashboard_reminders;
create policy "dashboard_reminders_insert_own"
on public.dashboard_reminders for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "dashboard_reminders_update_own" on public.dashboard_reminders;
create policy "dashboard_reminders_update_own"
on public.dashboard_reminders for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "dashboard_reminders_delete_own" on public.dashboard_reminders;
create policy "dashboard_reminders_delete_own"
on public.dashboard_reminders for delete to authenticated
using (auth.uid() = user_id);
