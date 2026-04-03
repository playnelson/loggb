-- Sedes de trabalho e canteiros: cadastro, responsável (funcionário) e estoque no local.
-- Execute no SQL Editor do Supabase (uma vez).

create table if not exists public.work_sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('canteiro', 'sede')),
  responsible_employee_id uuid references public.employees(id) on delete set null,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_sites_name_len check (char_length(trim(name)) >= 2)
);

create index if not exists work_sites_user_idx on public.work_sites (user_id);
create index if not exists work_sites_user_active_idx on public.work_sites (user_id, active);

-- Saldo de materiais não consumíveis por sede/canteiro (espelha a ideia de carteira do colaborador).
create table if not exists public.site_possession (
  site_id uuid not null references public.work_sites(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  quantity numeric not null default 0 check (quantity >= 0),
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (site_id, item_id)
);

create index if not exists site_possession_user_idx on public.site_possession (user_id);

alter table public.movements
  add column if not exists work_site_id uuid references public.work_sites(id) on delete set null;

create index if not exists movements_work_site_idx on public.movements (work_site_id);

-- RLS
alter table public.work_sites enable row level security;
alter table public.site_possession enable row level security;

drop policy if exists "work_sites_select_own" on public.work_sites;
create policy "work_sites_select_own"
on public.work_sites for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "work_sites_insert_own" on public.work_sites;
create policy "work_sites_insert_own"
on public.work_sites for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "work_sites_update_own" on public.work_sites;
create policy "work_sites_update_own"
on public.work_sites for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "work_sites_delete_own" on public.work_sites;
create policy "work_sites_delete_own"
on public.work_sites for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "site_possession_select_own" on public.site_possession;
create policy "site_possession_select_own"
on public.site_possession for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "site_possession_insert_own" on public.site_possession;
create policy "site_possession_insert_own"
on public.site_possession for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "site_possession_update_own" on public.site_possession;
create policy "site_possession_update_own"
on public.site_possession for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "site_possession_delete_own" on public.site_possession;
create policy "site_possession_delete_own"
on public.site_possession for delete to authenticated
using (auth.uid() = user_id);

-- Se movements já tiver RLS, pode ser necessário permitir work_site_id em políticas existentes.
