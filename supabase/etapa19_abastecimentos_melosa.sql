-- Etapa 19: Abastecimentos — foto do veículo, localização do posto, melosa (comboio),
-- transferência tanque -> melosa e medição (contagem) do tanque. Continua só ADM (fuel_can_access).

-- 1) Foto do veículo (arquivo na pasta privada "fuel-photos", dentro da pasta do workspace).
alter table public.fuel_vehicles add column if not exists photo_path text;
alter table public.fuel_vehicles drop constraint if exists fuel_vehicles_photo_in_ws;
alter table public.fuel_vehicles add constraint fuel_vehicles_photo_in_ws
  check (photo_path is null or (photo_path like workspace_id::text || '/%' and char_length(photo_path) <= 400));

-- 2) Localização do posto (endereço ou link do mapa) e o novo tipo "comboio" (melosa).
alter table public.fuel_sources add column if not exists location text
  check (location is null or char_length(location) <= 500);
alter table public.fuel_sources drop constraint if exists fuel_sources_kind_check;
alter table public.fuel_sources add constraint fuel_sources_kind_check
  check (kind in ('posto', 'tanque', 'comboio'));

-- 3) Entrada com origem = transferência de outro tanque/melosa (sem origem = compra).
alter table public.fuel_tank_entries add column if not exists from_source_id uuid;
alter table public.fuel_tank_entries drop constraint if exists fuel_tank_entries_from_fk;
alter table public.fuel_tank_entries add constraint fuel_tank_entries_from_fk
  foreign key (from_source_id, workspace_id) references public.fuel_sources (id, workspace_id) on delete restrict;
alter table public.fuel_tank_entries drop constraint if exists fuel_tank_entries_from_not_self;
alter table public.fuel_tank_entries add constraint fuel_tank_entries_from_not_self
  check (from_source_id is null or from_source_id <> tank_id);
create index if not exists fuel_tank_entries_from_idx on public.fuel_tank_entries (from_source_id)
  where from_source_id is not null;

-- Destino e origem precisam ser tanque ou melosa (posto não guarda saldo).
create or replace function public.fuel_tank_entries_check()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.fuel_sources s
                 where s.id = new.tank_id and s.kind in ('tanque', 'comboio')) then
    raise exception 'A entrada precisa ser num tanque ou melosa.' using errcode = '23514';
  end if;
  if new.from_source_id is not null and not exists (
       select 1 from public.fuel_sources s
       where s.id = new.from_source_id and s.kind in ('tanque', 'comboio')) then
    raise exception 'A transferência precisa sair de um tanque ou melosa.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists fuel_tank_entries_check on public.fuel_tank_entries;
create trigger fuel_tank_entries_check before insert or update on public.fuel_tank_entries
  for each row execute function public.fuel_tank_entries_check();

-- 4) Medição do tanque/melosa: litros medidos x saldo do sistema naquele momento.
--    Se "adjust", a diferença passa a valer no saldo (acerta perdas/sobras).
create table if not exists public.fuel_tank_counts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  tank_id uuid not null,
  count_date date not null default current_date,
  measured_liters numeric not null check (measured_liters >= 0),
  system_liters numeric not null,
  adjust boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (tank_id, workspace_id) references public.fuel_sources (id, workspace_id) on delete restrict
);
create index if not exists fuel_tank_counts_tank_idx on public.fuel_tank_counts (tank_id, count_date desc);

alter table public.fuel_tank_counts enable row level security;
drop policy if exists fuel_all on public.fuel_tank_counts;
create policy fuel_all on public.fuel_tank_counts for all to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.fuel_can_access()))
  with check (workspace_id = (select public.current_workspace_id()) and (select public.fuel_can_access()));
grant select, insert, update, delete on public.fuel_tank_counts to authenticated;

-- 5) Pasta privada das fotos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fuel-photos', 'fuel-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists fuel_photos_read on storage.objects;
create policy fuel_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'fuel-photos'
         and (storage.foldername(name))[1] = (select public.current_workspace_id())::text
         and (select public.fuel_can_access()));

drop policy if exists fuel_photos_insert on storage.objects;
create policy fuel_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fuel-photos'
              and (storage.foldername(name))[1] = (select public.current_workspace_id())::text
              and (select public.fuel_can_access()));

drop policy if exists fuel_photos_delete on storage.objects;
create policy fuel_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fuel-photos'
         and (storage.foldername(name))[1] = (select public.current_workspace_id())::text
         and (select public.fuel_can_access()));

notify pgrst, 'reload schema';
