-- O código interno do item (items.code) é gerado a partir da descrição.
-- Ele era único no banco INTEIRO: se uma conta tinha "LUVA DE VAQUETA", nenhuma outra
-- conta conseguia cadastrar um item com essa mesma descrição (erro items_code_key).
-- Passa a ser único POR CONTA.

alter table public.items drop constraint if exists items_code_key;
alter table public.items add constraint items_user_code_key unique (user_id, code);
