-- =============================================================================
-- Etapa 12: cada pessoa com acesso ligada à ficha de um funcionário
--
-- O convite escolhe o funcionário (da lista de Colaboradores). Quando a
-- pessoa aceita, o acesso dela fica ligado àquela ficha. Na aba Pessoas
-- o ADM vê e troca o funcionário de cada um.
-- Uma ficha só pode estar ligada a uma pessoa por organização.
-- =============================================================================

alter table public.organization_members
  add column if not exists employee_id uuid references public.employees(id) on delete set null;
alter table public.organization_invites
  add column if not exists employee_id uuid references public.employees(id) on delete set null;
create unique index if not exists organization_members_employee_key
  on public.organization_members (organization_id, employee_id) where employee_id is not null;

-- O funcionário precisa ser de um workspace da mesma organização.
create or replace function public.check_org_employee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.employee_id is not null and not exists (
    select 1 from public.employees e join public.workspaces w on w.id = e.workspace_id
     where e.id = new.employee_id and w.organization_id = new.organization_id
  ) then
    raise exception 'Este funcionário não é desta organização.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.check_org_employee() from public, anon, authenticated;

drop trigger if exists organization_members_employee_check on public.organization_members;
create trigger organization_members_employee_check
  before insert or update of employee_id on public.organization_members
  for each row execute function public.check_org_employee();
drop trigger if exists organization_invites_employee_check on public.organization_invites;
create trigger organization_invites_employee_check
  before insert or update of employee_id on public.organization_invites
  for each row execute function public.check_org_employee();

-- Funcionários de todos os workspaces da organização (para o ADM escolher).
create or replace function public.organization_employees(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Só um ADM da organização pode ver isso.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id,
      'full_name', e.full_name,
      'role', e.role,
      'status', e.status,
      'workspace_id', e.workspace_id,
      'workspace_name', w.name,
      'linked_user_id', m.user_id,
      'linked_email', u.email
    ) order by e.full_name)
      from public.employees e
      join public.workspaces w on w.id = e.workspace_id
      left join public.organization_members m on m.organization_id = p_org and m.employee_id = e.id
      left join auth.users u on u.id = m.user_id
     where w.organization_id = p_org
  ), '[]'::jsonb);
end;
$$;

-- Liga (ou desliga, com nulo) a pessoa a uma ficha de funcionário.
create or replace function public.set_member_employee(p_org uuid, p_user uuid, p_employee uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Só um ADM da organização pode fazer isso.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_members where organization_id = p_org and user_id = p_user) then
    raise exception 'Pessoa não encontrada nesta organização.' using errcode = 'P0002';
  end if;
  if p_employee is not null then
    update public.organization_members set employee_id = null
     where organization_id = p_org and employee_id = p_employee and user_id <> p_user;
  end if;
  update public.organization_members set employee_id = p_employee
   where organization_id = p_org and user_id = p_user;
end;
$$;

revoke all on function public.organization_employees(uuid) from public, anon;
revoke all on function public.set_member_employee(uuid, uuid, uuid) from public, anon;
grant execute on function public.organization_employees(uuid) to authenticated;
grant execute on function public.set_member_employee(uuid, uuid, uuid) to authenticated;

-- Convite, lista de pessoas e aceite passam a levar o funcionário.
create or replace function public.organization_people(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Só um ADM da organização pode ver isso.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'email', u.email,
      'role', m.role,
      'is_adm', m.role in ('dono', 'admin'),
      'is_creator', m.role = 'dono',
      'cargo_id', m.cargo_id,
      'all_areas', m.all_areas,
      'area_ids', coalesce((select jsonb_agg(am.area_id) from public.stock_area_members am
                             where am.organization_id = m.organization_id and am.user_id = m.user_id), '[]'::jsonb),
      'workspace_scope', to_jsonb(m.workspace_scope),
      'expires_at', m.expires_at,
      'created_at', m.created_at,
      'employee_id', m.employee_id,
      'employee_name', e.full_name,
      'employee_role', e.role,
      'employee_workspace', ew.name
    ) order by case m.role when 'dono' then 0 when 'admin' then 1 else 2 end, u.email)
      from public.organization_members m
      join auth.users u on u.id = m.user_id
      left join public.employees e on e.id = m.employee_id
      left join public.workspaces ew on ew.id = e.workspace_id
     where m.organization_id = p_org
  ), '[]'::jsonb);
