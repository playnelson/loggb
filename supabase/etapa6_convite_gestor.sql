-- v0.9 — Convite temporário para gestor (somente leitura).
-- Requer etapa5_organizacoes_workspaces.sql. Rodar inteiro de uma vez.
--
-- O dono/admin gera um link de convite. Quem abre o link (com login) entra na
-- organização como "gestor": vê o estoque e o histórico dos workspaces liberados,
-- mas o banco recusa qualquer gravação. O acesso pode ter prazo (expires_at) e
-- pode valer para todos os workspaces ou só alguns (workspace_scope).

-- ---------------------------------------------------------------------------
-- 1) Prazo e alcance do acesso de cada membro
-- ---------------------------------------------------------------------------

alter table public.organization_members
  add column if not exists expires_at timestamptz,
  add column if not exists workspace_scope uuid[];

comment on column public.organization_members.expires_at is 'Fim do acesso (null = sem prazo).';
comment on column public.organization_members.workspace_scope is 'Workspaces liberados (null = todos da organização).';

-- ---------------------------------------------------------------------------
-- 2) Funções de acesso (passam a respeitar prazo e alcance)
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
     where m.organization_id = p_org and m.user_id = auth.uid()
       and (m.expires_at is null or m.expires_at > now())
  );
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
     where m.organization_id = p_org and m.user_id = auth.uid() and m.role in ('dono', 'admin')
       and (m.expires_at is null or m.expires_at > now())
  );
$$;

-- A pessoa logada pode ver este workspace?
create or replace function public.can_access_workspace(p_ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.workspaces w
      join public.organization_members m on m.organization_id = w.organization_id and m.user_id = auth.uid()
     where w.id = p_ws
       and (m.expires_at is null or m.expires_at > now())
       and (m.workspace_scope is null or w.id = any (m.workspace_scope))
  );
$$;

create or replace function public.current_workspace_id()
returns uuid language sql stable security definer set search_path = public as $$
  select s.workspace_id
    from public.user_workspace_state s
    join public.workspaces w on w.id = s.workspace_id and w.archived_at is null
    join public.organization_members m on m.organization_id = w.organization_id and m.user_id = s.user_id
   where s.user_id = auth.uid()
     and (m.expires_at is null or m.expires_at > now())
     and (m.workspace_scope is null or w.id = any (m.workspace_scope));
$$;

-- A pessoa logada pode gravar no workspace atual? (gestor não pode)
create or replace function public.current_workspace_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.user_workspace_state s
      join public.workspaces w on w.id = s.workspace_id and w.archived_at is null
      join public.organization_members m on m.organization_id = w.organization_id and m.user_id = s.user_id
     where s.user_id = auth.uid()
       and m.role in ('dono', 'admin', 'membro')
       and (m.expires_at is null or m.expires_at > now())
       and (m.workspace_scope is null or w.id = any (m.workspace_scope))
  );
$$;

create or replace function public.set_current_workspace(p_workspace_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.archived_at is null)
     or not public.can_access_workspace(p_workspace_id) then
    raise exception 'Workspace não encontrado.' using errcode = 'P0002';
  end if;
  insert into public.user_workspace_state (user_id, workspace_id, updated_at)
  values (v_uid, p_workspace_id, now())
  on conflict (user_id) do update set workspace_id = excluded.workspace_id, updated_at = now();
  return p_workspace_id;
end;
$$;

revoke all on function public.can_access_workspace(uuid) from public, anon;
revoke all on function public.current_workspace_can_write() from public, anon;
grant execute on function public.can_access_workspace(uuid) to authenticated;
grant execute on function public.current_workspace_can_write() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Regras das tabelas da organização
-- ---------------------------------------------------------------------------

-- Workspaces: cada um vê só os liberados para si; o admin vê todos (inclusive arquivados).
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select to authenticated
  using (public.can_access_workspace(id) or public.is_org_admin(organization_id));

-- Membros: a pessoa vê a própria linha; o admin vê todos da organização.
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_org_admin(organization_id));

