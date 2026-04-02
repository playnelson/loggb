-- TAG padrão do cadastro do item (distinta da TAG por movimentação em retiradas de item único).
alter table public.items
  add column if not exists tag text;

comment on column public.items.tag is 'Identificador ou observação fixa do item no cadastro (opcional).';
