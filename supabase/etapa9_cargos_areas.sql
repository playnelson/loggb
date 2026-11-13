-- =============================================================================
-- Etapa 9: cargos e áreas do estoque
--
-- Cargo  = o que a pessoa pode fazer (colaboradores, compras, aluguéis...).
-- Área   = parte do estoque que a pessoa gerencia (ex.: EPIs = categoria EPI).
--          Cada área pode ter várias pessoas. Fora das suas áreas a pessoa
--          vê o estoque, mas não movimenta nem edita.
-- ADM    = papel 'dono' (quem criou) ou 'admin'. Pode tudo, em todas as áreas.
--
-- O banco confere tudo com gatilhos (mensagens claras em português),
-- então não dá para burlar pelo app.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Cargos (editáveis pelo ADM)
-- -----------------------------------------------------------------------------
create table if not exists public.organization_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (description is null or char_length(description) <= 200),
  permissions text[] not null default '{}'
    check (permissions <@ array['colaboradores', 'compras', 'alugueis', 'cadastros', 'inventario', 'mural', 'exclusoes_aprovar']::text[]),
  system_key text check (system_key is null or system_key in ('almoxarife', 'tecnico_seguranca', 'gestor', 'consulta')),
  sort int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index if not exists organization_roles_name_uq
  on public.organization_roles (organization_id, lower(btrim(name)));
create unique index if not exists organization_roles_system_uq
  on public.organization_roles (organization_id, system_key) where system_key is not null;

alter table public.organization_roles enable row level security;
drop policy if exists organization_roles_select on public.organization_roles;
create policy organization_roles_select on public.organization_roles
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists organization_roles_insert on public.organization_roles;
create policy organization_roles_insert on public.organization_roles
  for insert to authenticated with check (public.is_org_admin(organization_id));
drop policy if exists organization_roles_update on public.organization_roles;
create policy organization_roles_update on public.organization_roles
  for update to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
drop policy if exists organization_roles_delete on public.organization_roles;
create policy organization_roles_delete on public.organization_roles
  for delete to authenticated using (public.is_org_admin(organization_id));

-- Cargos que toda organização recebe (podem ser editados ou apagados depois).
create or replace function public.create_default_roles(p_org uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.organization_roles (organization_id, name, description, permissions, system_key, sort)
  values
    (p_org, 'Almoxarife', 'Cuida do almoxarifado: colaboradores, compras, aluguéis, cadastros e inventário.',
       array['colaboradores', 'compras', 'alugueis', 'cadastros', 'inventario', 'mural'], 'almoxarife', 10),
    (p_org, 'Técnico de segurança', 'Cadastra colaboradores e entrega/devolve os itens das áreas dele (ex.: EPIs).',
       array['colaboradores', 'mural'], 'tecnico_seguranca', 20),
    (p_org, 'Gestor', 'Faz tudo o que o almoxarife faz e aprova pedidos de exclusão.',
       array['colaboradores', 'compras', 'alugueis', 'cadastros', 'inventario', 'mural', 'exclusoes_aprovar'], 'gestor', 30),
    (p_org, 'Consulta', 'Só consulta e baixa planilhas e documentos. Não altera nada.',
       array[]::text[], 'consulta', 40)
  on conflict do nothing;
$$;
revoke all on function public.create_default_roles(uuid) from public, anon, authenticated;

create or replace function public.organizations_default_roles_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.create_default_roles(new.id);
  return new;
end;
$$;
drop trigger if exists organizations_default_roles on public.organizations;
create trigger organizations_default_roles after insert on public.organizations
  for each row execute function public.organizations_default_roles_trg();

do $$
declare r record;
begin
  for r in select id from public.organizations loop
    perform public.create_default_roles(r.id);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2) Cargo e "todas as áreas" em cada pessoa da organização
-- -----------------------------------------------------------------------------
alter table public.organization_members add column if not exists cargo_id uuid;
alter table public.organization_members add column if not exists all_areas boolean not null default false;
alter table public.organization_members drop constraint if exists organization_members_cargo_fkey;
alter table public.organization_members
  add constraint organization_members_cargo_fkey foreign key (organization_id, cargo_id)
  references public.organization_roles (organization_id, id);

-- Quem já era membro vira Almoxarife em todas as áreas (nada muda para ele).
-- Quem era "gestor" (só leitura) vira membro com cargo Consulta.
update public.organization_members m
   set cargo_id = r.id, all_areas = true
  from public.organization_roles r
 where m.role = 'membro' and m.cargo_id is null
   and r.organization_id = m.organization_id and r.system_key = 'almoxarife';
