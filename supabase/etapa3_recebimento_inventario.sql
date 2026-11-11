-- Etapa 3 — recebimento de pedido entra no estoque + inventário (contagem).
-- Idempotente. Requer etapa1_integridade.sql e etapa2_epi_recibo.sql.
--
-- 1) Motivo novo "inventario" (ajustes feitos ao concluir uma contagem).
-- 2) purchase_order_items: stocked_quantity (quanto do recebido já entrou no estoque) e
--    stock_skip (linha que não vai para o estoque: serviço, frete…).
--    Linhas antigas: stocked_quantity = received_quantity (o que já foi recebido antes desta
--    versão NÃO é lançado de novo no estoque).
-- 3) receive_po_item: grava o recebimento e lança a diferença no estoque, numa transação.
-- 4) inventory_counts / inventory_count_lines + funções para iniciar, contar e concluir.
-- 5) "Zerar conta" passa a apagar as contagens.

-- 1) Motivo "inventario" ----------------------------------------------------
alter table public.movements drop constraint if exists movements_reason_check;
alter table public.movements add constraint movements_reason_check
  check (reason in ('entrada', 'saida', 'devolucao', 'ajuste', 'descarte', 'saldo_inicial', 'importacao', 'inventario'));

create or replace function public.register_movement(
  p_item_id uuid,
  p_type text,
  p_quantity numeric,
  p_employee_id uuid default null,
  p_work_site_id uuid default null,
  p_tag text default null,
  p_stock_delta numeric default 0,
  p_possession_delta numeric default 0,
  p_site_delta numeric default 0,
  p_possession_clamp boolean default false,
  p_reason text default null,
  p_note text default null,
  p_document text default null,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_stock numeric;
  v_archived timestamptz;
  v_ca text;
  v_pos numeric;
  v_site numeric;
  v_reason text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if p_type is null or p_type not in ('IN', 'OUT') then
    raise exception 'Tipo de movimentação inválido.' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A quantidade deve ser maior que zero.' using errcode = '22023';
  end if;
  if coalesce(p_possession_delta, 0) <> 0 and p_employee_id is null then
    raise exception 'Colaborador obrigatório para alterar a carteira.' using errcode = '22023';
  end if;
  if coalesce(p_site_delta, 0) <> 0 and p_work_site_id is null then
    raise exception 'Local obrigatório para alterar o saldo do local.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'Observação muito longa (máximo 500 caracteres).' using errcode = '22023';
  end if;
  if char_length(coalesce(p_document, '')) > 120 then
    raise exception 'Documento muito longo (máximo 120 caracteres).' using errcode = '22023';
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), case
    when p_type = 'OUT' and (p_employee_id is not null or p_work_site_id is not null) then 'saida'
    when p_type = 'OUT' then 'ajuste'
    when upper(coalesce(p_tag, '')) like '%DESCARTE%' then 'descarte'
    when p_employee_id is not null or p_work_site_id is not null then 'devolucao'
    else 'entrada'
  end);
  if v_reason not in ('entrada', 'saida', 'devolucao', 'ajuste', 'descarte', 'saldo_inicial', 'importacao', 'inventario') then
    raise exception 'Motivo de movimentação inválido.' using errcode = '22023';
  end if;

  select coalesce(i.quantity_current, 0), i.archived_at, nullif(trim(i.ca_number), '')
    into v_stock, v_archived, v_ca
    from public.items i
   where i.id = p_item_id and i.user_id = v_uid
     for update;
  if not found then
    raise exception 'Item não encontrado.' using errcode = 'P0002';
  end if;
  if v_archived is not null then
    raise exception 'Este item está arquivado. Reative o item para movimentar.' using errcode = 'P0001';
  end if;

  if p_employee_id is not null and not exists (
    select 1 from public.employees e where e.id = p_employee_id and e.user_id = v_uid
  ) then
    raise exception 'Colaborador não encontrado.' using errcode = 'P0002';
  end if;

  if p_work_site_id is not null and not exists (
    select 1 from public.work_sites w where w.id = p_work_site_id and w.user_id = v_uid
  ) then
    raise exception 'Canteiro/sede não encontrado.' using errcode = 'P0002';
  end if;

  execute format(
    'insert into public.movements
       (item_id, employee_id, work_site_id, quantity, type, performed_by, tag, reason, note, document, batch_id, ca_number)
     values ($1, $2, $3, $4, %L, $5, $6, $7, $8, $9, $10, $11)
     returning id',
    p_type
  )
  into v_id
  using p_item_id, p_employee_id, p_work_site_id, p_quantity, v_uid, nullif(trim(p_tag), ''), v_reason,
        nullif(trim(p_note), ''), nullif(trim(p_document), ''), p_batch_id, v_ca;

  if coalesce(p_stock_delta, 0) <> 0 then
    if v_stock + p_stock_delta < 0 then
      raise exception 'Saldo insuficiente em estoque (disponível: %).', v_stock using errcode = 'P0001';
    end if;
    v_stock := v_stock + p_stock_delta;
    update public.items set quantity_current = v_stock where id = p_item_id;
  end if;

  if coalesce(p_possession_delta, 0) <> 0 then
    select p.quantity into v_pos
      from public.possession p
     where p.employee_id = p_employee_id and p.item_id = p_item_id
       for update;
    v_pos := coalesce(v_pos, 0) + p_possession_delta;

    if v_pos < 0 then
      if p_possession_clamp then
        v_pos := 0;
      else
        raise exception 'Esse colaborador não tem essa quantidade na carteira para devolver.' using errcode = 'P0001';
      end if;
    end if;

    if v_pos = 0 then
      delete from public.possession where employee_id = p_employee_id and item_id = p_item_id;
    else
      insert into public.possession (employee_id, item_id, quantity, user_id)
      values (p_employee_id, p_item_id, v_pos, v_uid)
      on conflict (employee_id, item_id) do update set quantity = excluded.quantity;
    end if;
  end if;

  if coalesce(p_site_delta, 0) <> 0 then
    select s.quantity into v_site
      from public.site_possession s
     where s.site_id = p_work_site_id and s.item_id = p_item_id
       for update;
    v_site := coalesce(v_site, 0) + p_site_delta;

    if v_site < 0 then
      raise exception 'Esse local não tem essa quantidade registrada para devolver ao almoxarifado.' using errcode = 'P0001';
    end if;

    if v_site = 0 then
      delete from public.site_possession where site_id = p_work_site_id and item_id = p_item_id;
    else
      insert into public.site_possession (site_id, item_id, quantity, user_id)
      values (p_work_site_id, p_item_id, v_site, v_uid)
      on conflict (site_id, item_id) do update set quantity = excluded.quantity;
    end if;
  end if;

  return jsonb_build_object(
    'movement_id', v_id,
    'quantity_current', v_stock,
    'possession_quantity', v_pos,
    'site_quantity', v_site,
    'reason', v_reason
  );
