-- =============================================================================
-- Etapa 10: exclusão com aprovação
--
-- Colaborador, item, ordem de compra, aluguel e documento só são excluídos
-- por quem tem "Aprovar exclusões" (ADM e cargo Gestor). Os outros pedem a
-- exclusão, e o pedido fica aguardando na página Aprovações.
--
-- Ao aprovar:
--   colaborador com histórico -> fica "Desligado" (o histórico continua)
--   item com histórico        -> é arquivado
--   sem histórico             -> é apagado de vez
-- Tudo fica registrado: quem pediu, quem aprovou, quando e por quê.
-- =============================================================================

create table if not exists public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id()
    references public.workspaces(id) on delete cascade,
  entity text not null check (entity in ('colaborador', 'item', 'ordem_compra', 'aluguel', 'documento')),
  entity_id uuid not null,
  entity_label text not null check (char_length(entity_label) between 1 and 300),
  reason text check (reason is null or char_length(reason) <= 300),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado', 'cancelado')),
  result text check (result is null or result in ('apagado', 'arquivado')),
  requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300)
);
create unique index if not exists deletion_requests_one_pending
  on public.deletion_requests (entity, entity_id) where status = 'pendente';
create index if not exists deletion_requests_ws_idx
  on public.deletion_requests (workspace_id, status, requested_at desc);

alter table public.deletion_requests enable row level security;
drop policy if exists workspace_read on public.deletion_requests;
create policy workspace_read on public.deletion_requests
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));
-- Gravação só pelas funções abaixo.
grant select on public.deletion_requests to authenticated;

-- -----------------------------------------------------------------------------
-- 1) Liberação de exclusão aprovada (vale só dentro da função que executa)
-- -----------------------------------------------------------------------------
create or replace function public.deletion_approved()
returns boolean language sql stable set search_path = public as $$
  select coalesce(current_setting('app.deletion_approved', true), '') = 'on';
$$;

-- Os gatilhos de cargo/área deixam passar uma exclusão já aprovada.
create or replace function public.enforce_item_area()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.deletion_approved() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['is_rented', 'updated_at']) = (to_jsonb(old) - array['is_rented', 'updated_at']) then
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and not public.can_manage_category(old.category) then
    perform public.area_denied(old.category);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and not public.can_manage_category(new.category) then
    perform public.area_denied(new.category);
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.enforce_item_area_child()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cat text;
begin
  if auth.uid() is null or public.deletion_approved() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select i.category into v_cat from public.items i where i.id = old.item_id;
    if found and not public.can_manage_category(v_cat) then
      perform public.area_denied(v_cat);
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select i.category into v_cat from public.items i where i.id = new.item_id;
    if found and not public.can_manage_category(v_cat) then
      perform public.area_denied(v_cat);
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.enforce_module_permission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_perm text := tg_argv[0];
  v_label text := tg_argv[1];
begin
  if auth.uid() is null or public.deletion_approved() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if not public.current_member_can(v_perm) then
    raise exception 'Seu cargo não permite alterar %. Peça ao ADM.', v_label using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) Gatilho: excluir (ou arquivar item) exige aprovação
-- -----------------------------------------------------------------------------
create or replace function public.enforce_deletion_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.deletion_approved() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old; -- apagado em cascata
  end if;
  if tg_op = 'UPDATE' then
    -- Em itens, só arquivar conta como remover; o resto da edição segue normal.
    if not (old.archived_at is null and new.archived_at is not null) then
      return new;
    end if;
  end if;
  if not public.current_member_can('exclusoes_aprovar') then
    raise exception 'Excluir precisa de aprovação. Use "Pedir exclusão" e aguarde o ADM ou o gestor aprovar.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.enforce_deletion_approval() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['employees', 'purchase_orders', 'equipment_rentals', 'equipment_documents'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_delete_guard', t);
    execute format(
      'create trigger %I before delete on public.%I for each row execute function public.enforce_deletion_approval()',
      t || '_delete_guard', t);
  end loop;
end $$;
drop trigger if exists items_delete_guard on public.items;
create trigger items_delete_guard before delete or update of archived_at on public.items
  for each row execute function public.enforce_deletion_approval();

