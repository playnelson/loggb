-- Correção de segurança (auditoria 2026-11-10).
-- Remove políticas que expunham dados entre contas e fecha funções de estoque abertas.
-- Compatível com a versão ATUAL do app (não precisa esperar deploy).

begin;

-- 1) items: qualquer pessoa (mesmo sem login) lia todos os itens de todas as contas,
--    e qualquer usuário logado podia alterar/apagar itens de outras contas.
drop policy if exists "Allow public read on items" on public.items;
drop policy if exists "Allow authenticated insert/update on items" on public.items;
-- Fica valendo: "Users can only see their own items" (ALL, auth.uid() = user_id).

-- 2) employees: qualquer usuário logado lia todos os colaboradores (nome, CPF) de todas as contas.
drop policy if exists "Allow authenticated read on employees" on public.employees;
-- Fica valendo: "Users can only see their own employees" (ALL, auth.uid() = user_id).

-- 3) update_stock: era SECURITY DEFINER (ignora RLS) e executável sem login →
--    qualquer pessoa na internet podia alterar o saldo de qualquer item.
--    Passa a respeitar RLS e só usuários logados podem chamar.
alter function public.update_stock(uuid, integer) security invoker;
alter function public.update_stock(uuid, integer) set search_path = public;
revoke execute on function public.update_stock(uuid, integer) from public, anon;
grant execute on function public.update_stock(uuid, integer) to authenticated;

-- 4) increment_stock / decrement_stock (não usadas pelo app): fecha para anônimos.
alter function public.increment_stock(uuid, integer) set search_path = public;
alter function public.decrement_stock(uuid, integer) set search_path = public;
revoke execute on function public.increment_stock(uuid, integer) from public, anon;
revoke execute on function public.decrement_stock(uuid, integer) from public, anon;

commit;
