-- Etapa 20: foto do item do almoxarifado.
-- Arquivo na pasta privada "item-photos", sempre dentro da pasta do workspace: <workspace_id>/itens/<item>-<hora>.jpg

alter table public.items add column if not exists photo_path text;
alter table public.items drop constraint if exists items_photo_in_ws;
alter table public.items add constraint items_photo_in_ws
  check (photo_path is null or (photo_path like workspace_id::text || '/%' and char_length(photo_path) <= 400));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-photos', 'item-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Ver: qualquer pessoa do workspace atual.
drop policy if exists item_photos_read on storage.objects;
create policy item_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'item-photos'
         and (storage.foldername(name))[1] = (select public.current_workspace_id())::text);

-- Enviar e apagar: só quem pode editar o workspace atual (as mesmas pessoas que editam itens).
drop policy if exists item_photos_insert on storage.objects;
create policy item_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'item-photos'
              and (storage.foldername(name))[1] = (select public.current_workspace_id())::text
              and (select public.current_workspace_can_write()));

drop policy if exists item_photos_delete on storage.objects;
create policy item_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'item-photos'
         and (storage.foldername(name))[1] = (select public.current_workspace_id())::text
         and (select public.current_workspace_can_write()));

notify pgrst, 'reload schema';
