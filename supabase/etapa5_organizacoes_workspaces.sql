-- v0.8 — Organizações e workspaces.
-- Requer etapa4_limpeza.sql. Rodar inteiro de uma vez (é uma transação só).
--
-- Modelo:
--   organizations          empresa (nome + logo)
--   organization_members   quem participa da organização e com qual papel
--   workspaces             canteiro / cidade / sede dentro da organização
--   user_workspace_state   workspace em que cada pessoa está trabalhando agora
--
-- Todas as tabelas de dados ganham workspace_id. A segurança (RLS) deixa de ser
-- "a linha é minha" (user_id) e passa a ser "a linha é do workspace em que estou e
-- eu participo da organização dele". Assim o app não precisa filtrar por workspace
-- em cada consulta: o banco já devolve só o workspace atual, e as inserções recebem
-- o workspace atual por padrão.
--
-- user_id / performed_by continuam existindo como "quem criou / quem fez".
--
-- Dados existentes: cada usuário ganha a organização "Minha empresa" com o
-- workspace "Principal", e tudo o que ele já tinha vai para esse workspace.

-- ---------------------------------------------------------------------------
-- 1) Tabelas novas
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- Logo reduzida no navegador (máx. 256 px) e guardada como data URL.
  logo_data text check (
    logo_data is null
    or (logo_data like 'data:image/%' and char_length(logo_data) <= 300000)
  ),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'membro' check (role in ('dono', 'admin', 'gestor', 'membro')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists organization_members_user_idx on public.organization_members (user_id);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null default 'canteiro' check (kind in ('canteiro', 'cidade', 'sede', 'outro')),
  city text check (city is null or char_length(city) <= 120),
  notes text check (notes is null or char_length(notes) <= 500),
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists workspaces_org_idx on public.workspaces (organization_id);

create table if not exists public.user_workspace_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists user_workspace_state_ws_idx on public.user_workspace_state (workspace_id);

-- ---------------------------------------------------------------------------
-- 2) Funções de apoio (SECURITY DEFINER para não depender das próprias regras de RLS)
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
     where m.organization_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
     where m.organization_id = p_org and m.user_id = auth.uid() and m.role in ('dono', 'admin')
  );
$$;

-- Workspace atual da pessoa logada, só se ela ainda participa da organização dele
-- e ele não está arquivado. É o filtro usado em todas as tabelas de dados.
create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.workspace_id
    from public.user_workspace_state s
    join public.workspaces w on w.id = s.workspace_id and w.archived_at is null
    join public.organization_members m on m.organization_id = w.organization_id and m.user_id = s.user_id
   where s.user_id = auth.uid();
$$;

create or replace function public.set_current_workspace(p_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not exists (
    select 1
      from public.workspaces w
      join public.organization_members m on m.organization_id = w.organization_id and m.user_id = v_uid
     where w.id = p_workspace_id and w.archived_at is null
  ) then
    raise exception 'Workspace não encontrado.' using errcode = 'P0002';
  end if;
  insert into public.user_workspace_state (user_id, workspace_id, updated_at)
  values (v_uid, p_workspace_id, now())
  on conflict (user_id) do update set workspace_id = excluded.workspace_id, updated_at = now();
  return p_workspace_id;
end;
$$;

-- Cria a organização, coloca quem criou como dono, cria o primeiro workspace e entra nele.
create or replace function public.create_organization(
  p_name text,
  p_logo_data text default null,
  p_workspace_name text default null,
  p_workspace_kind text default 'canteiro',
  p_workspace_city text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_ws uuid;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Informe o nome da organização.' using errcode = '22023';
  end if;
  if (select count(*) from public.organization_members where user_id = v_uid and role = 'dono') >= 20 then
    raise exception 'Limite de 20 organizações por pessoa.' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, logo_data, created_by)
  values (btrim(p_name), nullif(p_logo_data, ''), v_uid)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, v_uid, 'dono');

  insert into public.workspaces (organization_id, name, kind, city, created_by)
  values (
    v_org,
    coalesce(nullif(btrim(coalesce(p_workspace_name, '')), ''), 'Principal'),
    coalesce(nullif(btrim(coalesce(p_workspace_kind, '')), ''), 'canteiro'),
    nullif(btrim(coalesce(p_workspace_city, '')), ''),
    v_uid
  )
  returning id into v_ws;

  insert into public.user_workspace_state (user_id, workspace_id, updated_at)
  values (v_uid, v_ws, now())
  on conflict (user_id) do update set workspace_id = excluded.workspace_id, updated_at = now();

  return v_ws;
