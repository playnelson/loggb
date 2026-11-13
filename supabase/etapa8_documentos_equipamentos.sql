-- =============================================================================
-- Etapa 8: documentos anexados a equipamentos em posse
--
-- Ex.: rádio comunicador entregue a um colaborador -> anexa o termo de
-- responsabilidade assinado; na devolução -> anexa o termo de devolução.
-- Quem é do workspace (inclusive gestor, só leitura) pode baixar.
-- Só quem pode editar o workspace anexa ou apaga.
--
-- Arquivos: pasta privada "equipment-docs" no Storage, sempre dentro da pasta
-- do workspace: <workspace_id>/<colaborador ou geral>/<id>.<ext>
-- =============================================================================

-- 1) Registro de cada documento.
create table if not exists public.equipment_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id()
    references public.workspaces(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  movement_id uuid references public.movements(id) on delete set null,
  kind text not null default 'outro' check (kind in ('entrega', 'devolucao', 'outro')),
  file_name text not null check (char_length(file_name) between 1 and 200),
  storage_path text not null unique check (char_length(storage_path) <= 400),
  mime_type text check (mime_type is null or char_length(mime_type) <= 100),
  size_bytes bigint check (size_bytes is null or size_bytes between 0 and 15728640),
  note text check (note is null or char_length(note) <= 300),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- O arquivo precisa estar na pasta do próprio workspace.
  constraint equipment_documents_path_in_workspace check (storage_path like workspace_id::text || '/%')
);

create index if not exists equipment_documents_employee_idx
  on public.equipment_documents (workspace_id, employee_id, created_at desc);
create index if not exists equipment_documents_item_idx
  on public.equipment_documents (workspace_id, item_id, created_at desc);
create index if not exists equipment_documents_movement_idx
  on public.equipment_documents (movement_id) where movement_id is not null;

alter table public.equipment_documents enable row level security;

drop policy if exists workspace_read on public.equipment_documents;
create policy workspace_read on public.equipment_documents
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));

drop policy if exists workspace_insert on public.equipment_documents;
create policy workspace_insert on public.equipment_documents
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and (select public.current_workspace_can_write()));

drop policy if exists workspace_update on public.equipment_documents;
create policy workspace_update on public.equipment_documents
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and (select public.current_workspace_can_write()))
  with check (workspace_id = (select public.current_workspace_id())
              and (select public.current_workspace_can_write()));

drop policy if exists workspace_delete on public.equipment_documents;
create policy workspace_delete on public.equipment_documents
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and (select public.current_workspace_can_write()));

-- 2) Pasta privada para os arquivos (até 15 MB; PDF e fotos).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'equipment-docs', 'equipment-docs', false, 15728640,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Ler: qualquer pessoa do workspace atual (gestor incluído).
drop policy if exists equipment_docs_read on storage.objects;
create policy equipment_docs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'equipment-docs'
         and (storage.foldername(name))[1] = (select public.current_workspace_id())::text);

-- Enviar e apagar: só quem pode editar o workspace atual.
drop policy if exists equipment_docs_insert on storage.objects;
create policy equipment_docs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'equipment-docs'
              and (storage.foldername(name))[1] = (select public.current_workspace_id())::text
              and (select public.current_workspace_can_write()));

drop policy if exists equipment_docs_delete on storage.objects;
create policy equipment_docs_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'equipment-docs'
         and (storage.foldername(name))[1] = (select public.current_workspace_id())::text
         and (select public.current_workspace_can_write()));