-- Remover acesso: o admin remove qualquer um menos o dono; cada um pode sair (menos o dono).
drop policy if exists organization_members_delete on public.organization_members;
create policy organization_members_delete on public.organization_members
  for delete to authenticated
  using (role <> 'dono' and (public.is_org_admin(organization_id) or user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 4) Dados do workspace: ler (todos com acesso) x gravar (menos gestor)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  v_pol name;
begin
  foreach t in array array[
    'items', 'employees', 'item_categories', 'work_sites', 'site_possession', 'possession',
    'movements', 'purchase_orders', 'purchase_order_items', 'equipment_rentals',
    'rental_suppliers', 'inventory_counts', 'inventory_count_lines', 'mural_notes'
  ] loop
    foreach v_pol in array coalesce(
      (select array_agg(policyname) from pg_policies where schemaname = 'public' and tablename = t),
      '{}'::name[]
    ) loop
      execute format('drop policy %I on public.%I', v_pol, t);
    end loop;

    execute format(
      'create policy workspace_read on public.%I for select to authenticated
         using (workspace_id = (select public.current_workspace_id()))', t);
    execute format(
      'create policy workspace_insert on public.%I for insert to authenticated
         with check (workspace_id = (select public.current_workspace_id())
                     and (select public.current_workspace_can_write()))', t);
    execute format(
      'create policy workspace_update on public.%I for update to authenticated
         using (workspace_id = (select public.current_workspace_id())
                and (select public.current_workspace_can_write()))
         with check (workspace_id = (select public.current_workspace_id())
                     and (select public.current_workspace_can_write()))', t);
    execute format(
      'create policy workspace_delete on public.%I for delete to authenticated
         using (workspace_id = (select public.current_workspace_id())
                and (select public.current_workspace_can_write()))', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Convites
-- ---------------------------------------------------------------------------

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- 64 caracteres aleatórios; é o que vai no link.
  token text not null unique
    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  role text not null default 'gestor' check (role = 'gestor'),
  label text check (label is null or char_length(label) <= 120),
  workspace_scope uuid[],
  invite_expires_at timestamptz not null default (now() + interval '7 days'),
  access_expires_at timestamptz,
  max_uses int not null default 1 check (max_uses between 1 and 50),
  uses int not null default 0,
  revoked_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists organization_invites_org_idx on public.organization_invites (organization_id, created_at desc);

alter table public.organization_invites enable row level security;

drop policy if exists organization_invites_select on public.organization_invites;
create policy organization_invites_select on public.organization_invites
  for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists organization_invites_insert on public.organization_invites;
create policy organization_invites_insert on public.organization_invites
  for insert to authenticated with check (public.is_org_admin(organization_id) and uses = 0 and revoked_at is null);
drop policy if exists organization_invites_update on public.organization_invites;
create policy organization_invites_update on public.organization_invites
  for update to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- O que o link mostra antes de aceitar (só para quem está logado).
create or replace function public.invite_info(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  inv record;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  select i.*, o.name as org_name, o.logo_data
    into inv
    from public.organization_invites i
    join public.organizations o on o.id = i.organization_id
   where i.token = p_token;
  if not found then
    return jsonb_build_object('status', 'invalido');
  end if;

  v_status := case
    when inv.revoked_at is not null then 'cancelado'
    when inv.invite_expires_at <= now() then 'expirado'
    when inv.uses >= inv.max_uses then 'usado'
    else 'valido'
  end;

  return jsonb_build_object(
    'status', v_status,
    'organization_name', inv.org_name,
    'logo_data', inv.logo_data,
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
         and m.role in ('dono', 'admin', 'membro')
    )
  );
end;
$$;

-- Aceita o convite: vira gestor (somente leitura) e entra no primeiro workspace liberado.
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  inv public.organization_invites%rowtype;
  v_scope uuid[];
  v_member public.organization_members%rowtype;
  v_has_member boolean;
  v_expired boolean;
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

  -- Quem já tem esse acesso (dono/admin/membro, ou gestor ainda válido que já vê
  -- esses workspaces) não gasta o convite: só entra no workspace.
  if v_has_member and (
       v_member.role in ('dono', 'admin', 'membro')
       or (
         (v_member.expires_at is null or v_member.expires_at > now())
         and (v_member.workspace_scope is null
              or (inv.workspace_scope is not null and inv.workspace_scope <@ v_member.workspace_scope))
         and (v_member.expires_at is null
              or (inv.access_expires_at is not null and inv.access_expires_at <= v_member.expires_at))
       )
     ) then
    v_scope := inv.workspace_scope;
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

    -- Só workspaces ativos desta organização.
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

    if v_has_member then
      -- Já era gestor. Se o acesso antigo tinha vencido, vale só o convite novo;
      -- senão soma os workspaces e fica com o prazo maior (sem prazo ganha).
      v_expired := v_member.expires_at is not null and v_member.expires_at <= now();
      update public.organization_members
         set workspace_scope = case
               when v_expired then v_scope
               when v_member.workspace_scope is null or v_scope is null then null
               else array(select distinct x from unnest(v_member.workspace_scope || v_scope) as x)
             end,
             expires_at = case
               when v_expired then inv.access_expires_at
               when v_member.expires_at is null or inv.access_expires_at is null then null
               else greatest(v_member.expires_at, inv.access_expires_at)
             end
       where organization_id = inv.organization_id and user_id = v_uid;
    else
      insert into public.organization_members (organization_id, user_id, role, expires_at, workspace_scope)
      values (inv.organization_id, v_uid, 'gestor', inv.access_expires_at, v_scope);
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

-- Lista de quem tem acesso à organização (com e-mail), só para dono/admin.
create or replace function public.organization_access_list(p_org uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  expires_at timestamptz,
  workspace_scope uuid[],
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role, m.expires_at, m.workspace_scope, m.created_at
    from public.organization_members m
    join auth.users u on u.id = m.user_id
   where m.organization_id = p_org
     and public.is_org_admin(p_org)
   order by case m.role when 'dono' then 0 when 'admin' then 1 when 'membro' then 2 else 3 end, u.email;
$$;

revoke all on function public.invite_info(text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.organization_access_list(uuid) from public, anon;
grant execute on function public.invite_info(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.organization_access_list(uuid) to authenticated;

notify pgrst, 'reload schema';
