-- Módulo Financeiro (contas, abastecimentos e despesas) + evolução de lembretes recorrentes.
-- Execute no SQL Editor do Supabase (uma vez).

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  amount numeric not null check (amount >= 0),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  category text not null default 'Geral',
  notes text not null default '',
  paid_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_accounts_user_due_idx
  on public.finance_accounts (user_id, due_date, status, created_at desc);

create table if not exists public.finance_fuel_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ref_date date not null,
  vehicle text not null default '',
  odometer_km numeric null,
  liters numeric not null check (liters > 0),
  price_per_liter numeric not null check (price_per_liter >= 0),
  total_amount numeric not null check (total_amount >= 0),
  station text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_fuel_logs_user_date_idx
  on public.finance_fuel_logs (user_id, ref_date desc, created_at desc);

create table if not exists public.finance_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ref_date date not null,
  description text not null,
  category text not null default 'Geral',
  amount numeric not null check (amount >= 0),
  payment_method text not null default 'Nao informado',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_expenses_user_date_idx
  on public.finance_expenses (user_id, ref_date desc, created_at desc);

alter table public.finance_accounts enable row level security;
alter table public.finance_fuel_logs enable row level security;
alter table public.finance_expenses enable row level security;

drop policy if exists "finance_accounts_select_own" on public.finance_accounts;
create policy "finance_accounts_select_own"
on public.finance_accounts for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "finance_accounts_insert_own" on public.finance_accounts;
create policy "finance_accounts_insert_own"
on public.finance_accounts for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "finance_accounts_update_own" on public.finance_accounts;
create policy "finance_accounts_update_own"
on public.finance_accounts for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "finance_accounts_delete_own" on public.finance_accounts;
create policy "finance_accounts_delete_own"
on public.finance_accounts for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "finance_fuel_logs_select_own" on public.finance_fuel_logs;
create policy "finance_fuel_logs_select_own"
on public.finance_fuel_logs for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "finance_fuel_logs_insert_own" on public.finance_fuel_logs;
create policy "finance_fuel_logs_insert_own"
on public.finance_fuel_logs for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "finance_fuel_logs_update_own" on public.finance_fuel_logs;
create policy "finance_fuel_logs_update_own"
on public.finance_fuel_logs for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "finance_fuel_logs_delete_own" on public.finance_fuel_logs;
create policy "finance_fuel_logs_delete_own"
on public.finance_fuel_logs for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "finance_expenses_select_own" on public.finance_expenses;
create policy "finance_expenses_select_own"
on public.finance_expenses for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "finance_expenses_insert_own" on public.finance_expenses;
create policy "finance_expenses_insert_own"
on public.finance_expenses for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "finance_expenses_update_own" on public.finance_expenses;
create policy "finance_expenses_update_own"
on public.finance_expenses for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "finance_expenses_delete_own" on public.finance_expenses;
create policy "finance_expenses_delete_own"
on public.finance_expenses for delete to authenticated
using (auth.uid() = user_id);

-- Evolução dos lembretes: diário, semanal, mensal, anual e a cada N dias.
alter table public.dashboard_reminders
  add column if not exists month_of_year smallint null,
  add column if not exists interval_days smallint null;

alter table public.dashboard_reminders
  drop constraint if exists dashboard_reminders_frequency_check;
alter table public.dashboard_reminders
  add constraint dashboard_reminders_frequency_check
  check (frequency in ('daily', 'weekly', 'monthly', 'yearly', 'every_n_days'));

alter table public.dashboard_reminders
  drop constraint if exists dashboard_reminders_month_check;
alter table public.dashboard_reminders
  add constraint dashboard_reminders_month_check
  check (month_of_year is null or (month_of_year between 1 and 12));

alter table public.dashboard_reminders
  drop constraint if exists dashboard_reminders_interval_days_check;
alter table public.dashboard_reminders
  add constraint dashboard_reminders_interval_days_check
  check (interval_days is null or (interval_days between 1 and 365));

alter table public.dashboard_reminders
  drop constraint if exists dashboard_reminders_daily_fields;
alter table public.dashboard_reminders
  add constraint dashboard_reminders_daily_fields
  check (
    frequency <> 'daily'
    or (weekday is null and day_of_month is null and month_of_year is null and interval_days is null)
  );

alter table public.dashboard_reminders
  drop constraint if exists dashboard_reminders_weekly_fields;
alter table public.dashboard_reminders
  add constraint dashboard_reminders_weekly_fields
  check (
    frequency <> 'weekly'
    or (weekday is not null and day_of_month is null and month_of_year is null and interval_days is null)
  );

alter table public.dashboard_reminders
  drop constraint if exists dashboard_reminders_monthly_fields;
alter table public.dashboard_reminders
  add constraint dashboard_reminders_monthly_fields
  check (
    frequency <> 'monthly'
    or (day_of_month is not null and weekday is null and month_of_year is null and interval_days is null)
  );

alter table public.dashboard_reminders
  drop constraint if exists dashboard_reminders_yearly_fields;
alter table public.dashboard_reminders
  add constraint dashboard_reminders_yearly_fields
  check (
    frequency <> 'yearly'
    or (day_of_month is not null and month_of_year is not null and weekday is null and interval_days is null)
  );

alter table public.dashboard_reminders
  drop constraint if exists dashboard_reminders_every_n_days_fields;
alter table public.dashboard_reminders
  add constraint dashboard_reminders_every_n_days_fields
  check (
    frequency <> 'every_n_days'
    or (interval_days is not null and weekday is null and day_of_month is null and month_of_year is null)
  );
