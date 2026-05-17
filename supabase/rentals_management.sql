-- Gestão de equipamentos alugados (integrado ao almoxarifado).
-- Execute no SQL Editor do Supabase.

alter table public.items
  add column if not exists is_rented boolean not null default false;

comment on column public.items.is_rented is 'Marca o item como equipamento alugado pela empresa.';

create table if not exists public.equipment_rentals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  supplier text not null,
  contract_ref text,
  status text not null default 'ativo' check (status in ('ativo', 'encerrado')),
  responsibility_type text not null check (responsibility_type in ('employee', 'site', 'warehouse')),
  employee_id uuid references public.employees(id) on delete set null,
  work_site_id uuid references public.work_sites(id) on delete set null,
  quantity numeric not null default 1 check (quantity > 0),
  start_date date not null,
  expected_return_date date,
  monthly_cost numeric check (monthly_cost is null or monthly_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipment_rentals_supplier_len check (char_length(trim(supplier)) >= 2),
  constraint equipment_rentals_employee_required check (
    (responsibility_type = 'employee' and employee_id is not null and work_site_id is null)
    or (responsibility_type = 'site' and work_site_id is not null and employee_id is null)
    or (responsibility_type = 'warehouse' and employee_id is null and work_site_id is null)
  )
);

create index if not exists equipment_rentals_user_idx on public.equipment_rentals (user_id);
create index if not exists equipment_rentals_item_idx on public.equipment_rentals (item_id);
create index if not exists equipment_rentals_status_idx on public.equipment_rentals (status);

alter table public.equipment_rentals enable row level security;

drop policy if exists "equipment_rentals_select_own" on public.equipment_rentals;
create policy "equipment_rentals_select_own"
on public.equipment_rentals for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "equipment_rentals_insert_own" on public.equipment_rentals;
create policy "equipment_rentals_insert_own"
on public.equipment_rentals for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "equipment_rentals_update_own" on public.equipment_rentals;
create policy "equipment_rentals_update_own"
on public.equipment_rentals for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "equipment_rentals_delete_own" on public.equipment_rentals;
create policy "equipment_rentals_delete_own"
on public.equipment_rentals for delete to authenticated
using (auth.uid() = user_id);
