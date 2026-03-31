-- Run this in Supabase SQL Editor (one-time).
-- Creates purchase requests ("Pedidos") with stages and drafts.
--
-- Notes:
-- - Deleting a request does NOT delete any inventory items (independent table).
-- - This table is per-user (`user_id`) similar to other tables in this app.

create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  requester text null,
  vendor text null,
  product_name text null,
  product_url text null,
  product_price text null,

  stage text not null default 'Rascunho',
  notes text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint purchase_requests_stage_check check (
    stage in ('Rascunho', 'Cotando', 'Aprovado', 'Comprado', 'Recebido', 'Cancelado')
  )
);

create index if not exists purchase_requests_user_id_idx
  on public.purchase_requests (user_id, created_at desc);

alter table public.purchase_requests enable row level security;

-- RLS: user can manage only their own requests
drop policy if exists "purchase_requests_select_own" on public.purchase_requests;
create policy "purchase_requests_select_own"
on public.purchase_requests
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "purchase_requests_insert_own" on public.purchase_requests;
create policy "purchase_requests_insert_own"
on public.purchase_requests
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "purchase_requests_update_own" on public.purchase_requests;
create policy "purchase_requests_update_own"
on public.purchase_requests
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "purchase_requests_delete_own" on public.purchase_requests;
create policy "purchase_requests_delete_own"
on public.purchase_requests
for delete
to authenticated
using (auth.uid() = user_id);
