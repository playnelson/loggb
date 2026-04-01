-- Optional improvement: store TAG for "item único" movements.
-- Run this in Supabase SQL Editor (one-time).

alter table public.movements
  add column if not exists tag text;

create index if not exists movements_tag_idx on public.movements (tag);

