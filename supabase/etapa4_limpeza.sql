-- Etapa 4 — limpeza: remove tabelas de módulos que não existem mais no app.
-- Idempotente. Requer etapa3_recebimento_inventario.sql.
--
-- Removidas (nenhuma tela usa):
--   finance_accounts, finance_account_templates, finance_assets, finance_expenses,
--   finance_fuel_logs (módulo financeiro antigo), purchase_requests (requisições antigas),
--   dashboard_reminders (lembretes antigos da home), kanban_columns + purchase_orders.kanban_column_id
--   (quadro kanban antigo das OCs).
-- Sem CASCADE: se algo ainda depender dessas tabelas, a migração falha e nada é apagado.

drop table if exists public.finance_expenses;
drop table if exists public.finance_fuel_logs;
drop table if exists public.finance_assets;
drop table if exists public.finance_accounts;
drop table if exists public.finance_account_templates;
drop table if exists public.purchase_requests;
drop table if exists public.dashboard_reminders;

drop index if exists public.purchase_orders_kanban_column_idx;
alter table public.purchase_orders drop column if exists kanban_column_id;
drop table if exists public.kanban_columns;

create or replace function public.reset_my_account_data()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  t record;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  -- Ordem: quem referencia vem antes de quem é referenciado.
  -- (purchase_order_items sai junto com purchase_orders via ON DELETE CASCADE)
  for t in
    select * from (values
      (1,  'purchase_orders',         'user_id'),             -- antes de employees (FK RESTRICT)
      (2,  'equipment_rentals',       'user_id'),
      (3,  'rental_suppliers',        'user_id'),
      (4,  'inventory_count_lines',   'user_id'),             -- contagens antes de items
      (5,  'inventory_counts',        'user_id'),
      (6,  'movements',               'performed_by'),        -- antes de items/employees (FK sem cascade)
      (7,  'site_possession',         'user_id'),
      (8,  'possession',              'user_id'),
      (9,  'work_sites',              'user_id'),
      (10, 'items',                   'user_id'),
      (11, 'employees',               'user_id'),
      (12, 'item_categories',         'user_id'),
      (13, 'mural_notes',             'user_id')
    ) as x(ord, tbl, owner_col)
    order by ord
  loop
    if to_regclass('public.' || t.tbl) is null then
      continue;
    end if;
    execute format('delete from public.%I where %I = $1', t.tbl, t.owner_col) using v_uid;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(t.tbl, v_n);
  end loop;

  return v_counts;
end;
$$;

revoke all on function public.reset_my_account_data() from public, anon;
grant execute on function public.reset_my_account_data() to authenticated;


notify pgrst, 'reload schema';
