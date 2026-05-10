-- Habilita recebimento parcial por item nas OCs
-- Seguro para rodar mais de uma vez (idempotente).

alter table public.purchase_order_items
  add column if not exists received_quantity numeric(14,4) not null default 0;

-- Garante consistência mínima para não receber negativo.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchase_order_items_received_quantity_non_negative'
  ) then
    alter table public.purchase_order_items
      add constraint purchase_order_items_received_quantity_non_negative
      check (received_quantity >= 0);
  end if;
end $$;

-- Preenche legados já entregues como totalmente recebidos (quando quantidade existir).
update public.purchase_order_items
set received_quantity = coalesce(quantity, 0)
where coalesce(delivered, false) = true
  and coalesce(received_quantity, 0) = 0;

comment on column public.purchase_order_items.received_quantity is
  'Quantidade já recebida do item (suporta recebimento parcial).';
