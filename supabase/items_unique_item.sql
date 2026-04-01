-- Optional improvement: mark an item as "item único" (requires TAG on movement).
-- Run this in Supabase SQL Editor (one-time).

alter table public.items
  add column if not exists unique_item boolean not null default false;

create index if not exists items_unique_item_idx on public.items (unique_item);

