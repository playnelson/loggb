-- Gestão de equipamentos alugados (integrado ao almoxarifado).
-- Reexecute este script no SQL Editor para aplicar evoluções.

alter table public.items
  add column if not exists is_rented boolean not null default false;
alter table public.items
  add column if not exists calibration_due_date date;
alter table public.items
  add column if not exists expiration_date date;

comment on column public.items.is_rented is 'Marca o item como equipamento alugado pela empresa.';
comment on column public.items.calibration_due_date is 'Próxima data prevista de aferição/calibração do equipamento.';
comment on column public.items.expiration_date is 'Data de validade do equipamento/material controlado.';

create table if not exists public.rental_suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_suppliers_name_len check (char_length(trim(name)) >= 2)
);

create index if not exists rental_suppliers_user_idx on public.rental_suppliers (user_id);
create index if not exists rental_suppliers_user_active_idx on public.rental_suppliers (user_id, active);

create table if not exists public.equipment_rentals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  supplier text not null,
  supplier_id uuid references public.rental_suppliers(id) on delete set null,
  contract_ref text,
  status text not null default 'ativo' check (status in ('ativo', 'encerrado')),
  responsibility_type text not null default 'employee' check (responsibility_type in ('employee', 'site', 'warehouse')),
  employee_id uuid references public.employees(id) on delete set null,
  work_site_id uuid references public.work_sites(id) on delete set null,
  quantity numeric not null default 1 check (quantity > 0),
  start_date date not null,
  expected_return_date date,
  monthly_cost numeric check (monthly_cost is null or monthly_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.equipment_rentals
  add column if not exists supplier_id uuid references public.rental_suppliers(id) on delete set null;

alter table public.equipment_rentals
  add column if not exists responsibility_type text not null default 'employee';

alter table public.equipment_rentals
  add column if not exists work_site_id uuid references public.work_sites(id) on delete set null;

alter table public.equipment_rentals
  drop constraint if exists equipment_rentals_supplier_len;
alter table public.equipment_rentals
  add constraint equipment_rentals_supplier_len check (char_length(trim(supplier)) >= 2);

alter table public.equipment_rentals
  drop constraint if exists equipment_rentals_employee_required;
alter table public.equipment_rentals
  add constraint equipment_rentals_employee_required check (
    (responsibility_type = 'employee' and employee_id is not null and work_site_id is null)
    or (responsibility_type = 'site' and work_site_id is not null and employee_id is null)
    or (responsibility_type = 'warehouse' and employee_id is null and work_site_id is null)
  );

create index if not exists equipment_rentals_user_idx on public.equipment_rentals (user_id);
create index if not exists equipment_rentals_item_idx on public.equipment_rentals (item_id);
create index if not exists equipment_rentals_status_idx on public.equipment_rentals (status);
create index if not exists equipment_rentals_supplier_idx on public.equipment_rentals (supplier_id);

create or replace function public.enforce_rental_employee_possession()
returns trigger
language plpgsql
as $$
declare
  has_possession boolean;
begin
  if new.status = 'ativo' then
    if new.responsibility_type <> 'employee' then
      raise exception 'Aluguel ativo deve ter responsibility_type = employee.';
    end if;
    if new.employee_id is null then
      raise exception 'Aluguel ativo exige employee_id.';
    end if;
    select exists (
      select 1
      from public.possession p
      where p.user_id = new.user_id
        and p.item_id = new.item_id
        and p.employee_id = new.employee_id
        and p.quantity > 0
    ) into has_possession;
    if not has_possession then
      raise exception 'Responsável deve ser colaborador que está com o item na carteira.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_rental_employee_possession on public.equipment_rentals;
create trigger trg_enforce_rental_employee_possession
before insert or update on public.equipment_rentals
for each row execute function public.enforce_rental_employee_possession();

alter table public.rental_suppliers enable row level security;
alter table public.equipment_rentals enable row level security;

drop policy if exists "rental_suppliers_select_own" on public.rental_suppliers;
create policy "rental_suppliers_select_own"
on public.rental_suppliers for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "rental_suppliers_insert_own" on public.rental_suppliers;
create policy "rental_suppliers_insert_own"
on public.rental_suppliers for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "rental_suppliers_update_own" on public.rental_suppliers;
create policy "rental_suppliers_update_own"
on public.rental_suppliers for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "rental_suppliers_delete_own" on public.rental_suppliers;
create policy "rental_suppliers_delete_own"
on public.rental_suppliers for delete to authenticated
using (auth.uid() = user_id);

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
