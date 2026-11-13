-- =============================================================================
-- Etapa 13: quem tem áreas do estoque só VÊ essas áreas
--
-- Antes: a pessoa mexia só nas áreas dela, mas via o estoque inteiro.
-- Agora, dentro do workspace atual:
--   * ADM ou "Todas as áreas"  -> vê tudo;
--   * com áreas marcadas       -> vê só os itens dessas categorias (e as
--                                 movimentações, carteiras, contagens,
--                                 documentos e aluguéis desses itens);
--   * sem nenhuma área         -> só consulta: vê tudo, sem mexer.
-- O resto continua igual: cada workspace só mostra os próprios dados.
-- =============================================================================

-- Categorias (em maiúsculas) que a pessoa vê no workspace atual. Nulo = todas.
create or replace function public.my_visible_categories()
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.current_member_access()) then '{}'::text[]
    else (
      select case
        when a.is_adm or a.all_areas then null
        when not exists (
          select 1 from public.stock_area_members am
           where am.organization_id = a.organization_id and am.user_id = a.user_id
        ) then null
        else coalesce((
          select array_agg(distinct upper(btrim(c)))
            from public.stock_area_members am
            join public.stock_areas sa on sa.id = am.area_id
            cross join lateral unnest(sa.categories) as c
           where am.organization_id = a.organization_id and am.user_id = a.user_id
        ), '{}'::text[])
      end
      from public.current_member_access() a
      limit 1
    )
  end;
$$;
revoke all on function public.my_visible_categories() from public, anon;
grant execute on function public.my_visible_categories() to authenticated;

-- Itens: só as categorias visíveis.
drop policy if exists workspace_read on public.items;
create policy workspace_read on public.items for select to authenticated
using (
  workspace_id = (select public.current_workspace_id())
  and (
    (select public.my_visible_categories()) is null
    or upper(btrim(coalesce(category, ''))) = any ((select public.my_visible_categories())::text[])
  )
);

-- Tabelas ligadas a um item: só as linhas de itens visíveis
-- (a consulta em items abaixo já passa pela regra de cima).
do $$
declare
  t text;
begin
  foreach t in array array['movements', 'possession', 'site_possession', 'inventory_count_lines',
                           'equipment_documents', 'equipment_rentals']
  loop
    execute format('drop policy if exists workspace_read on public.%I', t);
    execute format(
      'create policy workspace_read on public.%I for select to authenticated using (
         workspace_id = (select public.current_workspace_id())
         and (item_id is null
              or (select public.my_visible_categories()) is null
              or exists (select 1 from public.items i where i.id = %I.item_id))
       )', t, t);
  end loop;
end;
$$;
