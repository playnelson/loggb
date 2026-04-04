-- Mural de post-its na página inicial (aba Mural). Execute no SQL Editor do Supabase (uma vez).

create table if not exists public.mural_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  color text not null default 'yellow',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mural_notes_color_check check (color in ('yellow', 'mint', 'pink', 'sky'))
);

create index if not exists mural_notes_user_sort_idx on public.mural_notes (user_id, sort_order, created_at);

comment on table public.mural_notes is 'Lembretes do almoxarifado — mural de post-its na home.';

alter table public.mural_notes enable row level security;

drop policy if exists "mural_notes_select_own" on public.mural_notes;
create policy "mural_notes_select_own"
on public.mural_notes for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "mural_notes_insert_own" on public.mural_notes;
create policy "mural_notes_insert_own"
on public.mural_notes for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "mural_notes_update_own" on public.mural_notes;
create policy "mural_notes_update_own"
on public.mural_notes for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "mural_notes_delete_own" on public.mural_notes;
create policy "mural_notes_delete_own"
on public.mural_notes for delete to authenticated
using (auth.uid() = user_id);