end;
$$;

revoke all on function public.register_movement(uuid, text, numeric, uuid, uuid, text, numeric, numeric, numeric, boolean, text, text, text, uuid) from public, anon;
grant execute on function public.register_movement(uuid, text, numeric, uuid, uuid, text, numeric, numeric, numeric, boolean, text, text, text, uuid) to authenticated;

-- 2) Recebimento de pedido -> estoque ---------------------------------------
alter table public.purchase_order_items add column if not exists stocked_quantity numeric(14,3);
update public.purchase_order_items
   set stocked_quantity = coalesce(received_quantity, 0)
 where stocked_quantity is null;
alter table public.purchase_order_items
  alter column stocked_quantity set default 0,
  alter column stocked_quantity set not null;
alter table public.purchase_order_items add column if not exists stock_skip boolean not null default false;

-- 3) receive_po_item ----------------------------------------------------------
-- Define o TOTAL recebido da linha. Se a linha está ligada a um item do almoxarifado (e não está
-- marcada como "não vai para o estoque"), a diferença entre o recebido e o que já entrou no estoque
-- vira movimentação: positiva = Entrada; negativa = Ajuste (estorno).
create or replace function public.receive_po_item(
  p_line_id uuid,
  p_received numeric,
  p_item_id uuid default null,      -- liga/troca o item do almoxarifado
  p_stock_skip boolean default null, -- true: linha não vai para o estoque
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_line record;
  v_item uuid;
  v_skip boolean;
  v_delta numeric := 0;
  v_stocked numeric;
  v_full boolean;
  v_doc text;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if p_received is null or p_received < 0 then
    raise exception 'Quantidade recebida inválida.' using errcode = '22023';
  end if;

  select li.id, li.line_number, li.quantity, li.inventory_item_id, li.stock_skip, li.stocked_quantity,
         li.delivered_at, po.oc_number, po.user_id as owner
    into v_line
    from public.purchase_order_items li
    join public.purchase_orders po on po.id = li.purchase_order_id
   where li.id = p_line_id
     for update of li;
  if not found or v_line.owner <> v_uid then
    raise exception 'Linha do pedido não encontrada.' using errcode = 'P0002';
  end if;

  v_item := coalesce(p_item_id, v_line.inventory_item_id);
  v_skip := coalesce(p_stock_skip, v_line.stock_skip, false);
  v_stocked := coalesce(v_line.stocked_quantity, 0);

  if v_item is not null and not exists (
    select 1 from public.items i where i.id = v_item and i.user_id = v_uid
  ) then
    raise exception 'Item do almoxarifado não encontrado.' using errcode = 'P0002';
  end if;

  if v_item is not null and not v_skip then
    v_delta := round(p_received - v_stocked, 3);
    if v_delta <> 0 then
      v_doc := 'OC ' || coalesce(nullif(trim(v_line.oc_number), ''), 's/n');
      perform public.register_movement(
        p_item_id => v_item,
        p_type => case when v_delta > 0 then 'IN' else 'OUT' end,
        p_quantity => abs(v_delta),
        p_stock_delta => v_delta,
        p_reason => case when v_delta > 0 then 'entrada' else 'ajuste' end,
        p_document => v_doc,
        p_note => case when v_delta > 0
                    then 'Recebimento do pedido, linha ' || v_line.line_number
                    else 'Estorno de recebimento do pedido, linha ' || v_line.line_number end,
        p_batch_id => p_batch_id
      );
    end if;
    v_stocked := p_received;
  end if;

  v_full := case when v_line.quantity is null then p_received > 0 else p_received >= v_line.quantity end;

  update public.purchase_order_items
     set received_quantity = p_received,
         delivered = v_full,
         delivered_at = case when v_full then coalesce(v_line.delivered_at, now()) else null end,
         inventory_item_id = v_item,
         stock_skip = v_skip,
         stocked_quantity = v_stocked
   where id = p_line_id;

  return jsonb_build_object(
    'received_quantity', p_received,
    'stocked_quantity', v_stocked,
    'stock_delta', v_delta,
    'inventory_item_id', v_item,
    'stock_skip', v_skip,
    'delivered', v_full
  );
end;
$$;

revoke all on function public.receive_po_item(uuid, numeric, uuid, boolean, uuid) from public, anon;
grant execute on function public.receive_po_item(uuid, numeric, uuid, boolean, uuid) to authenticated;

-- 4) Inventário (contagem) ----------------------------------------------------
create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'aberta',
  blind boolean not null default false,
  filter_category text,
  filter_location text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  adjusted_lines int,
  constraint inventory_counts_title_len check (char_length(trim(title)) between 1 and 120),
  constraint inventory_counts_status_check check (status in ('aberta', 'concluida', 'cancelada'))
);