end;
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.is_org_admin(uuid) from public, anon;
revoke all on function public.current_workspace_id() from public, anon;
revoke all on function public.set_current_workspace(uuid) from public, anon;
revoke all on function public.create_organization(text, text, text, text, text) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;
grant execute on function public.current_workspace_id() to authenticated;
grant execute on function public.set_current_workspace(uuid) to authenticated;
grant execute on function public.create_organization(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Segurança das tabelas novas
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.workspaces enable row level security;
alter table public.user_workspace_state enable row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated using (public.is_org_member(id));
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));

drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces
  for insert to authenticated with check (public.is_org_admin(organization_id));
drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
  for update to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists user_workspace_state_select on public.user_workspace_state;
create policy user_workspace_state_select on public.user_workspace_state
  for select to authenticated using (user_id = auth.uid());

-- Sem política de DELETE em organizações e workspaces: workspace se arquiva, não se apaga.

-- ---------------------------------------------------------------------------
-- 4) Organização e workspace "Principal" para quem já usa o app
-- ---------------------------------------------------------------------------

do $$
declare
  u record;
  v_org uuid;
  v_ws uuid;
begin
  for u in
    select au.id from auth.users au
     where not exists (select 1 from public.organization_members m where m.user_id = au.id)
  loop
    insert into public.organizations (name, created_by) values ('Minha empresa', u.id) returning id into v_org;
    insert into public.organization_members (organization_id, user_id, role) values (v_org, u.id, 'dono');
    insert into public.workspaces (organization_id, name, kind, created_by)
    values (v_org, 'Principal', 'sede', u.id)
    returning id into v_ws;
    insert into public.user_workspace_state (user_id, workspace_id) values (u.id, v_ws)
    on conflict (user_id) do update set workspace_id = excluded.workspace_id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) workspace_id em todas as tabelas de dados
-- ---------------------------------------------------------------------------

do $$
declare
  t record;
  v_pol name;
begin
  for t in
    select * from (values
      ('items',                 'user_id'),
      ('employees',             'user_id'),
      ('item_categories',       'user_id'),
      ('work_sites',            'user_id'),
      ('site_possession',       'user_id'),
      ('possession',            'user_id'),
      ('movements',             'performed_by'),
      ('purchase_orders',       'user_id'),
      ('purchase_order_items',  null),
      ('equipment_rentals',     'user_id'),
      ('rental_suppliers',      'user_id'),
      ('inventory_counts',      'user_id'),
      ('inventory_count_lines', 'user_id'),
      ('mural_notes',           'user_id')
    ) as x(tbl, owner_col)
  loop
    execute format(
      'alter table public.%I add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade',
      t.tbl
    );

    -- Cada linha vai para o workspace "Principal" do seu dono.
    if t.owner_col is not null then
      execute format(
        'update public.%I x set workspace_id = s.workspace_id
           from public.user_workspace_state s
          where x.workspace_id is null and s.user_id = x.%I',
        t.tbl, t.owner_col
      );
    else
      update public.purchase_order_items li
         set workspace_id = po.workspace_id
        from public.purchase_orders po
       where li.workspace_id is null and po.id = li.purchase_order_id;
    end if;

    -- Falha aqui (e nada é aplicado) se sobrar alguma linha sem workspace.
    execute format(
      'alter table public.%I alter column workspace_id set default public.current_workspace_id(),
                         alter column workspace_id set not null',
      t.tbl
    );
    execute format('create index if not exists %I on public.%I (workspace_id)', t.tbl || '_workspace_idx', t.tbl);

    -- "Quem criou" passa a ser preenchido sozinho em todas as tabelas.
    if t.owner_col = 'user_id' then
      execute format('alter table public.%I alter column user_id set default auth.uid()', t.tbl);
    end if;

    -- Troca as regras antigas ("a linha é minha") pela regra do workspace.
    foreach v_pol in array coalesce(
      (select array_agg(policyname) from pg_policies where schemaname = 'public' and tablename = t.tbl),
      '{}'::name[]
    ) loop
      execute format('drop policy %I on public.%I', v_pol, t.tbl);
    end loop;
    execute format(
      'create policy workspace_rows on public.%I for all to authenticated
         using (workspace_id = (select public.current_workspace_id()))
         with check (workspace_id = (select public.current_workspace_id()))',
      t.tbl
    );
    execute format('alter table public.%I enable row level security', t.tbl);
  end loop;
end;
$$;

alter table public.movements alter column performed_by set default auth.uid();

