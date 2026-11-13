/**
 * Cargos e áreas (supabase/etapa9_cargos_areas.sql).
 *
 * Cargo = o que a pessoa pode fazer. Área = parte do estoque que ela gerencia.
 * O banco confere tudo; aqui ficam só os nomes e as contas para as telas.
 */

export type Permission =
  | 'colaboradores'
  | 'compras'
  | 'alugueis'
  | 'cadastros'
  | 'inventario'
  | 'mural'
  | 'exclusoes_aprovar';

export const PERMISSIONS: { key: Permission; label: string; hint: string }[] = [
  { key: 'colaboradores', label: 'Colaboradores', hint: 'Cadastrar e editar colaboradores' },
  { key: 'compras', label: 'Compras', hint: 'Ordens de compra e recebimento' },
  { key: 'alugueis', label: 'Aluguéis', hint: 'Equipamentos alugados e fornecedores' },
  { key: 'cadastros', label: 'Locais e categorias', hint: 'Sedes, canteiros e categorias de itens' },
  { key: 'inventario', label: 'Inventário', hint: 'Abrir e fazer contagens de estoque' },
  { key: 'mural', label: 'Mural', hint: 'Recados no mural da tela inicial' },
  { key: 'exclusoes_aprovar', label: 'Aprovar exclusões', hint: 'Aprova ou recusa pedidos de exclusão (próxima etapa)' },
];

export const PERMISSION_LABEL: Record<Permission, string> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, p.label])
) as Record<Permission, string>;

export type AccessArea = { id: string; name: string; categories: string[] };

/** O que a pessoa logada pode fazer no workspace atual (RPC my_access). */
export type MyAccess = {
  organization_id: string;
  is_adm: boolean;
  cargo_id: string | null;
  cargo_name: string | null;
  permissions: Permission[];
  /** ADM também vem com true. */
  all_areas: boolean;
  areas: AccessArea[];
};

export type OrgRoleRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  system_key: string | null;
  sort: number;
};

export type StockAreaRow = {
  id: string;
  organization_id: string;
  name: string;
  categories: string[];
};

export type PersonRow = {
  user_id: string;
  email: string;
  role: string;
  is_adm: boolean;
  is_creator: boolean;
  cargo_id: string | null;
  all_areas: boolean;
  area_ids: string[];
  workspace_scope: string[] | null;
  expires_at: string | null;
  created_at: string;
};

export type OrgCategory = { name: string; items: number; spellings: string[] };

export function normCategory(s: string | null | undefined): string {
  return String(s ?? '').trim().toUpperCase();
}

/** A pessoa gerencia a área deste item? (mesma conta do banco) */
export function accessManagesCategory(access: MyAccess | null, category: string | null | undefined): boolean {
  if (!access) return true; // banco ainda sem a etapa 9: segue como antes
  if (access.is_adm || access.all_areas) return true;
  const k = normCategory(category);
  if (!k) return false;
  return access.areas.some((a) => a.categories.some((c) => normCategory(c) === k));
}

/** Só consulta: não tem cargo com permissão nem área. */
export function accessIsReadOnly(access: MyAccess | null): boolean {
  if (!access) return false;
  return !access.is_adm && !access.all_areas && access.permissions.length === 0 && access.areas.length === 0;
}

/** Áreas cobertas por uma lista de categorias (comparação sem maiúsculas/minúsculas). */
export function categoriesLabel(categories: string[]): string {
  return categories.length ? categories.join(', ') : 'nenhuma categoria';
}