create table if not exists public.inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_counts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  system_qty numeric(14,3),           -- saldo do sistema no momento em que foi contado
  counted_qty numeric(14,3),
  counted_at timestamptz,
  note text,
  constraint inventory_count_lines_unique unique (count_id, item_id),
  constraint inventory_count_lines_counted_nonneg check (counted_qty is null or counted_qty >= 0),
  constraint inventory_count_lines_note_len check (note is null or char_length(note) <= 200)
);

create index if not exists inventory_counts_user_created_idx on public.inventory_counts (user_id, created_at desc);
create index if not exists inventory_count_lines_count_idx on public.inventory_count_lines (count_id);
create index if not exists inventory_count_lines_item_idx on public.inventory_count_lines (item_id);

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;

drop policy if exists inventory_counts_own on public.inventory_counts;
create policy inventory_counts_own on public.inventory_counts for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists inventory_count_lines_own on public.inventory_count_lines;
create policy inventory_count_lines_own on public.inventory_count_lines for all to authenticated
  using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (select 1 from public.inventory_counts c where c.id = count_id and c.user_id = auth.uid())
  );

-- Inicia uma contagem com os itens ativos (filtro opcional por categoria e local).
create or replace function public.start_inventory_count(
  p_title text,
  p_category text default null,
  p_location text default null,
  p_blind boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_n int;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  insert into public.inventory_counts (user_id, title, blind, filter_category, filter_location)
  values (v_uid, trim(p_title), coalesce(p_blind, false), nullif(trim(p_category), ''), nullif(trim(p_location), ''))
  returning id into v_id;

  insert into public.inventory_count_lines (count_id, user_id, item_id)
  select v_id, v_uid, i.id
    from public.items i
   where i.user_id = v_uid
     and i.archived_at is null
     and (nullif(trim(p_category), '') is null or i.category = trim(p_category))
     and (nullif(trim(p_location), '') is null or i.location ilike '%' || trim(p_location) || '%');
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nenhum item ativo encontrado com esses filtros.' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

-- Registra (ou limpa, com null) a quantidade contada de uma linha.
-- Guarda o saldo do sistema NESTE momento: o ajuste final é contado − saldo da hora da contagem,
-- então movimentações feitas depois da contagem não são apagadas pelo ajuste.
create or replace function public.record_inventory_count(
  p_line_id uuid,
  p_counted numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_line record;
  v_stock numeric;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if p_counted is not null and p_counted < 0 then
    raise exception 'A quantidade contada não pode ser negativa.' using errcode = '22023';
  end if;

  select l.id, l.item_id, c.status
    into v_line
    from public.inventory_count_lines l
    join public.inventory_counts c on c.id = l.count_id
   where l.id = p_line_id and l.user_id = v_uid and c.user_id = v_uid
     for update of l;
  if not found then
    raise exception 'Linha da contagem não encontrada.' using errcode = 'P0002';
  end if;
  if v_line.status <> 'aberta' then
    raise exception 'Esta contagem já foi encerrada.' using errcode = 'P0001';
  end if;

  select coalesce(quantity_current, 0) into v_stock from public.items where id = v_line.item_id and user_id = v_uid;

  update public.inventory_count_lines
     set counted_qty = round(p_counted, 3),
         system_qty = case when p_counted is null then null else v_stock end,
         counted_at = case when p_counted is null then null else now() end,
         note = nullif(trim(coalesce(p_note, note, '')), '')
   where id = p_line_id;

  return jsonb_build_object('system_qty', case when p_counted is null then null else v_stock end, 'counted_qty', p_counted);
end;
$$;

-- Conclui a contagem: lança "Inventário" para cada diferença (contado − saldo da hora da contagem).
create or replace function public.close_inventory_count(p_count_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count record;
  r record;
  v_delta numeric;
  v_stock numeric;
  v_adjusted int := 0;
  v_clamped int := 0;
  v_skipped int := 0;
  v_uncounted int := 0;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  select * into v_count from public.inventory_counts where id = p_count_id and user_id = v_uid for update;
  if not found then
    raise exception 'Contagem não encontrada.' using errcode = 'P0002';
  end if;
  if v_count.status <> 'aberta' then
    raise exception 'Esta contagem já foi encerrada.' using errcode = 'P0001';
  end if;

  for r in
    select l.id, l.item_id, l.system_qty, l.counted_qty, i.archived_at, coalesce(i.quantity_current, 0) as stock_now
      from public.inventory_count_lines l
      join public.items i on i.id = l.item_id
     where l.count_id = p_count_id
     order by i.description
  loop
    if r.counted_qty is null then
      v_uncounted := v_uncounted + 1;
      continue;
    end if;
    v_delta := round(r.counted_qty - coalesce(r.system_qty, 0), 3);
    if v_delta = 0 then
      continue;
    end if;
    if r.archived_at is not null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_stock := r.stock_now;
    if v_stock + v_delta < 0 then
      -- O saldo caiu depois da contagem: não deixa negativo.
      v_delta := -v_stock;
      v_clamped := v_clamped + 1;
      if v_delta = 0 then
        continue;
      end if;
    end if;
    perform public.register_movement(
      p_item_id => r.item_id,
      p_type => case when v_delta > 0 then 'IN' else 'OUT' end,
      p_quantity => abs(v_delta),
      p_stock_delta => v_delta,
      p_reason => 'inventario',
      p_document => left('Inventário: ' || v_count.title, 120),
      p_note => 'Contagem: sistema ' ||
                replace(trim(trailing '.' from trim(trailing '0' from round(coalesce(r.system_qty, 0), 3)::text)), '.', ',') ||
                ', contado ' ||
                replace(trim(trailing '.' from trim(trailing '0' from round(r.counted_qty, 3)::text)), '.', ','),
      p_batch_id => p_count_id
    );
    v_adjusted := v_adjusted + 1;
  end loop;

  update public.inventory_counts
     set status = 'concluida', closed_at = now(), adjusted_lines = v_adjusted
   where id = p_count_id;

  return jsonb_build_object(
    'adjusted', v_adjusted,
    'clamped', v_clamped,
    'skipped_archived', v_skipped,
    'uncounted', v_uncounted
  );
end;
$$;

revoke all on function public.start_inventory_count(text, text, text, boolean) from public, anon;
grant execute on function public.start_inventory_count(text, text, text, boolean) to authenticated;
revoke all on function public.record_inventory_count(uuid, numeric, text) from public, anon;
grant execute on function public.record_inventory_count(uuid, numeric, text) to authenticated;
revoke all on function public.close_inventory_count(uuid) from public, anon;
grant execute on function public.close_inventory_count(uuid) to authenticated;

-- 5) "Zerar conta" inclui as contagens -------------------------------------
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

  for t in
    select * from (values
      (1,  'purchase_orders',           'user_id'),
      (2,  'purchase_requests',         'user_id'),
      (3,  'equipment_rentals',         'user_id'),
      (4,  'rental_suppliers',          'user_id'),
      (5,  'inventory_count_lines',     'user_id'),
      (6,  'inventory_counts',          'user_id'),
      (7,  'movements',                 'performed_by'),
      (8,  'site_possession',           'user_id'),
      (9,  'possession',                'user_id'),
      (10, 'work_sites',                'user_id'),
      (11, 'items',                     'user_id'),
      (12, 'employees',                 'user_id'),
      (13, 'item_categories',           'user_id'),
      (14, 'kanban_columns',            'user_id'),
      (15, 'mural_notes',               'user_id'),
      (16, 'dashboard_reminders',       'user_id'),
      (17, 'finance_expenses',          'user_id'),
      (18, 'finance_fuel_logs',         'user_id'),
      (19, 'finance_assets',            'user_id'),
      (20, 'finance_accounts',          'user_id'),
      (21, 'finance_account_templates', 'user_id')
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