-- Códigos, CPFs e nomes de categoria passam a ser únicos por workspace (antes: por usuário).
alter table public.items drop constraint if exists items_user_code_key;
alter table public.items add constraint items_workspace_code_key unique (workspace_id, code);

drop index if exists public.employees_user_cpf_key;
create unique index if not exists employees_workspace_cpf_key
  on public.employees (workspace_id, cpf) where cpf is not null and cpf <> '';

drop index if exists public.item_categories_user_name_unique;
create unique index if not exists item_categories_workspace_name_unique
  on public.item_categories (workspace_id, lower(name));

-- ---------------------------------------------------------------------------
-- 6) Funções de estoque: tiram o "user_id = eu" (o RLS do workspace já filtra)
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_src text;
  v_dst text;
begin
  for r in
    select * from (values
      ('public.register_movement(uuid,text,numeric,uuid,uuid,text,numeric,numeric,numeric,boolean,text,text,text,uuid)',
       'where i.id = p_item_id and i.user_id = v_uid', 'where i.id = p_item_id'),
      ('public.register_movement(uuid,text,numeric,uuid,uuid,text,numeric,numeric,numeric,boolean,text,text,text,uuid)',
       'where e.id = p_employee_id and e.user_id = v_uid', 'where e.id = p_employee_id'),
      ('public.register_movement(uuid,text,numeric,uuid,uuid,text,numeric,numeric,numeric,boolean,text,text,text,uuid)',
       'where w.id = p_work_site_id and w.user_id = v_uid', 'where w.id = p_work_site_id'),
      ('public.receive_po_item(uuid,numeric,uuid,boolean,uuid)',
       'if not found or v_line.owner <> v_uid then', 'if not found then'),
      ('public.receive_po_item(uuid,numeric,uuid,boolean,uuid)',
       'where i.id = v_item and i.user_id = v_uid', 'where i.id = v_item'),
      ('public.record_inventory_count(uuid,numeric,text)',
       'where l.id = p_line_id and l.user_id = v_uid and c.user_id = v_uid', 'where l.id = p_line_id'),
      ('public.record_inventory_count(uuid,numeric,text)',
       'where id = v_line.item_id and user_id = v_uid', 'where id = v_line.item_id'),
      ('public.start_inventory_count(text,text,text,boolean)',
       'where i.user_id = v_uid', 'where true'),
      ('public.close_inventory_count(uuid)',
       'where id = p_count_id and user_id = v_uid for update', 'where id = p_count_id for update')
    ) as x(sig, old_txt, new_txt)
  loop
    v_src := pg_get_functiondef(r.sig::regprocedure);
    if position(r.old_txt in v_src) = 0 then
      raise exception 'Trecho não encontrado em %: %', r.sig, r.old_txt;
    end if;
    v_dst := replace(v_src, r.old_txt, r.new_txt);
    execute v_dst;
  end loop;
end;
$$;

-- Avisos antigos do Supabase: funções de gatilho sem search_path fixo.
alter function public.purchase_order_items_compat_fill() set search_path = public;
alter function public.purchase_orders_touch_updated_at() set search_path = public;

-- ---------------------------------------------------------------------------
-- 7) "Zerar dados" passa a zerar só o workspace atual (dono/admin)
-- ---------------------------------------------------------------------------

create or replace function public.reset_my_account_data()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid := public.current_workspace_id();
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  t record;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if v_ws is null then
    raise exception 'Nenhum workspace selecionado.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.workspaces w where w.id = v_ws and public.is_org_admin(w.organization_id)
  ) then
    raise exception 'Só o dono ou um administrador da organização pode zerar o workspace.' using errcode = '42501';
  end if;

  -- Ordem: quem referencia vem antes de quem é referenciado.
  -- (purchase_order_items sai junto com purchase_orders via ON DELETE CASCADE)
  for t in
    select * from (values
      (1,  'purchase_orders'),
      (2,  'equipment_rentals'),
      (3,  'rental_suppliers'),
      (4,  'inventory_count_lines'),
      (5,  'inventory_counts'),
      (6,  'movements'),
      (7,  'site_possession'),
      (8,  'possession'),
      (9,  'work_sites'),
      (10, 'items'),
      (11, 'employees'),
      (12, 'item_categories'),
      (13, 'mural_notes')
    ) as x(ord, tbl)
    order by ord
  loop
    execute format('delete from public.%I where workspace_id = $1', t.tbl) using v_ws;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(t.tbl, v_n);
  end loop;

  return v_counts;
end;
$$;

revoke all on function public.reset_my_account_data() from public, anon;
grant execute on function public.reset_my_account_data() to authenticated;

notify pgrst, 'reload schema';