update public.organization_members m
   set role = 'membro', cargo_id = r.id, all_areas = false
  from public.organization_roles r
 where m.role = 'gestor'
   and r.organization_id = m.organization_id and r.system_key = 'consulta';

-- -----------------------------------------------------------------------------
-- 3) Áreas do estoque e quem gerencia cada uma
-- -----------------------------------------------------------------------------
create table if not exists public.stock_areas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  categories text[] not null default '{}' check (cardinality(categories) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index if not exists stock_areas_name_uq
  on public.stock_areas (organization_id, lower(btrim(name)));

create table if not exists public.stock_area_members (
  organization_id uuid not null,
  area_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (area_id, user_id),
  foreign key (organization_id, area_id) references public.stock_areas (organization_id, id) on delete cascade,
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index if not exists stock_area_members_user_idx on public.stock_area_members (organization_id, user_id);

alter table public.stock_areas enable row level security;
alter table public.stock_area_members enable row level security;

drop policy if exists stock_areas_select on public.stock_areas;
create policy stock_areas_select on public.stock_areas
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists stock_areas_insert on public.stock_areas;
create policy stock_areas_insert on public.stock_areas
  for insert to authenticated with check (public.is_org_admin(organization_id));
drop policy if exists stock_areas_update on public.stock_areas;
create policy stock_areas_update on public.stock_areas
  for update to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
drop policy if exists stock_areas_delete on public.stock_areas;
create policy stock_areas_delete on public.stock_areas
  for delete to authenticated using (public.is_org_admin(organization_id));

drop policy if exists stock_area_members_select on public.stock_area_members;
create policy stock_area_members_select on public.stock_area_members
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists stock_area_members_insert on public.stock_area_members;
create policy stock_area_members_insert on public.stock_area_members
  for insert to authenticated with check (public.is_org_admin(organization_id));
drop policy if exists stock_area_members_delete on public.stock_area_members;
create policy stock_area_members_delete on public.stock_area_members
  for delete to authenticated using (public.is_org_admin(organization_id));

-- -----------------------------------------------------------------------------
-- 4) Convites levam cargo e áreas
-- -----------------------------------------------------------------------------
alter table public.organization_invites add column if not exists cargo_id uuid;
alter table public.organization_invites add column if not exists all_areas boolean not null default false;
alter table public.organization_invites add column if not exists area_ids uuid[] not null default '{}';
alter table public.organization_invites drop constraint if exists organization_invites_cargo_fkey;
alter table public.organization_invites
  add constraint organization_invites_cargo_fkey foreign key (organization_id, cargo_id)
  references public.organization_roles (organization_id, id) on delete set null (cargo_id);
alter table public.organization_invites drop constraint if exists organization_invites_area_ids_check;
alter table public.organization_invites
  add constraint organization_invites_area_ids_check check (cardinality(area_ids) <= 100);

-- -----------------------------------------------------------------------------
-- 5) Acesso da pessoa logada no workspace atual
-- -----------------------------------------------------------------------------
create or replace function public.current_member_access()
returns table (organization_id uuid, user_id uuid, is_adm boolean, permissions text[], all_areas boolean, cargo_id uuid)
language sql stable security definer set search_path = public as $$
  select m.organization_id, m.user_id, m.role in ('dono', 'admin'),
         coalesce(r.permissions, '{}'::text[]), m.all_areas, m.cargo_id
    from public.user_workspace_state s
    join public.workspaces w on w.id = s.workspace_id and w.archived_at is null
    join public.organization_members m on m.organization_id = w.organization_id and m.user_id = s.user_id
    left join public.organization_roles r on r.id = m.cargo_id
   where s.user_id = auth.uid()
     and (m.expires_at is null or m.expires_at > now())
     and (m.workspace_scope is null or w.id = any (m.workspace_scope));
$$;

-- Pode usar o módulo (colaboradores, compras...)?
create or replace function public.current_member_can(p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select a.is_adm or p_perm = any (a.permissions) from public.current_member_access() a), false);
$$;

-- Gerencia a área deste item (pela categoria)?
create or replace function public.can_manage_category(p_category text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select a.is_adm or a.all_areas or exists (
      select 1
        from public.stock_area_members am
        join public.stock_areas sa on sa.id = am.area_id
       where am.organization_id = a.organization_id and am.user_id = a.user_id
         and exists (select 1 from unnest(sa.categories) c where upper(btrim(c)) = upper(btrim(p_category)))
    )
    from public.current_member_access() a
  ), false);
