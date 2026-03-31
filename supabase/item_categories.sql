-- Run this in Supabase SQL Editor (one-time).
-- Creates per-user item categories with one locked default ("EPI").
--
-- IMPORTANT: This table is independent from `items`.
-- Deleting a category here will NOT delete items; items keep `items.category` as text.

create table if not exists public.item_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_categories_name_len check (char_length(name) between 2 and 40)
);

create unique index if not exists item_categories_user_name_unique
  on public.item_categories (user_id, lower(name));

alter table public.item_categories enable row level security;

-- RLS: user can manage only their categories
drop policy if exists "item_categories_select_own" on public.item_categories;
create policy "item_categories_select_own"
on public.item_categories
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "item_categories_insert_own" on public.item_categories;
create policy "item_categories_insert_own"
on public.item_categories
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "item_categories_update_own" on public.item_categories;
create policy "item_categories_update_own"
on public.item_categories
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "item_categories_delete_own" on public.item_categories;
create policy "item_categories_delete_own"
on public.item_categories
for delete
to authenticated
using (auth.uid() = user_id);

-- Seed defaults for existing users (optional):
-- insert into public.item_categories (user_id, name, locked)
-- select id, 'EPI', true from auth.users
-- on conflict do nothing;
