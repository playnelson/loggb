/**
 * Todas as tabelas com dono (dados da conta), numa lista única, na ordem de
 * restauração (referenciado antes de quem referencia).
 * Usada pelo backup/restauração. O "Zerar conta" apaga as mesmas tabelas em
 * supabase/reset_account_data.sql — ao criar uma tabela nova com user_id,
 * acrescente-a nos DOIS lugares.
 */
export type AccountTable = {
  table: string;
  /** Coluna que identifica o dono da linha. */
  ownerColumn: 'user_id' | 'performed_by';
  /** Chave usada no upsert da restauração (padrão: id). */
  onConflict?: string;
  /** Colunas para ordenação estável na paginação (padrão: ['id']). */
  orderBy?: readonly string[];
};

export const ACCOUNT_TABLES_RESTORE_ORDER: readonly AccountTable[] = [
  { table: 'item_categories', ownerColumn: 'user_id' },
  { table: 'kanban_columns', ownerColumn: 'user_id' },
  { table: 'employees', ownerColumn: 'user_id' },
  { table: 'items', ownerColumn: 'user_id' },
  { table: 'work_sites', ownerColumn: 'user_id' },
  { table: 'rental_suppliers', ownerColumn: 'user_id' },
  { table: 'purchase_orders', ownerColumn: 'user_id' },
  { table: 'purchase_requests', ownerColumn: 'user_id' },
  { table: 'possession', ownerColumn: 'user_id', onConflict: 'employee_id,item_id' },
  { table: 'site_possession', ownerColumn: 'user_id', onConflict: 'site_id,item_id', orderBy: ['site_id', 'item_id'] },
  { table: 'movements', ownerColumn: 'performed_by' },
  { table: 'equipment_rentals', ownerColumn: 'user_id' },
  { table: 'mural_notes', ownerColumn: 'user_id' },
  { table: 'dashboard_reminders', ownerColumn: 'user_id' },
  { table: 'finance_account_templates', ownerColumn: 'user_id' },
  { table: 'finance_accounts', ownerColumn: 'user_id' },
  { table: 'finance_assets', ownerColumn: 'user_id' },
  { table: 'finance_fuel_logs', ownerColumn: 'user_id' },
  { table: 'finance_expenses', ownerColumn: 'user_id' },
];
