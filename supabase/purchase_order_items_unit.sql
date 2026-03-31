-- Run this in Supabase SQL Editor (one-time).
-- Adds unit field to purchase order items (kg, L, un, par, etc.)

alter table public.purchase_order_items
  add column if not exists unit text not null default 'un';

-- Optional: basic sanity constraint (short label)
alter table public.purchase_order_items
  add constraint purchase_order_items_unit_len check (char_length(unit) between 1 and 10);