$$;

-- Pode gravar alguma coisa no workspace? (Consulta não pode.)
create or replace function public.current_workspace_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select a.is_adm or cardinality(a.permissions) > 0 or a.all_areas
           or exists (select 1 from public.stock_area_members am
                       where am.organization_id = a.organization_id and am.user_id = a.user_id)
      from public.current_member_access() a
  ), false);
$$;

-- Resumo para o app (menu, botões).
create or replace function public.my_access()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'organization_id', a.organization_id,
      'is_adm', a.is_adm,
      'cargo_id', a.cargo_id,
      'cargo_name', r.name,
      'permissions', to_jsonb(a.permissions),
      'all_areas', a.all_areas or a.is_adm,
      'areas', coalesce((
        select jsonb_agg(jsonb_build_object('id', sa.id, 'name', sa.name, 'categories', to_jsonb(sa.categories)) order by sa.name)
          from public.stock_area_members am join public.stock_areas sa on sa.id = am.area_id
         where am.organization_id = a.organization_id and am.user_id = a.user_id
      ), '[]'::jsonb)
    )
    from public.current_member_access() a
    left join public.organization_roles r on r.id = a.cargo_id
  ), 'null'::jsonb);
$$;

-- -----------------------------------------------------------------------------
-- 6) Gatilhos: área do item
-- -----------------------------------------------------------------------------
create or replace function public.area_denied(p_category text)
returns void language plpgsql as $$
begin
  raise exception 'Você não gerencia a área destes itens (categoria: %). Peça ao ADM para incluir você na área.',
    coalesce(nullif(btrim(p_category), ''), 'sem categoria')
    using errcode = '42501';
end;
$$;

create or replace function public.enforce_item_area()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old; -- apagado em cascata (ex.: workspace removido)
  end if;
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['is_rented', 'updated_at']) = (to_jsonb(old) - array['is_rented', 'updated_at']) then
    return new; -- só marcou como alugado (tela de aluguéis)
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

-- Movimentações, posse, saldo no local e documentos: vale a área do item.
create or replace function public.enforce_item_area_child()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cat text;
begin
  if auth.uid() is null then
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

drop trigger if exists items_area_guard on public.items;
create trigger items_area_guard before insert or update or delete on public.items
  for each row execute function public.enforce_item_area();

do $$
declare t text;
begin
  foreach t in array array['movements', 'possession', 'site_possession', 'equipment_documents'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_area_guard', t);
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.enforce_item_area_child()',
      t || '_area_guard', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 7) Gatilhos: permissão do cargo por módulo
-- -----------------------------------------------------------------------------
create or replace function public.enforce_module_permission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_perm text := tg_argv[0];
  v_label text := tg_argv[1];
begin
  if auth.uid() is null then
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

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('employees', 'colaboradores', 'colaboradores'),
      ('purchase_orders', 'compras', 'ordens de compra'),
      ('purchase_order_items', 'compras', 'ordens de compra'),
      ('equipment_rentals', 'alugueis', 'aluguéis'),
      ('rental_suppliers', 'alugueis', 'aluguéis'),
      ('work_sites', 'cadastros', 'locais e obras'),
      ('item_categories', 'cadastros', 'categorias'),
      ('inventory_counts', 'inventario', 'inventários'),
      ('inventory_count_lines', 'inventario', 'inventários'),
      ('mural_notes', 'mural', 'o mural')
    ) as v(tbl, perm, label)
  loop
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_perm_guard', r.tbl);
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.enforce_module_permission(%L, %L)',
      r.tbl || '_perm_guard', r.tbl, r.perm, r.label);
  end loop;
end $$;

-- Categoria renomeada: a área continua valendo para o nome novo.
create or replace function public.item_categories_rename_area_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if upper(btrim(new.name)) is distinct from upper(btrim(old.name)) then
    update public.stock_areas sa
       set categories = sa.categories || new.name, updated_at = now()
      from public.workspaces w
     where w.id = new.workspace_id and sa.organization_id = w.organization_id
       and exists (select 1 from unnest(sa.categories) c where upper(btrim(c)) = upper(btrim(old.name)))
       and not exists (select 1 from unnest(sa.categories) c where upper(btrim(c)) = upper(btrim(new.name)));
  end if;
  return new;
