-- Etapa 21: grupos de itens criados pelos usuários (ex.: "BOTINAS", "RÁDIOS").
-- O grupo é só um nome no item: itens com o mesmo nome de grupo aparecem juntos no almoxarifado.
-- Quem pode editar o item (regras de items) pode pôr ou tirar o item de um grupo.

alter table public.items add column if not exists group_name text;
alter table public.items drop constraint if exists items_group_name_len;
alter table public.items add constraint items_group_name_len
  check (group_name is null or (btrim(group_name) <> '' and char_length(group_name) <= 80));

create index if not exists items_group_name_idx on public.items (workspace_id, upper(group_name))
  where group_name is not null;

notify pgrst, 'reload schema';
