-- Execute no SQL Editor se o app reclamar de colunas ausentes em purchase_orders.
-- Idempotente.

alter table public.purchase_orders
  add column if not exists notes text,
  add column if not exists vendor_contact_name text,
  add column if not exists vendor_name text,
  add column if not exists delivery_deadline date,
  add column if not exists source_filename text,
  add column if not exists title text,
  add column if not exists oc_number text;
