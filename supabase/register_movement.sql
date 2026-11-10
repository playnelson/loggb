-- Movimentação atômica de estoque.
-- Grava a movimentação + saldo do almoxarifado + carteira do colaborador + saldo no local
-- numa única transação: ou tudo é gravado, ou nada é.
-- Também trava a linha do item (FOR UPDATE), então duas movimentações simultâneas do mesmo
-- item são processadas uma depois da outra, sem perder baixa.
--
-- Execute no SQL Editor do Supabase ANTES de publicar a versão do app que usa esta função.
-- Pode ser executado mais de uma vez (idempotente).

-- Pré-requisitos: colunas usadas pela função.
alter table public.movements add column if not exists tag text;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'movements' and column_name = 'work_site_id'
  ) then
    raise exception 'A coluna movements.work_site_id não existe. Execute supabase/work_sites.sql primeiro.';
  end if;
end $$;

create or replace function public.register_movement(
  p_item_id uuid,
  p_type text,
  p_quantity numeric,
  p_employee_id uuid default null,
  p_work_site_id uuid default null,
  p_tag text default null,
  p_stock_delta numeric default 0,       -- variação do saldo do almoxarifado (items.quantity_current)
  p_possession_delta numeric default 0,  -- variação da carteira do colaborador (possession)
  p_site_delta numeric default 0,        -- variação do saldo no canteiro/sede (site_possession)
  p_possession_clamp boolean default false -- true: carteira insuficiente zera em vez de dar erro
)
returns jsonb
language plpgsql
security invoker  -- roda com as permissões (e RLS) do usuário logado
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_stock numeric;
  v_pos numeric;
  v_site numeric;
begin
  -- Validações básicas -------------------------------------------------------
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

  -- Trava o item (serializa movimentações do mesmo item) e confere o dono -----
  select coalesce(i.quantity_current, 0)
    into v_stock
    from public.items i
   where i.id = p_item_id and i.user_id = v_uid
     for update;
  if not found then
    raise exception 'Item não encontrado.' using errcode = 'P0002';
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

  -- 1) Movimentação ----------------------------------------------------------
  -- `type` entra como literal (%L) para funcionar tanto se a coluna for text quanto enum.
  execute format(
    'insert into public.movements (item_id, employee_id, work_site_id, quantity, type, performed_by, tag)
     values ($1, $2, $3, $4, %L, $5, $6)',
    p_type
  )
  using p_item_id, p_employee_id, p_work_site_id, p_quantity, v_uid, nullif(trim(p_tag), '');

  -- 2) Saldo do almoxarifado -------------------------------------------------
  if coalesce(p_stock_delta, 0) <> 0 then
    if v_stock + p_stock_delta < 0 then
      raise exception 'Saldo insuficiente em estoque (disponível: %).', v_stock using errcode = 'P0001';
    end if;
    v_stock := v_stock + p_stock_delta;
    update public.items set quantity_current = v_stock where id = p_item_id;
  end if;

  -- 3) Carteira do colaborador -----------------------------------------------
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

  -- 4) Saldo no canteiro/sede ------------------------------------------------
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
    'quantity_current', v_stock,
    'possession_quantity', v_pos,
    'site_quantity', v_site
  );
end;
$$;

revoke all on function public.register_movement(uuid, text, numeric, uuid, uuid, text, numeric, numeric, numeric, boolean) from public, anon;
grant execute on function public.register_movement(uuid, text, numeric, uuid, uuid, text, numeric, numeric, numeric, boolean) to authenticated;

-- Faz o PostgREST (API do Supabase) enxergar a função nova imediatamente.
notify pgrst, 'reload schema';
