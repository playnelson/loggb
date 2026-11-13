-- Etapa 18: módulo de Abastecimentos (por workspace/obra). Por enquanto SÓ ADM vê e mexe.
-- Fluxo: emite a autorização (sem litros) -> depois lança o faturamento (litros, preço, total).
-- Tanque próprio: entradas (compras) e saídas (abastecimentos com origem = tanque); saldo = entradas - saídas.

-- Quem pode usar o módulo (hoje: só ADM). Para liberar a outros cargos depois, basta mudar aqui.
create or replace function public.fuel_can_access()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce((select a.is_adm from public.current_member_access() a), false);
$function$;

-- 1) Frota: veículos, máquinas e equipamentos que abastecem.
create table if not exists public.fuel_vehicles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  code text,
  description text not null check (btrim(description) <> ''),
  plate text,
  brand text,
  group_name text,
  meter_type text not null default 'km' check (meter_type in ('km', 'horas', 'nenhum')),
  fuel_type text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create unique index if not exists fuel_vehicles_code_uq
  on public.fuel_vehicles (workspace_id, upper(btrim(code)))
  where code is not null and btrim(code) <> '';

-- 2) Postos (fornecedores) e tanques próprios.
create table if not exists public.fuel_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  kind text not null default 'posto' check (kind in ('posto', 'tanque')),
  fuel_type text,
  capacity numeric check (capacity is null or capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, workspace_id)
);

-- 3) Entradas no tanque (compra de combustível).
create table if not exists public.fuel_tank_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  tank_id uuid not null,
  entry_date date not null default current_date,
  liters numeric not null check (liters > 0),
  unit_price numeric check (unit_price is null or unit_price >= 0),
  total numeric check (total is null or total >= 0),
  supplier text,
  invoice text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (tank_id, workspace_id) references public.fuel_sources (id, workspace_id) on delete restrict
);
create index if not exists fuel_tank_entries_tank_idx on public.fuel_tank_entries (tank_id);

-- 4) Abastecimentos (autorizações). Nº de controle sequencial por workspace.
create table if not exists public.fuel_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  control_no integer not null,
  log_date date not null default current_date,
  source_id uuid not null,
  vehicle_id uuid not null,
  requester_employee_id uuid references public.employees(id) on delete set null,
  requester_name text,
  authorized_by text,
  fuel_type text not null check (btrim(fuel_type) <> ''),
  meter_type text not null default 'km' check (meter_type in ('km', 'horas', 'nenhum')),
  meter_reading numeric check (meter_reading is null or meter_reading >= 0),
  liters numeric check (liters is null or liters > 0),
  unit_price numeric check (unit_price is null or unit_price >= 0),
  total numeric check (total is null or total >= 0),
  status text not null default 'autorizado' check (status in ('autorizado', 'faturado', 'cancelado')),
  invoice text,
  billed_at timestamptz,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (workspace_id, control_no),
  foreign key (source_id, workspace_id) references public.fuel_sources (id, workspace_id) on delete restrict,
  foreign key (vehicle_id, workspace_id) references public.fuel_vehicles (id, workspace_id) on delete restrict,
  check (status <> 'faturado' or liters is not null)
);
create index if not exists fuel_logs_ws_date_idx on public.fuel_logs (workspace_id, log_date desc);
create index if not exists fuel_logs_vehicle_idx on public.fuel_logs (vehicle_id);
create index if not exists fuel_logs_source_idx on public.fuel_logs (source_id);

-- Nº de controle: sempre o próximo do workspace (o app não escolhe).
create or replace function public.fuel_logs_next_control()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform pg_advisory_xact_lock(hashtext('fuel_logs:' || new.workspace_id::text));
  select coalesce(max(control_no), 0) + 1 into new.control_no
    from public.fuel_logs where workspace_id = new.workspace_id;
  return new;
end;
$function$;

drop trigger if exists fuel_logs_control_no on public.fuel_logs;
create trigger fuel_logs_control_no before insert on public.fuel_logs
  for each row execute function public.fuel_logs_next_control();

-- Nº de controle não muda depois de emitido.
create or replace function public.fuel_logs_keep_control()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.control_no := old.control_no;
  new.workspace_id := old.workspace_id;
  return new;
end;
$function$;

drop trigger if exists fuel_logs_keep_control on public.fuel_logs;
create trigger fuel_logs_keep_control before update on public.fuel_logs
  for each row execute function public.fuel_logs_keep_control();

-- RLS: só o workspace atual e só quem pode usar o módulo.
do $$
declare t text;
begin
  foreach t in array array['fuel_vehicles', 'fuel_sources', 'fuel_tank_entries', 'fuel_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists fuel_all on public.%I', t);
    execute format($p$create policy fuel_all on public.%I for all to authenticated
      using (workspace_id = (select public.current_workspace_id()) and (select public.fuel_can_access()))
      with check (workspace_id = (select public.current_workspace_id()) and (select public.fuel_can_access()))$p$, t);
  end loop;
end $$;

grant select, insert, update, delete
  on public.fuel_vehicles, public.fuel_sources, public.fuel_tank_entries, public.fuel_logs to authenticated;

revoke all on function public.fuel_logs_next_control() from public, anon, authenticated;

notify pgrst, 'reload schema';
