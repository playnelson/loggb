-- Execute no SQL Editor se o app reclamar de colunas ausentes em purchase_orders.
-- Idempotente.
-- Também remove obrigatoriedade de requester_employee_id para manter
-- o módulo de OC desacoplado de employees.

alter table public.purchase_orders
  add column if not exists notes text,
  add column if not exists vendor_contact_name text,
  add column if not exists vendor_name text,
  add column if not exists delivery_deadline date,
  add column if not exists source_filename text,
  add column if not exists title text,
  add column if not exists oc_number text;

-- Desacopla OC do módulo de colaboradores quando coluna legado existir.
alter table public.purchase_orders
  alter column requester_employee_id drop not null;
