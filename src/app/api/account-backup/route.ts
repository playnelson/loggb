import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

type JsonObject = Record<string, unknown>;

const BACKUP_VERSION = 1;

const USER_SCOPED_TABLES = [
  'item_categories',
  'employees',
  'items',
  'work_sites',
  'movements',
  'possession',
  'site_possession',
  'rental_suppliers',
  'equipment_rentals',
  'mural_notes',
  'dashboard_reminders',
  'purchase_orders',
] as const;

const IMPORT_UPSERT_ORDER = [
  'item_categories',
  'employees',
  'items',
  'work_sites',
  'rental_suppliers',
  'purchase_orders',
  'possession',
  'site_possession',
  'movements',
  'equipment_rentals',
  'mural_notes',
  'dashboard_reminders',
  'purchase_order_items',
] as const;

const DELETE_ORDER = [
  'purchase_orders',
  'equipment_rentals',
  'site_possession',
  'possession',
  'movements',
  'rental_suppliers',
  'work_sites',
  'items',
  'employees',
  'item_categories',
  'mural_notes',
  'dashboard_reminders',
] as const;

const ON_CONFLICT_BY_TABLE: Partial<Record<string, string>> = {
  possession: 'employee_id,item_id',
  site_possession: 'site_id,item_id',
};

function isTableMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: string; message?: string };
  const msg = String(maybeError.message || '').toLowerCase();
  return maybeError.code === '42P01' || msg.includes('does not exist') || msg.includes('relation');
}

function asObjectArray(input: unknown): JsonObject[] {
  if (!Array.isArray(input)) return [];
  return input.filter((row): row is JsonObject => typeof row === 'object' && row !== null);
}

function forceUserId(rows: JsonObject[], userId: string): JsonObject[] {
  return rows.map((row) => {
    if (!Object.prototype.hasOwnProperty.call(row, 'user_id')) return row;
    return { ...row, user_id: userId };
  });
}

function extractBackupPayload(body: unknown): { data: Record<string, JsonObject[]>; replaceExisting: boolean } | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  const replaceExisting = Boolean(obj.replaceExisting);
  const backup = (obj.backup && typeof obj.backup === 'object' ? obj.backup : obj) as Record<string, unknown>;
  const dataValue = backup.data;
  const version = backup.version;
  if (version !== BACKUP_VERSION) return null;
  if (!dataValue || typeof dataValue !== 'object') return null;
  const rawData = dataValue as Record<string, unknown>;
  const parsed: Record<string, JsonObject[]> = {};
  for (const [table, rows] of Object.entries(rawData)) {
    parsed[table] = asObjectArray(rows);
  }
  return { data: parsed, replaceExisting };
}

async function upsertRows(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: string,
  rows: JsonObject[]
) {
  if (rows.length === 0) return { error: null };
  const onConflict = ON_CONFLICT_BY_TABLE[table] ?? 'id';
  return supabase.from(table).upsert(rows, { onConflict, ignoreDuplicates: false });
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });
    }

    const warnings: string[] = [];
    const data: Record<string, JsonObject[]> = {};

    for (const table of USER_SCOPED_TABLES) {
      const query = await supabase.from(table).select('*').eq('user_id', user.id);
      if (query.error) {
        if (isTableMissingError(query.error)) {
          warnings.push(`Tabela não encontrada e ignorada: ${table}.`);
          data[table] = [];
          continue;
        }
        return NextResponse.json(
          { error: `Falha ao exportar a tabela ${table}: ${query.error.message}` },
          { status: 500 }
        );
      }
      data[table] = asObjectArray(query.data ?? []);
    }

    const orderIds = (data.purchase_orders ?? [])
      .map((row) => (typeof row.id === 'string' ? row.id : null))
      .filter((id): id is string => Boolean(id));

    if (orderIds.length > 0) {
      const itemsRes = await supabase.from('purchase_order_items').select('*').in('purchase_order_id', orderIds);
      if (itemsRes.error) {
        if (isTableMissingError(itemsRes.error)) {
          warnings.push('Tabela não encontrada e ignorada: purchase_order_items.');
          data.purchase_order_items = [];
        } else {
          return NextResponse.json(
            { error: `Falha ao exportar a tabela purchase_order_items: ${itemsRes.error.message}` },
            { status: 500 }
          );
        }
      } else {
        data.purchase_order_items = asObjectArray(itemsRes.data ?? []);
      }
    } else {
      data.purchase_order_items = [];
    }

    return NextResponse.json({
      version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      app: 'loggb',
      source_user_id: user.id,
      warnings,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado ao exportar backup.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = extractBackupPayload(body);
    if (!parsed) {
      return NextResponse.json(
        { error: 'Arquivo de backup inválido. Verifique a versão e o formato.' },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });
    }

    const warnings: string[] = [];
    const importedCounts: Record<string, number> = {};
    const { data, replaceExisting } = parsed;

    if (replaceExisting) {
      for (const table of DELETE_ORDER) {
        const delRes = await supabase.from(table).delete().eq('user_id', user.id);
        if (delRes.error) {
          if (isTableMissingError(delRes.error)) {
            warnings.push(`Tabela ausente no replace e ignorada: ${table}.`);
            continue;
          }
          return NextResponse.json(
            { error: `Falha ao limpar dados atuais na tabela ${table}: ${delRes.error.message}` },
            { status: 500 }
          );
        }
      }
    }

    for (const table of IMPORT_UPSERT_ORDER) {
      const rawRows = asObjectArray(data[table] ?? []);
      if (rawRows.length === 0) {
        importedCounts[table] = 0;
        continue;
      }
      const rows = table === 'purchase_order_items' ? rawRows : forceUserId(rawRows, user.id);
      const res = await upsertRows(supabase, table, rows);
      if (res.error) {
        if (isTableMissingError(res.error)) {
          warnings.push(`Tabela ausente na importação e ignorada: ${table}.`);
          importedCounts[table] = 0;
          continue;
        }
        return NextResponse.json(
          { error: `Falha ao importar tabela ${table}: ${res.error.message}` },
          { status: 500 }
        );
      }
      importedCounts[table] = rows.length;
    }

    return NextResponse.json({
      ok: true,
      importedCounts,
      warnings,
      replaceExisting,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado ao importar backup.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
