-- Kanban: colunas editáveis, título em pedidos.
-- Execute no SQL Editor do Supabase (uma vez).

-- Remover checagem rígida de estágio se existir (nomes variam entre projetos).
alter table public.purchase_orders drop constraint if exists purchase_orders_stage_check;

create table if not exists public.kanban_columns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  slug text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kanban_columns_title_len check (char_length(trim(title)) >= 1),
  constraint kanban_columns_slug_len check (char_length(trim(slug)) >= 1)
);

create unique index if not exists kanban_columns_user_slug_unique
  on public.kanban_columns (user_id, lower(slug));

create index if not exists kanban_columns_user_sort_idx
  on public.kanban_columns (user_id, sort_order);

alter table public.purchase_orders
  add column if not exists title text null,
  add column if not exists kanban_column_id uuid references public.kanban_columns(id) on delete set null;

alter table public.purchase_orders
  add column if not exists oc_number text null;

comment on column public.purchase_orders.oc_number is 'Ordem de compra (4 dígitos) gerada pelo setor de compras; identifica o pedido.';

alter table public.purchase_orders drop constraint if exists purchase_orders_oc_number_format;
alter table public.purchase_orders
  add constraint purchase_orders_oc_number_format
  check (oc_number is null or oc_number ~ '^[0-9]{4}$');

create index if not exists purchase_orders_kanban_column_idx on public.purchase_orders (kanban_column_id);

-- RLS kanban_columns
alter table public.kanban_columns enable row level security;

drop policy if exists "kanban_columns_select_own" on public.kanban_columns;
create policy "kanban_columns_select_own"
on public.kanban_columns for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "kanban_columns_insert_own" on public.kanban_columns;
create policy "kanban_columns_insert_own"
on public.kanban_columns for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "kanban_columns_update_own" on public.kanban_columns;
create policy "kanban_columns_update_own"
on public.kanban_columns for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "kanban_columns_delete_own" on public.kanban_columns;
create policy "kanban_columns_delete_own"
on public.kanban_columns for delete to authenticated
using (auth.uid() = user_id);
