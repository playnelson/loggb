-- Etapa 15: gestão completa de categorias (só ADM da organização).
-- A categoria vive em 3 lugares: items.category (texto), item_categories (lista cadastrada)
-- e stock_areas.categories (almoxarifado). As ações abaixo mexem nos três de uma vez.

-- 1) Lista da organização: agora diz se a categoria está cadastrada e se é travada (EPI).
create or replace function public.organization_categories(p_org uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Só um ADM da organização pode ver isso.' using errcode = '42501';
  end if;
  return coalesce((
    with names as (
      select btrim(i.category) as name, 1 as item, 0 as reg, false as locked
        from public.items i join public.workspaces w on w.id = i.workspace_id
       where w.organization_id = p_org and nullif(btrim(i.category), '') is not null and i.archived_at is null
      union all
      select btrim(c.name), 0, 1, coalesce(c.locked, false)
        from public.item_categories c join public.workspaces w on w.id = c.workspace_id
       where w.organization_id = p_org and nullif(btrim(c.name), '') is not null
    ),
    grouped as (
      select upper(name) as k,
             (array_agg(name order by reg desc, item desc, name))[1] as name,
             sum(item)::int as items,
             array_agg(distinct name) as spellings,
             bool_or(reg = 1) as registered,
             bool_or(locked) as locked
        from names group by upper(name)
    )
    select jsonb_agg(jsonb_build_object(
             'name', g.name, 'items', g.items, 'spellings', to_jsonb(g.spellings),
             'registered', g.registered, 'locked', g.locked) order by g.name)
      from grouped g
  ), '[]'::jsonb);
end;
$function$;

-- 2) Ações: rename (renomear ou juntar), delete, assign (escolher o almoxarifado).
create or replace function public.org_category_action(
  p_org uuid,
  p_action text,
  p_from text,
  p_to text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_from text := btrim(coalesce(p_from, ''));
  v_to text := btrim(coalesce(p_to, ''));
  v_items int := 0;
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_area uuid;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not public.is_org_admin(p_org) then
    raise exception 'Só um ADM da organização pode mexer nas categorias.' using errcode = '42501';
  end if;
  if v_from = '' then
    raise exception 'Categoria não informada.' using errcode = '22023';
  end if;

  if p_action = 'rename' then
    if v_to = '' or char_length(v_to) > 60 then
      raise exception 'Informe o novo nome (até 60 caracteres).' using errcode = '22023';
    end if;
    if upper(v_from) <> upper(v_to) and exists (
      select 1 from public.item_categories c join public.workspaces w on w.id = c.workspace_id
       where w.organization_id = p_org and upper(btrim(c.name)) = upper(v_from) and c.locked
    ) then
      raise exception 'A categoria "%" é travada e não pode ser renomeada.', v_from using errcode = 'P0001';
    end if;

    -- Itens.
    update public.items i set category = v_to
      from public.workspaces w
     where w.id = i.workspace_id and w.organization_id = p_org
       and upper(btrim(i.category)) = upper(v_from) and i.category is distinct from v_to;
    get diagnostics v_items = row_count;

    -- Lista cadastrada (por workspace): se o destino já existe, a origem sai; senão, troca o nome.
    for v_ws in select w.id from public.workspaces w where w.organization_id = p_org loop
      if upper(v_from) <> upper(v_to) and exists (
        select 1 from public.item_categories c where c.workspace_id = v_ws and upper(btrim(c.name)) = upper(v_to)
      ) then
        delete from public.item_categories c where c.workspace_id = v_ws and upper(btrim(c.name)) = upper(v_from);
      else
        update public.item_categories c set name = v_to where c.workspace_id = v_ws and upper(btrim(c.name)) = upper(v_from);
      end if;
    end loop;

    -- Almoxarifados: troca o nome e tira repetidos.
    update public.stock_areas a
       set categories = (
             select coalesce(array_agg(x.n order by x.ord), '{}')
               from (
                 select distinct on (upper(n)) n, ord
                   from unnest(array(
                          select case when upper(btrim(c)) = upper(v_from) then v_to else c end
                            from unnest(a.categories) c
                        )) with ordinality as t(n, ord)
                  order by upper(n), ord
               ) x
           ),
           updated_at = now()
     where a.organization_id = p_org
       and exists (select 1 from unnest(a.categories) c where upper(btrim(c)) = upper(v_from));

    return jsonb_build_object('items', v_items);

  elsif p_action = 'delete' then
    select count(*) into v_items
      from public.items i join public.workspaces w on w.id = i.workspace_id
     where w.organization_id = p_org and upper(btrim(i.category)) = upper(v_from) and i.archived_at is null;
    if v_items > 0 then
      raise exception 'A categoria "%" ainda tem % item(ns). Mova os itens para outra categoria antes de apagar.', v_from, v_items
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.item_categories c join public.workspaces w on w.id = c.workspace_id
       where w.organization_id = p_org and upper(btrim(c.name)) = upper(v_from) and c.locked
    ) then
      raise exception 'A categoria "%" é travada e não pode ser apagada.', v_from using errcode = 'P0001';
    end if;
    delete from public.item_categories c using public.workspaces w
     where w.id = c.workspace_id and w.organization_id = p_org and upper(btrim(c.name)) = upper(v_from);
    update public.stock_areas a
       set categories = array(select c from unnest(a.categories) c where upper(btrim(c)) <> upper(v_from)),
           updated_at = now()
     where a.organization_id = p_org
       and exists (select 1 from unnest(a.categories) c where upper(btrim(c)) = upper(v_from));
    return jsonb_build_object('items', 0);

  elsif p_action = 'assign' then
    -- p_to = id do almoxarifado (vazio = nenhum). Uma categoria fica em um almoxarifado só.
    if v_to <> '' then
      v_area := v_to::uuid;
      if not exists (select 1 from public.stock_areas a where a.id = v_area and a.organization_id = p_org) then
        raise exception 'Almoxarifado não encontrado.' using errcode = 'P0002';
      end if;
    end if;
    update public.stock_areas a
       set categories = array(select c from unnest(a.categories) c where upper(btrim(c)) <> upper(v_from)),
           updated_at = now()
     where a.organization_id = p_org and (v_area is null or a.id <> v_area)
       and exists (select 1 from unnest(a.categories) c where upper(btrim(c)) = upper(v_from));
    if v_area is not null then
      update public.stock_areas a
         set categories = a.categories || v_from, updated_at = now()
       where a.id = v_area
         and not exists (select 1 from unnest(a.categories) c where upper(btrim(c)) = upper(v_from));
    end if;
    -- Garante a categoria na lista cadastrada.
    for v_ws in select w.id from public.workspaces w where w.organization_id = p_org and w.archived_at is null loop
      if not exists (select 1 from public.item_categories c where c.workspace_id = v_ws and upper(btrim(c.name)) = upper(v_from)) then
        insert into public.item_categories (name, locked, user_id, workspace_id) values (v_from, false, v_uid, v_ws);
      end if;
    end loop;
    return jsonb_build_object('items', 0);
  end if;

  raise exception 'Ação inválida.' using errcode = '22023';
end;
$function$;

revoke all on function public.org_category_action(uuid, text, text, text) from public, anon;
grant execute on function public.org_category_action(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
