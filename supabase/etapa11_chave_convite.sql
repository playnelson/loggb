-- =============================================================================
-- Etapa 11: chave curta do convite
--
-- Além do link, cada convite ganha uma chave de 8 letras/números
-- (ex.: K7QM-3XPA). Quem acabou de criar a conta cola a chave (ou o link)
-- na tela de boas-vindas e entra na organização, sem criar uma nova.
-- Sem letras que confundem (I, O, 0, 1).
-- =============================================================================

create or replace function public.gen_invite_code()
returns text language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 símbolos
  bytes bytea := extensions.gen_random_bytes(8);
  out text := '';
  i int;
begin
  for i in 0..7 loop
    out := out || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
  end loop;
  return out;
end;
$$;
-- O ADM cria o convite pelo app, então o valor padrão precisa rodar para quem está logado.
revoke all on function public.gen_invite_code() from public, anon;
grant execute on function public.gen_invite_code() to authenticated;

alter table public.organization_invites add column if not exists code text;
update public.organization_invites set code = public.gen_invite_code() where code is null;
alter table public.organization_invites alter column code set default public.gen_invite_code();
alter table public.organization_invites alter column code set not null;
create unique index if not exists organization_invites_code_key on public.organization_invites (code);

-- Chave (com ou sem traço, maiúscula ou minúscula) -> token do convite.
-- Devolve nulo se não existir. A página do convite mostra se está válido.
create or replace function public.invite_token_by_code(p_code text)
returns text language sql stable security definer set search_path = public as $$
  select i.token
    from public.organization_invites i
   where auth.uid() is not null
     and i.code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
   limit 1;
$$;
revoke all on function public.invite_token_by_code(text) from public, anon;
grant execute on function public.invite_token_by_code(text) to authenticated;
