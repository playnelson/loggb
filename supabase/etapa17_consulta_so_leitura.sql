-- Etapa 17: cargo sem nenhuma permissão (ex.: "Consulta") é SÓ LEITURA.
-- Antes, marcar "todos os almoxarifados" (ou um almoxarifado) num cargo sem permissão
-- liberava gravar. Agora almoxarifado só limita ONDE quem tem permissão pode mexer.

-- 1) Quem pode gravar no workspace: ADM ou cargo com alguma permissão.
create or replace function public.current_workspace_can_write()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce((
    select a.is_adm or cardinality(a.permissions) > 0
      from public.current_member_access() a
  ), false);
$function$;

-- 2) Mexer em itens de uma categoria: ADM, ou cargo com permissão + almoxarifado da categoria.
create or replace function public.can_manage_category(p_category text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce((
    select a.is_adm or (cardinality(a.permissions) > 0 and (a.all_areas or exists (
      select 1
        from public.stock_area_members am
        join public.stock_areas sa on sa.id = am.area_id
       where am.organization_id = a.organization_id and am.user_id = a.user_id
         and exists (select 1 from unnest(sa.categories) c where upper(btrim(c)) = upper(btrim(p_category)))
    )))
    from public.current_member_access() a
  ), false);
$function$;

-- 3) Ao salvar o acesso: cargo sem permissão não guarda almoxarifados (consulta vê todos).
create or replace function public.set_member_access(
  p_org uuid, p_user uuid, p_is_adm boolean, p_cargo uuid default null::uuid,
  p_all_areas boolean default false, p_area_ids uuid[] default '{}'::uuid[],
  p_scope uuid[] default null::uuid[], p_expires_at timestamp with time zone default null::timestamp with time zone)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member public.organization_members%rowtype;
  v_scope uuid[];
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Só um ADM da organização pode fazer isso.' using errcode = '42501';
  end if;
  select * into v_member from public.organization_members
   where organization_id = p_org and user_id = p_user for update;
  if not found then
    raise exception 'Pessoa não encontrada nesta organização.' using errcode = 'P0002';
  end if;
  if v_member.role = 'dono' then
    if not coalesce(p_is_adm, false) then
      raise exception 'Quem criou a organização é sempre ADM.' using errcode = 'P0001';
    end if;
    return;
  end if;
  if p_user = auth.uid() and not coalesce(p_is_adm, false) then
    raise exception 'Você não pode tirar o seu próprio acesso de ADM. Peça a outro ADM.' using errcode = 'P0001';
  end if;

  if p_scope is not null then
    v_scope := array(
      select w.id from public.workspaces w
       where w.organization_id = p_org and w.archived_at is null and w.id = any (p_scope)
    );
    if cardinality(v_scope) = 0 then
      raise exception 'Escolha pelo menos um workspace.' using errcode = '22023';
    end if;
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'O prazo de acesso precisa ser no futuro.' using errcode = '22023';
  end if;

  if coalesce(p_is_adm, false) then
    update public.organization_members
       set role = 'admin', cargo_id = null, all_areas = false, workspace_scope = null, expires_at = p_expires_at
     where organization_id = p_org and user_id = p_user;
    delete from public.stock_area_members where organization_id = p_org and user_id = p_user;
    return;
  end if;

  if p_cargo is null or not exists (select 1 from public.organization_roles r where r.id = p_cargo and r.organization_id = p_org) then
    raise exception 'Escolha um cargo.' using errcode = '22023';
  end if;

  -- Cargo de consulta (sem permissão): sem almoxarifados.
  if (select cardinality(r.permissions) from public.organization_roles r where r.id = p_cargo) = 0 then
    p_all_areas := false;
    p_area_ids := '{}'::uuid[];
  end if;

  update public.organization_members
     set role = 'membro', cargo_id = p_cargo, all_areas = coalesce(p_all_areas, false),
         workspace_scope = v_scope, expires_at = p_expires_at
   where organization_id = p_org and user_id = p_user;

  delete from public.stock_area_members
   where organization_id = p_org and user_id = p_user
     and (coalesce(p_all_areas, false) or not (area_id = any (coalesce(p_area_ids, '{}'))));
  if not coalesce(p_all_areas, false) then
    insert into public.stock_area_members (organization_id, area_id, user_id)
    select p_org, sa.id, p_user
      from public.stock_areas sa
     where sa.organization_id = p_org and sa.id = any (coalesce(p_area_ids, '{}'))
    on conflict do nothing;
  end if;
end;
$function$;

-- 4) Corrige quem já está com cargo sem permissão e almoxarifado marcado.
update public.organization_members m
   set all_areas = false
  from public.organization_roles r
 where r.id = m.cargo_id and m.role = 'membro' and cardinality(r.permissions) = 0 and m.all_areas;

delete from public.stock_area_members am
 using public.organization_members m, public.organization_roles r
 where m.organization_id = am.organization_id and m.user_id = am.user_id
   and r.id = m.cargo_id and m.role = 'membro' and cardinality(r.permissions) = 0;

notify pgrst, 'reload schema';