end;
$$;

create or replace function public.invite_info(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  inv public.organization_invites%rowtype;
  v_org record;
  v_status text;
  v_cargo public.organization_roles%rowtype;
  v_areas jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  select * into inv from public.organization_invites where token = p_token;
  if not found then
    return jsonb_build_object('status', 'invalido');
  end if;
  select o.name, o.logo_data into v_org from public.organizations o where o.id = inv.organization_id;
  select * into v_cargo from public.organization_roles where id = public.invite_cargo_id(inv);
  select coalesce(jsonb_agg(sa.name order by sa.name), '[]'::jsonb) into v_areas
    from public.stock_areas sa
   where sa.organization_id = inv.organization_id and sa.id = any (inv.area_ids);

  v_status := case
    when inv.revoked_at is not null then 'cancelado'
    when inv.invite_expires_at <= now() then 'expirado'
    when inv.uses >= inv.max_uses then 'usado'
    else 'valido'
  end;

  return jsonb_build_object(
    'status', v_status,
    'role', inv.role,
    'cargo_name', v_cargo.name,
    'read_only', cardinality(coalesce(v_cargo.permissions, '{}')) = 0 and not inv.all_areas and cardinality(inv.area_ids) = 0,
    'all_areas', inv.all_areas,
    'areas', v_areas,
    'organization_name', v_org.name,
    'logo_data', v_org.logo_data,
    'label', inv.label,
    'employee_name', (select e.full_name from public.employees e where e.id = inv.employee_id),
    'access_expires_at', inv.access_expires_at,
    'invite_expires_at', inv.invite_expires_at,
    'all_workspaces', inv.workspace_scope is null,
    'workspaces', coalesce((
      select jsonb_agg(w.name order by w.name)
        from public.workspaces w
       where w.organization_id = inv.organization_id
         and w.archived_at is null
         and (inv.workspace_scope is null or w.id = any (inv.workspace_scope))
    ), '[]'::jsonb),
    'already_member', exists (
      select 1 from public.organization_members m
       where m.organization_id = inv.organization_id and m.user_id = auth.uid()
         and m.role in ('dono', 'admin')
    )
  );
end;
$$;

create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  inv public.organization_invites%rowtype;
  v_member public.organization_members%rowtype;
  v_has_member boolean;
  v_valid boolean;
  v_scope uuid[];
  v_cargo uuid;
  v_new_perms int;
  v_old_perms int;
  v_ws uuid;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  select * into inv from public.organization_invites where token = p_token for update;
  if not found then
    raise exception 'Convite não encontrado.' using errcode = 'P0002';
  end if;

  select * into v_member from public.organization_members
   where organization_id = inv.organization_id and user_id = v_uid
   for update;
  v_has_member := found;
  v_valid := v_has_member and (v_member.expires_at is null or v_member.expires_at > now());

  if v_valid and v_member.role in ('dono', 'admin') then
    v_scope := null; -- ADM já vê tudo; o convite não é gasto
  else
    if inv.revoked_at is not null then
      raise exception 'Este convite foi cancelado.' using errcode = 'P0001';
    end if;
    if inv.invite_expires_at <= now() then
      raise exception 'Este convite expirou. Peça um novo link.' using errcode = 'P0001';
    end if;
    if inv.uses >= inv.max_uses then
      raise exception 'Este convite já foi usado. Peça um novo link.' using errcode = 'P0001';
    end if;
    if inv.access_expires_at is not null and inv.access_expires_at <= now() then
      raise exception 'O prazo de acesso deste convite já terminou.' using errcode = 'P0001';
    end if;

    if inv.workspace_scope is not null then
      v_scope := array(
        select w.id from public.workspaces w
         where w.organization_id = inv.organization_id and w.archived_at is null
           and w.id = any (inv.workspace_scope)
      );
      if cardinality(v_scope) = 0 then
        raise exception 'O workspace deste convite não está mais disponível.' using errcode = 'P0001';
      end if;
    end if;

    v_cargo := public.invite_cargo_id(inv);
    if v_cargo is null then
      raise exception 'O cargo deste convite não existe mais. Peça um novo link.' using errcode = 'P0001';
    end if;

    if v_valid then
      select cardinality(permissions) into v_new_perms from public.organization_roles where id = v_cargo;
      select coalesce(cardinality(permissions), -1) into v_old_perms from public.organization_roles where id = v_member.cargo_id;
      update public.organization_members
         set role = 'membro',
             cargo_id = case when v_member.cargo_id is null or coalesce(v_new_perms, 0) > coalesce(v_old_perms, -1)
                             then v_cargo else v_member.cargo_id end,
             all_areas = v_member.all_areas or inv.all_areas,
             workspace_scope = case
               when v_member.workspace_scope is null or v_scope is null then null
               else array(select distinct x from unnest(v_member.workspace_scope || v_scope) as x)
             end,
             expires_at = case
               when v_member.expires_at is null or inv.access_expires_at is null then null
               else greatest(v_member.expires_at, inv.access_expires_at)
             end
       where organization_id = inv.organization_id and user_id = v_uid;
      v_scope := case
        when v_member.workspace_scope is null or v_scope is null then null
        else array(select distinct x from unnest(v_member.workspace_scope || v_scope) as x)
      end;
    elsif v_has_member then
      -- Acesso vencido: vale só o convite novo.
      update public.organization_members
         set role = 'membro', cargo_id = v_cargo, all_areas = inv.all_areas,
             workspace_scope = v_scope, expires_at = inv.access_expires_at
       where organization_id = inv.organization_id and user_id = v_uid;
      delete from public.stock_area_members where organization_id = inv.organization_id and user_id = v_uid;
    else
      insert into public.organization_members (organization_id, user_id, role, cargo_id, all_areas, expires_at, workspace_scope)
      values (inv.organization_id, v_uid, 'membro', v_cargo, inv.all_areas, inv.access_expires_at, v_scope);
    end if;

    insert into public.stock_area_members (organization_id, area_id, user_id)
    select inv.organization_id, sa.id, v_uid
      from public.stock_areas sa
     where sa.organization_id = inv.organization_id and sa.id = any (inv.area_ids)
    on conflict do nothing;

    -- Etapa 12: liga a pessoa à ficha do funcionário escolhida no convite.
    if inv.employee_id is not null then
      update public.organization_members set employee_id = null
       where organization_id = inv.organization_id and employee_id = inv.employee_id and user_id <> v_uid;
      update public.organization_members set employee_id = inv.employee_id
       where organization_id = inv.organization_id and user_id = v_uid;
    end if;

    update public.organization_invites set uses = uses + 1 where id = inv.id;
  end if;

  select w.id into v_ws
    from public.workspaces w
   where w.organization_id = inv.organization_id and w.archived_at is null
     and (v_scope is null or w.id = any (v_scope))
   order by w.name
   limit 1;
  if v_ws is null then
    raise exception 'Nenhum workspace ativo disponível neste convite.' using errcode = 'P0001';
  end if;

  insert into public.user_workspace_state (user_id, workspace_id, updated_at)
  values (v_uid, v_ws, now())
  on conflict (user_id) do update set workspace_id = excluded.workspace_id, updated_at = now();

  return v_ws;
end;
$$;
