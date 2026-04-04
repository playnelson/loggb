-- Liga cada linha de pedido ao item do almoxarifado (cadastro antecipado, estoque 0 até a entrega).
-- Execute no SQL Editor do Supabase (uma vez).

alter table public.purchase_order_items
  add column if not exists inventory_item_id uuid null references public.items(id) on delete set null;

create index if not exists purchase_order_items_inventory_item_idx
  on public.purchase_order_items (inventory_item_id);

comment on column public.purchase_order_items.inventory_item_id is 'Item em items criado/vinculado automaticamente pelo nome do produto no pedido.';
