-- Etapa 1 — integridade dos números do almoxarifado.
-- Idempotente: pode ser executado mais de uma vez.
--
-- 1) Quantidades com casas decimais (kg, m, litros…). Antes eram inteiras e 2,5 virava 3.
-- 2) Motivo de cada movimentação (entrada, saída, devolução, ajuste, descarte, saldo inicial,
--    importação) — antes tudo que não era saída virava "entrada".
-- 3) Itens arquivados (archived_at) em vez de apagar o item junto com o histórico.
-- 4) CPF único por conta (antes era único no banco inteiro, entre contas diferentes).
-- 5) Índices para as consultas mais usadas.
-- 6) register_movement grava o motivo e recusa item arquivado.
-- 7) Remove funções antigas que alteravam saldo sem registrar movimentação.

-- 1) Decimais ---------------------------------------------------------------
alter table public.items
  alter column quantity_current type numeric(14,3) using quantity_current::numeric,
  alter column quantity_min type numeric(14,3) using quantity_min::numeric;
alter table public.movements
  alter column quantity type numeric(14,3) using quantity::numeric;
alter table public.possession
  alter column quantity type numeric(14,3) using quantity::numeric;

-- 2) Motivo -----------------------------------------------------------------
alter table public.movements add column if not exists reason text;

update public.movements set reason = case
    when type = 'OUT' and (employee_id is not null or work_site_id is not null) then 'saida'
    when type = 'OUT' then 'ajuste'
    when upper(coalesce(tag, '')) like '%DESCARTE%' then 'descarte'
    when employee_id is not null or work_site_id is not null then 'devolucao'
    else 'entrada'
  end
where reason is null;

alter table public.movements drop constraint if exists movements_reason_check;
alter table public.movements add constraint movements_reason_check
  check (reason in ('entrada', 'saida', 'devolucao', 'ajuste', 'descarte', 'saldo_inicial', 'importacao'));

-- 3) Arquivar itens ---------------------------------------------------------
alter table public.items add column if not exists archived_at timestamptz;

-- 4) CPF único por conta ----------------------------------------------------
alter table public.employees drop constraint if exists employees_cpf_key;
drop index if exists public.employees_cpf_key;
create unique index if not exists employees_user_cpf_key
  on public.employees (user_id, cpf)
  where cpf is not null and cpf <> '';

-- 5) Índices ----------------------------------------------------------------
create index if not exists movements_item_created_idx on public.movements (item_id, created_at desc);
create index if not exists movements_employee_created_idx on public.movements (employee_id, created_at desc);
create index if not exists movements_performed_created_idx on public.movements (performed_by, created_at desc);
create index if not exists possession_item_idx on public.possession (item_id);
create index if not exists site_possession_item_idx on public.site_possession (item_id);
create index if not exists items_user_description_idx on public.items (user_id, description);
create index if not exists employees_user_name_idx on public.employees (user_id, full_name);

-- 6) register_movement com motivo -------------------------------------------
drop function if exists public.register_movement(uuid, text, numeric, uuid, uuid, text, numeric, numeric, numeric, boolean);

create or replace function public.register_movement(
  p_item_id uuid,
  p_type text,
  p_quantity numeric,
  p_employee_id uuid default null,
  p_work_site_id uuid default null,
  p_tag text default null,
  p_stock_delta numeric default 0,        -- variação do saldo do almoxarifado (items.quantity_current)
  p_possession_delta numeric default 0,   -- variação da carteira do colaborador (possession)
  p_site_delta numeric default 0,         -- variação do saldo no canteiro/sede (site_possession)
  p_possession_clamp boolean default false, -- true: carteira insuficiente zera em vez de dar erro
  p_reason text default null              -- motivo; se nulo, é deduzido do tipo e da contraparte
)
returns jsonb
language plpgsql
security invoker  -- roda com as permissões (e RLS) do usuário logado
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_stock numeric;
  v_archived timestamptz;
  v_pos numeric;
  v_site numeric;
  v_reason text;
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

  v_reason := coalesce(nullif(trim(p_reason), ''), case
    when p_type = 'OUT' and (p_employee_id is not null or p_work_site_id is not null) then 'saida'
    when p_type = 'OUT' then 'ajuste'
    when upper(coalesce(p_tag, '')) like '%DESCARTE%' then 'descarte'
    when p_employee_id is not null or p_work_site_id is not null then 'devolucao'
    else 'entrada'
  end);
  if v_reason not in ('entrada', 'saida', 'devolucao', 'ajuste', 'descarte', 'saldo_inicial', 'importacao') then
    raise exception 'Motivo de movimentação inválido.' using errcode = '22023';
  end if;

  -- Trava o item (serializa movimentações do mesmo item) e confere o dono
  select coalesce(i.quantity_current, 0), i.archived_at
    into v_stock, v_archived
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

  -- 1) Movimentação
  execute format(
    'insert into public.movements (item_id, employee_id, work_site_id, quantity, type, performed_by, tag, reason)
     values ($1, $2, $3, $4, %L, $5, $6, $7)',
    p_type
  )
  using p_item_id, p_employee_id, p_work_site_id, p_quantity, v_uid, nullif(trim(p_tag), ''), v_reason;

  -- 2) Saldo do almoxarifado
  if coalesce(p_stock_delta, 0) <> 0 then
    if v_stock + p_stock_delta < 0 then
      raise exception 'Saldo insuficiente em estoque (disponível: %).', v_stock using errcode = 'P0001';
    end if;
    v_stock := v_stock + p_stock_delta;
    update public.items set quantity_current = v_stock where id = p_item_id;
  end if;

  -- 3) Carteira do colaborador
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

  -- 4) Saldo no canteiro/sede
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
    'site_quantity', v_site,
    'reason', v_reason
  );
end;
$$;

revoke all on function public.register_movement(uuid, text, numeric, uuid, uuid, text, numeric, numeric, numeric, boolean, text) from public, anon;
grant execute on function public.register_movement(uuid, text, numeric, uuid, uuid, text, numeric, numeric, numeric, boolean, text) to authenticated;

-- 7) Funções antigas que mudavam saldo sem histórico (não usadas pelo app) --
drop function if exists public.increment_stock(uuid, integer);
drop function if exists public.decrement_stock(uuid, integer);
drop function if exists public.update_stock(uuid, integer);

notify pgrst, 'reload schema';
