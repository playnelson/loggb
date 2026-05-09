-- Módulo: controle de ordens de compra (OC) com itens e status de entrega.
-- Execute no SQL Editor do Supabase (uma vez). Idempotente na medida do possível.

-- Tabela principal (compatível com migrações antigas que já criaram purchase_orders)
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  oc_number text null,
  title text null,

  buyer_code text null,
  buyer_name text null,
  buyer_phone text null,

  vendor_name text null,
  vendor_phone text null,
  vendor_contact_name text null,

  store_name text null,
  delivery_deadline date null,
  request_date date null,
  approval_status text null,

  source_filename text null,
  source_pdf_path text null,
  notes text null,
  raw_extracted_text text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.purchase_orders
  add column if not exists buyer_code text,
  add column if not exists buyer_name text,
  add column if not exists buyer_phone text,
  add column if not exists vendor_name text,
  add column if not exists vendor_phone text,
  add column if not exists vendor_contact_name text,
  add column if not exists store_name text,
  add column if not exists delivery_deadline date,
  add column if not exists request_date date,
  add column if not exists approval_status text,
  add column if not exists source_filename text,
  add column if not exists source_pdf_path text,
  add column if not exists notes text,
  add column if not exists raw_extracted_text text;

-- Relaxa formato do número da OC (pedidos reais podem ter 4–6 dígitos ou zeros à esquerda)
alter table public.purchase_orders drop constraint if exists purchase_orders_oc_number_format;
alter table public.purchase_orders
  add constraint purchase_orders_oc_number_format
  check (oc_number is null or oc_number ~ '^[0-9]{1,12}$');

create index if not exists purchase_orders_user_created_idx
  on public.purchase_orders (user_id, created_at desc);

create index if not exists purchase_orders_user_oc_idx
  on public.purchase_orders (user_id, oc_number);

-- Itens da OC
create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  line_number int not null default 1,
  description text not null,
  quantity numeric null,
  unit text not null default 'un',
  unit_price numeric null,
  delivered boolean not null default false,
  delivered_at timestamptz null,
  inventory_item_id uuid null references public.items(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.purchase_order_items
  add column if not exists line_number int not null default 1,
  add column if not exists description text,
  add column if not exists quantity numeric,
  add column if not exists unit text,
  add column if not exists unit_price numeric,
  add column if not exists delivered boolean not null default false,
  add column if not exists delivered_at timestamptz,
  add column if not exists inventory_item_id uuid;

-- Garante unit (migração antiga purchase_order_items_unit.sql)
alter table public.purchase_order_items
  alter column unit set default 'un';

create index if not exists purchase_order_items_order_idx
  on public.purchase_order_items (purchase_order_id, line_number);

-- RLS
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

drop policy if exists "purchase_orders_select_own" on public.purchase_orders;
create policy "purchase_orders_select_own"
on public.purchase_orders for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "purchase_orders_insert_own" on public.purchase_orders;
create policy "purchase_orders_insert_own"
on public.purchase_orders for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "purchase_orders_update_own" on public.purchase_orders;
create policy "purchase_orders_update_own"
on public.purchase_orders for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "purchase_orders_delete_own" on public.purchase_orders;
create policy "purchase_orders_delete_own"
on public.purchase_orders for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "purchase_order_items_select_own" on public.purchase_order_items;
create policy "purchase_order_items_select_own"
on public.purchase_order_items for select to authenticated
using (
  exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_id and po.user_id = auth.uid()
  )
);

drop policy if exists "purchase_order_items_insert_own" on public.purchase_order_items;
create policy "purchase_order_items_insert_own"
on public.purchase_order_items for insert to authenticated
with check (
  exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_id and po.user_id = auth.uid()
  )
);

drop policy if exists "purchase_order_items_update_own" on public.purchase_order_items;
create policy "purchase_order_items_update_own"
on public.purchase_order_items for update to authenticated
using (
  exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_id and po.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_id and po.user_id = auth.uid()
  )
);

drop policy if exists "purchase_order_items_delete_own" on public.purchase_order_items;
create policy "purchase_order_items_delete_own"
on public.purchase_order_items for delete to authenticated
using (
  exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_id and po.user_id = auth.uid()
  )
);

comment on table public.purchase_orders is 'Ordens de compra importadas ou cadastradas manualmente.';
comment on column public.purchase_order_items.delivered is 'Marcado quando o item já foi recebido no canteiro/almoxarifado.';