-- -----------------------------------------------------------------------------
-- 3) Nome do que vai ser excluído e se pode ser excluído
-- -----------------------------------------------------------------------------
create or replace function public.deletion_target(p_entity text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ws uuid := public.current_workspace_id();
  v_label text;
  v_block text;
  v_qty numeric;
begin
  if p_entity = 'colaborador' then
    select e.full_name into v_label from public.employees e where e.id = p_id and e.workspace_id = v_ws;
    select coalesce(sum(p.quantity), 0) into v_qty from public.possession p where p.employee_id = p_id and p.quantity > 0;
    if v_qty > 0 then
      v_block := 'Este colaborador ainda tem itens em posse. Registre a devolução antes de excluir.';
    end if;
  elsif p_entity = 'item' then
    select i.description || coalesce(' · ' || nullif(btrim(i.tag), ''), '') into v_label
      from public.items i where i.id = p_id and i.workspace_id = v_ws;
    select coalesce(sum(q), 0) into v_qty from (
      select p.quantity as q from public.possession p where p.item_id = p_id and p.quantity > 0
      union all
      select s.quantity from public.site_possession s where s.item_id = p_id and s.quantity > 0
    ) x;
    if v_qty > 0 then
      v_block := 'Este item ainda está com colaboradores ou em canteiros. Registre a devolução antes de excluir.';
    end if;
  elsif p_entity = 'ordem_compra' then
    select coalesce('OC ' || nullif(btrim(o.oc_number), ''), nullif(btrim(o.title), ''), 'Ordem de compra')
           || coalesce(' · ' || nullif(btrim(o.vendor_name), ''), '')
      into v_label from public.purchase_orders o where o.id = p_id and o.workspace_id = v_ws;
  elsif p_entity = 'aluguel' then
    select 'Aluguel: ' || coalesce(i.description, 'item') || coalesce(' · ' || nullif(btrim(r.supplier), ''), '')
           || coalesce(' · desde ' || to_char(r.start_date, 'DD/MM/YYYY'), '')
      into v_label
      from public.equipment_rentals r left join public.items i on i.id = r.item_id
     where r.id = p_id and r.workspace_id = v_ws;
  elsif p_entity = 'documento' then
    select d.file_name || coalesce(' · ' || i.description, '') into v_label
      from public.equipment_documents d left join public.items i on i.id = d.item_id
     where d.id = p_id and d.workspace_id = v_ws;
  else
    raise exception 'Tipo de exclusão inválido.' using errcode = '22023';
  end if;

  if v_label is null then
    raise exception 'Registro não encontrado neste workspace.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('label', left(v_label, 300), 'block', v_block);
end;
$$;
revoke all on function public.deletion_target(text, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) Executa a exclusão (só chamada pelas funções de aprovar/excluir)
-- -----------------------------------------------------------------------------
create or replace function public.perform_deletion(p_entity text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_target jsonb := public.deletion_target(p_entity, p_id);
  v_result text := 'apagado';
  v_path text;
begin
  if v_target->>'block' is not null then
    raise exception '%', v_target->>'block' using errcode = 'P0001';
  end if;

  perform set_config('app.deletion_approved', 'on', true);

  if p_entity = 'colaborador' then
    if exists (select 1 from public.movements m where m.employee_id = p_id)
       or exists (select 1 from public.purchase_orders o where o.requester_employee_id = p_id) then
      update public.employees set status = 'Desligado', updated_at = now() where id = p_id;
      v_result := 'arquivado';
    else
      delete from public.employees where id = p_id;
    end if;
  elsif p_entity = 'item' then
    if exists (select 1 from public.movements m where m.item_id = p_id)
       or exists (select 1 from public.equipment_rentals r where r.item_id = p_id) then
      update public.items set archived_at = now() where id = p_id;
      v_result := 'arquivado';
    else
      delete from public.items where id = p_id;
    end if;
  elsif p_entity = 'ordem_compra' then
    delete from public.purchase_orders where id = p_id;
  elsif p_entity = 'aluguel' then
    delete from public.equipment_rentals where id = p_id;
  elsif p_entity = 'documento' then
    delete from public.equipment_documents where id = p_id returning storage_path into v_path;
  end if;

  perform set_config('app.deletion_approved', 'off', true);
  return jsonb_build_object('result', v_result, 'storage_path', v_path, 'label', v_target->>'label');
end;
$$;
revoke all on function public.perform_deletion(text, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) Funções usadas pelo app
-- -----------------------------------------------------------------------------

-- Pedir exclusão (quem não pode excluir direto).
create or replace function public.request_deletion(p_entity text, p_id uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_target jsonb;
  v_id uuid;
  v_cat text;
  v_has_item boolean;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not public.current_workspace_can_write() then
    raise exception 'Seu acesso é só de consulta.' using errcode = '42501';
  end if;
  v_target := public.deletion_target(p_entity, p_id);
  if v_target->>'block' is not null then
    raise exception '%', v_target->>'block' using errcode = 'P0001';
  end if;
  -- Só pede exclusão de quem poderia mexer no registro.
  if p_entity = 'item' then
    select i.category into v_cat from public.items i where i.id = p_id;
    if not public.can_manage_category(v_cat) then
      perform public.area_denied(v_cat);
    end if;
  elsif p_entity = 'documento' then
    select i.category, d.item_id is not null into v_cat, v_has_item
      from public.equipment_documents d left join public.items i on i.id = d.item_id
     where d.id = p_id;
    if v_has_item and not public.can_manage_category(v_cat) then
      perform public.area_denied(v_cat);
    elsif not v_has_item and not public.current_member_can('colaboradores') then
      raise exception 'Seu cargo não permite alterar colaboradores. Peça ao ADM.' using errcode = '42501';
    end if;
  elsif not public.current_member_can(
          case p_entity when 'colaborador' then 'colaboradores' when 'ordem_compra' then 'compras' else 'alugueis' end) then
    raise exception 'Seu cargo não permite alterar %. Peça ao ADM.',
      case p_entity when 'colaborador' then 'colaboradores' when 'ordem_compra' then 'compras' else 'aluguéis' end
      using errcode = '42501';
  end if;
  if exists (select 1 from public.deletion_requests where entity = p_entity and entity_id = p_id and status = 'pendente') then
    raise exception 'Já existe um pedido de exclusão aguardando aprovação para este registro.' using errcode = 'P0001';
  end if;
  insert into public.deletion_requests (entity, entity_id, entity_label, reason)
  values (p_entity, p_id, v_target->>'label', nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Excluir agora (ADM e quem aprova). Fica registrado como aprovado.
create or replace function public.delete_now(p_entity text, p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_res jsonb;
begin
  if not public.current_member_can('exclusoes_aprovar') then
    raise exception 'Excluir precisa de aprovação. Use "Pedir exclusão".' using errcode = '42501';
  end if;
  v_res := public.perform_deletion(p_entity, p_id);
  -- Algum pedido pendente para o mesmo registro fica resolvido junto.
  update public.deletion_requests
     set status = 'aprovado', result = v_res->>'result', decided_by = auth.uid(), decided_at = now()
   where entity = p_entity and entity_id = p_id and status = 'pendente';
  if not found then
    insert into public.deletion_requests
      (entity, entity_id, entity_label, reason, status, result, decided_by, decided_at)
    values (p_entity, p_id, v_res->>'label', nullif(btrim(coalesce(p_reason, '')), ''),
            'aprovado', v_res->>'result', auth.uid(), now());
  end if;
  return v_res;
end;
$$;

-- Aprovar ou recusar um pedido.
create or replace function public.decide_deletion(p_request uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.deletion_requests%rowtype;
  v_res jsonb := '{}'::jsonb;
begin
  if not public.current_member_can('exclusoes_aprovar') then
    raise exception 'Só o ADM ou quem tem "Aprovar exclusões" pode decidir.' using errcode = '42501';
  end if;
  select * into r from public.deletion_requests
   where id = p_request and workspace_id = public.current_workspace_id()
   for update;
  if not found then
    raise exception 'Pedido não encontrado neste workspace.' using errcode = 'P0002';
  end if;
  if r.status <> 'pendente' then
    raise exception 'Este pedido já foi resolvido.' using errcode = 'P0001';
  end if;

  if p_approve then
    v_res := public.perform_deletion(r.entity, r.entity_id);
    update public.deletion_requests
       set status = 'aprovado', result = v_res->>'result', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = r.id;
  else
    update public.deletion_requests
       set status = 'recusado', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = r.id;
  end if;
  return v_res;
end;
$$;

-- Quem pediu pode desistir.
create or replace function public.cancel_deletion(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.deletion_requests
     set status = 'cancelado', decided_by = auth.uid(), decided_at = now()
   where id = p_request and status = 'pendente'
     and workspace_id = public.current_workspace_id()
     and (requested_by = auth.uid() or public.current_member_can('exclusoes_aprovar'));
  if not found then
    raise exception 'Pedido não encontrado ou já resolvido.' using errcode = 'P0002';
  end if;
end;
$$;

-- Lista com o e-mail de quem pediu e de quem decidiu (workspace atual).
create or replace function public.list_deletion_requests(p_limit int default 200)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.ord, x.requested_at desc), '[]'::jsonb)
    from (
      select r.id, r.entity, r.entity_id, r.entity_label, r.reason, r.status, r.result,
             r.requested_at, r.decided_at, r.decision_note,
             r.requested_by = auth.uid() as mine,
             ru.email as requested_by_email, du.email as decided_by_email,
             case when r.status = 'pendente' then 0 else 1 end as ord
        from public.deletion_requests r
        left join auth.users ru on ru.id = r.requested_by
        left join auth.users du on du.id = r.decided_by
       where r.workspace_id = public.current_workspace_id()
         and public.current_workspace_id() is not null
       order by case when r.status = 'pendente' then 0 else 1 end, r.requested_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) x;
$$;

revoke all on function public.deletion_approved() from public, anon;
revoke all on function public.request_deletion(text, uuid, text) from public, anon;
revoke all on function public.delete_now(text, uuid, text) from public, anon;
revoke all on function public.decide_deletion(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_deletion(uuid) from public, anon;
revoke all on function public.list_deletion_requests(int) from public, anon;
grant execute on function public.deletion_approved() to authenticated;
grant execute on function public.request_deletion(text, uuid, text) to authenticated;
grant execute on function public.delete_now(text, uuid, text) to authenticated;
grant execute on function public.decide_deletion(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_deletion(uuid) to authenticated;
grant execute on function public.list_deletion_requests(int) to authenticated;