end;
$$;
drop trigger if exists item_categories_rename_area on public.item_categories;
create trigger item_categories_rename_area after update of name on public.item_categories
  for each row execute function public.item_categories_rename_area_trg();

-- -----------------------------------------------------------------------------
-- 8) Funções da página Organização (só ADM)
-- -----------------------------------------------------------------------------

-- Pessoas da organização com cargo, áreas, workspaces e prazo.
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
      'created_at', m.created_at
    ) order by case m.role when 'dono' then 0 when 'admin' then 1 else 2 end, u.email)
      from public.organization_members m
      join auth.users u on u.id = m.user_id
     where m.organization_id = p_org
  ), '[]'::jsonb);
end;
$$;

-- Categorias usadas nos itens de todos os workspaces da organização (para montar as áreas).
create or replace function public.organization_categories(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Só um ADM da organização pode ver isso.' using errcode = '42501';
  end if;
  return coalesce((
    with names as (
      select btrim(i.category) as name, 1 as item
        from public.items i join public.workspaces w on w.id = i.workspace_id
       where w.organization_id = p_org and nullif(btrim(i.category), '') is not null and i.archived_at is null
      union all
      select btrim(c.name), 0
        from public.item_categories c join public.workspaces w on w.id = c.workspace_id
       where w.organization_id = p_org and nullif(btrim(c.name), '') is not null
    ),
    grouped as (
      select upper(name) as k,
             (array_agg(name order by item desc, name))[1] as name,
             sum(item)::int as items,
             array_agg(distinct name) as spellings
        from names group by upper(name)
    )
    select jsonb_agg(jsonb_build_object('name', g.name, 'items', g.items, 'spellings', to_jsonb(g.spellings)) order by g.name)
      from grouped g
  ), '[]'::jsonb);
end;
$$;

-- ADM define cargo, áreas, workspaces e prazo de uma pessoa.
create or replace function public.set_member_access(
  p_org uuid,
  p_user uuid,
  p_is_adm boolean,
  p_cargo uuid default null,
  p_all_areas boolean default false,
  p_area_ids uuid[] default '{}',
  p_scope uuid[] default null,
  p_expires_at timestamptz default null
)
returns void language plpgsql security definer set search_path = public as $$
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
$$;

-- -----------------------------------------------------------------------------
-- 9) Convite: mostra e aplica cargo e áreas
-- -----------------------------------------------------------------------------
create or replace function public.invite_cargo_id(inv public.organization_invites)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(inv.cargo_id, (
    select r.id from public.organization_roles r
     where r.organization_id = inv.organization_id
       and r.system_key = case inv.role when 'gestor' then 'consulta' else 'almoxarife' end
  ));
$$;
revoke all on function public.invite_cargo_id(public.organization_invites) from public, anon, authenticated;

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

-- Aceitar: ADM não gasta o convite. Quem já participa nunca perde acesso:
-- soma workspaces e áreas, fica com o prazo maior e com o cargo que tem mais permissões.
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

-- -----------------------------------------------------------------------------
-- 10) Permissões de execução
-- -----------------------------------------------------------------------------
revoke all on function public.current_member_access() from public, anon;
revoke all on function public.current_member_can(text) from public, anon;
revoke all on function public.can_manage_category(text) from public, anon;
revoke all on function public.my_access() from public, anon;
revoke all on function public.organization_people(uuid) from public, anon;
revoke all on function public.organization_categories(uuid) from public, anon;
revoke all on function public.set_member_access(uuid, uuid, boolean, uuid, boolean, uuid[], uuid[], timestamptz) from public, anon;
revoke all on function public.invite_info(text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.area_denied(text) from public, anon;
grant execute on function public.current_member_access() to authenticated;
grant execute on function public.current_member_can(text) to authenticated;
grant execute on function public.can_manage_category(text) to authenticated;
grant execute on function public.my_access() to authenticated;
grant execute on function public.organization_people(uuid) to authenticated;
grant execute on function public.organization_categories(uuid) to authenticated;
grant execute on function public.set_member_access(uuid, uuid, boolean, uuid, boolean, uuid[], uuid[], timestamptz) to authenticated;
grant execute on function public.invite_info(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.area_denied(text) to authenticated;

grant select, insert, update, delete on public.organization_roles to authenticated;
grant select, insert, update, delete on public.stock_areas to authenticated;
grant select, insert, delete on public.stock_area_members to authenticated;
