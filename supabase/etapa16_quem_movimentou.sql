-- Etapa 16: nome de quem registrou cada movimentação (movements.performed_by).
-- Só devolve nomes de usuários que fizeram movimentações no almoxarifado atual de quem pergunta.
-- Nome: colaborador vinculado ao acesso > nome do cadastro > início do e-mail.
create or replace function public.movement_actor_names(p_ids uuid[])
returns table (user_id uuid, name text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select u.id,
         coalesce(
           nullif(btrim(e.full_name), ''),
           nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data->>'name'), ''),
           split_part(u.email, '@', 1)
         )
    from auth.users u
    left join public.workspaces w on w.id = public.current_workspace_id()
    left join public.organization_members om on om.user_id = u.id and om.organization_id = w.organization_id
    left join public.employees e on e.id = om.employee_id
   where u.id = any (p_ids)
     and exists (
       select 1 from public.movements m
        where m.performed_by = u.id and m.workspace_id = public.current_workspace_id()
     );
$function$;

revoke all on function public.movement_actor_names(uuid[]) from public, anon;
grant execute on function public.movement_actor_names(uuid[]) to authenticated;

notify pgrst, 'reload schema';
