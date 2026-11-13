-- =============================================================================
-- Etapa 7: equipe do workspace (convite de membro)
--
-- Os colaboradores (e todo o resto) já pertencem ao workspace, não a quem
-- cadastrou. Faltava colocar outras pessoas no mesmo workspace com permissão
-- de editar. Agora o convite pode ser:
--   * gestor  -> só consulta (como antes)
--   * membro  -> usa o workspace normalmente (cadastra, movimenta, edita)
-- Membro não gerencia organização, workspaces nem convites (isso é dono/admin).
-- =============================================================================

-- 1) Convite aceita os dois papéis.
alter table public.organization_invites drop constraint if exists organization_invites_role_check;
alter table public.organization_invites
  add constraint organization_invites_role_check check (role in ('gestor', 'membro'));

-- 2) O que o link mostra antes de aceitar: agora também o papel.
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
    'role', inv.role,
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
         and (m.role in ('dono', 'admin')
              or (m.role = 'membro' and m.workspace_scope is null and m.expires_at is null))
    )
  );
end;
$$;

-- 3) Aceitar o convite: entra como gestor ou membro.
--    Quem já tem acesso igual ou maior não gasta o convite.
--    Gestor que recebe convite de membro passa a membro (vale o escopo e o prazo do convite novo).
--    Membro com acesso limitado que recebe convite de gestor para outro workspace é recusado
--    (uma pessoa tem um só papel por organização).
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  inv public.organization_invites%rowtype;
  v_scope uuid[];
  v_member public.organization_members%rowtype;
  v_has_member boolean;
  v_member_valid boolean;
  v_member_rank int;
  v_inv_rank int;
  v_covers boolean;
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

  v_inv_rank := case inv.role when 'membro' then 2 else 1 end;
  v_member_valid := v_has_member and (v_member.expires_at is null or v_member.expires_at > now());
  v_member_rank := case
    when not v_member_valid then 0
    when v_member.role in ('dono', 'admin') then 3
    when v_member.role = 'membro' then 2
    else 1
  end;

  v_covers := v_member_rank >= 3
    or (
      v_member_rank >= v_inv_rank
      and (v_member.workspace_scope is null
           or (inv.workspace_scope is not null and inv.workspace_scope <@ v_member.workspace_scope))
      and (v_member.expires_at is null
           or (inv.access_expires_at is not null and inv.access_expires_at <= v_member.expires_at))
    );

  if v_covers then
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
    if v_member_rank > v_inv_rank then
      raise exception 'Você já participa desta organização como membro. Peça um convite de membro para este workspace.'
        using errcode = 'P0001';
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
      if v_member_valid and v_member_rank = v_inv_rank then
        -- Mesmo papel: soma os workspaces e fica com o prazo maior (sem prazo ganha).
        update public.organization_members
           set workspace_scope = case
                 when v_member.workspace_scope is null or v_scope is null then null
                 else array(select distinct x from unnest(v_member.workspace_scope || v_scope) as x)
               end,
               expires_at = case
                 when v_member.expires_at is null or inv.access_expires_at is null then null
                 else greatest(v_member.expires_at, inv.access_expires_at)
               end
         where organization_id = inv.organization_id and user_id = v_uid;
      else
        -- Acesso vencido, ou gestor virando membro: vale só o convite novo.
        update public.organization_members
           set role = inv.role,
               workspace_scope = v_scope,
               expires_at = inv.access_expires_at
         where organization_id = inv.organization_id and user_id = v_uid;
      end if;
    else
      insert into public.organization_members (organization_id, user_id, role, expires_at, workspace_scope)
      values (inv.organization_id, v_uid, inv.role, inv.access_expires_at, v_scope);
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

revoke all on function public.invite_info(text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.invite_info(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
