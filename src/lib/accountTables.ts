/**
 * Todas as tabelas de dados do workspace, numa lista única, na ordem de
 * restauração (referenciado antes de quem referencia).
 * Usada pelo backup/restauração (sempre do workspace atual). O "Zerar dados" apaga
 * as mesmas tabelas em supabase/etapa5_organizacoes_workspaces.sql — ao criar uma
 * tabela nova com workspace_id, acrescente-a nos DOIS lugares.
 */
export type AccountTable = {
  table: string;
  /** Coluna de autor da linha (quem criou / quem fez). */
  ownerColumn: 'user_id' | 'performed_by';
  /** Chave usada no upsert da restauração (padrão: id). */
  onConflict?: string;
  /** Colunas para ordenação estável na paginação (padrão: ['id']). */
  orderBy?: readonly string[];
  /** Colunas que existiam em backups antigos e foram removidas do banco (ignoradas na restauração). */
  removedColumns?: readonly string[];
};

export const ACCOUNT_TABLES_RESTORE_ORDER: readonly AccountTable[] = [
  { table: 'item_categories', ownerColumn: 'user_id' },
  { table: 'employees', ownerColumn: 'user_id' },
  { table: 'items', ownerColumn: 'user_id' },
  { table: 'work_sites', ownerColumn: 'user_id' },
  { table: 'rental_suppliers', ownerColumn: 'user_id' },
  { table: 'purchase_orders', ownerColumn: 'user_id', removedColumns: ['kanban_column_id'] },
  { table: 'possession', ownerColumn: 'user_id', onConflict: 'employee_id,item_id' },
  { table: 'site_possession', ownerColumn: 'user_id', onConflict: 'site_id,item_id', orderBy: ['site_id', 'item_id'] },
  { table: 'movements', ownerColumn: 'performed_by' },
  { table: 'equipment_rentals', ownerColumn: 'user_id' },
  { table: 'inventory_counts', ownerColumn: 'user_id' },
  { table: 'inventory_count_lines', ownerColumn: 'user_id' },
  { table: 'mural_notes', ownerColumn: 'user_id' },
];
