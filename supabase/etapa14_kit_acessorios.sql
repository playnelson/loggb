-- Etapa 14
-- 1) Kit = item que é entregue junto com acessórios (carregador, bateria…).
--    Os acessórios não têm saldo próprio: são só a lista do que acompanha o item.
-- 2) CA do EPI informado na entrega (p_ca_number). O mesmo item (ex.: luva de vaqueta)
--    pode ter vários CAs sem virar vários itens. Sem CA na entrega, usa o CA do cadastro.

alter table public.items
  add column if not exists accessories text[];

comment on column public.items.accessories is 'Acessórios que acompanham o item (kit). Sem saldo próprio; saem e voltam junto.';

drop function if exists public.register_movement(uuid, text, numeric, uuid, uuid, text, numeric, numeric, numeric, boolean, text, text, text, uuid);

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
  p_batch_id uuid default null,
  p_ca_number text default null
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
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
  if char_length(coalesce(p_ca_number, '')) > 40 then
    raise exception 'CA muito longo (máximo 40 caracteres).' using errcode = '22023';
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
   where i.id = p_item_id
     for update;
  if not found then
    raise exception 'Item não encontrado.' using errcode = 'P0002';
  end if;
  if v_archived is not null then
    raise exception 'Este item está arquivado. Reative o item para movimentar.' using errcode = 'P0001';
  end if;
  -- CA informado na entrega vale mais que o CA do cadastro.
  v_ca := coalesce(nullif(trim(p_ca_number), ''), v_ca);

  if p_employee_id is not null and not exists (
    select 1 from public.employees e where e.id = p_employee_id
  ) then
    raise exception 'Colaborador não encontrado.' using errcode = 'P0002';
  end if;

  if p_work_site_id is not null and not exists (
    select 1 from public.work_sites w where w.id = p_work_site_id
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
$function$;

revoke all on function public.register_movement(uuid, text, numeric, uuid, uuid, text, numeric, numeric, numeric, boolean, text, text, text, uuid, text) from public, anon;
grant execute on function public.register_movement(uuid, text, numeric, uuid, uuid, text, numeric, numeric, numeric, boolean, text, text, text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
