import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { ACCOUNT_TABLES_RESTORE_ORDER, type AccountTable } from '@/lib/accountTables';

type JsonObject = Record<string, unknown>;
type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const BACKUP_VERSION = 1;
/** O Supabase devolve no máximo 1000 linhas por consulta; paginamos abaixo disso. */
const PAGE_SIZE = 500;
/** Lotes para `.in(...)` e upsert, evitando URL/corpo grandes demais. */
const CHUNK = 100;

/** Só "tabela não existe" — coluna inexistente NÃO deve ser tratada como tabela ausente. */
function isTableMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string };
  const msg = String(e.message || '').toLowerCase();
  return e.code === '42P01' || e.code === 'PGRST205' || msg.includes('could not find the table');
}

function asObjectArray(input: unknown): JsonObject[] {
  if (!Array.isArray(input)) return [];
  return input.filter((row): row is JsonObject => typeof row === 'object' && row !== null);
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Lê todas as linhas (paginado) de uma consulta. */
async function selectAll(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<{ rows: JsonObject[]; error: unknown }> {
  const rows: JsonObject[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error };
    const page = asObjectArray(data);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { rows, error: null };
  }
}

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : 'erro desconhecido';
}

function extractBackupPayload(body: unknown): { data: Record<string, JsonObject[]>; replaceExisting: boolean } | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  const replaceExisting = Boolean(obj.replaceExisting);
  const backup = (obj.backup && typeof obj.backup === 'object' ? obj.backup : obj) as Record<string, unknown>;
  if (backup.version !== BACKUP_VERSION) return null;
  if (!backup.data || typeof backup.data !== 'object') return null;
  const parsed: Record<string, JsonObject[]> = {};
  for (const [table, rows] of Object.entries(backup.data as Record<string, unknown>)) {
    parsed[table] = asObjectArray(rows);
  }
  return { data: parsed, replaceExisting };
}

async function upsertRows(supabase: Supa, t: AccountTable | { table: string; onConflict?: string }, rows: JsonObject[]) {
  for (const part of chunks(rows, CHUNK)) {
    const res = await supabase.from(t.table).upsert(part, { onConflict: t.onConflict ?? 'id', ignoreDuplicates: false });
    if (res.error) return res;
  }
  return { error: null };
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

    for (const t of ACCOUNT_TABLES_RESTORE_ORDER) {
      const { rows, error } = await selectAll((from, to) => {
        let q = supabase.from(t.table).select('*').eq(t.ownerColumn, user.id);
        for (const col of t.orderBy ?? ['id']) q = q.order(col, { ascending: true });
        return q.range(from, to);
      });
      if (error) {
        if (isTableMissingError(error)) {
          warnings.push(`Tabela não encontrada e ignorada: ${t.table}.`);
          data[t.table] = [];
          continue;
        }
        return NextResponse.json(
          { error: `Falha ao exportar a tabela ${t.table}: ${errorMessage(error)}` },
          { status: 500 }
        );
      }
      data[t.table] = rows;
    }

    // Itens das ordens de compra (não têm user_id próprio; pertencem à ordem).
    const orderIds = (data.purchase_orders ?? [])
      .map((row) => (typeof row.id === 'string' ? row.id : null))
      .filter((id): id is string => Boolean(id));

    data.purchase_order_items = [];
    for (const ids of chunks(orderIds, CHUNK)) {
      const { rows, error } = await selectAll((from, to) =>
        supabase.from('purchase_order_items').select('*').in('purchase_order_id', ids).order('id', { ascending: true }).range(from, to)
      );
      if (error) {
        if (isTableMissingError(error)) {
          warnings.push('Tabela não encontrada e ignorada: purchase_order_items.');
          break;
        }
        return NextResponse.json(
          { error: `Falha ao exportar a tabela purchase_order_items: ${errorMessage(error)}` },
          { status: 500 }
        );
      }
      data.purchase_order_items.push(...rows);
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
      // Mesma rotina do "Zerar conta": apaga tudo numa transação no banco.
      const { error: resetError } = await supabase.rpc('reset_my_account_data');
      if (resetError) {
        return NextResponse.json(
          { error: `Falha ao limpar dados atuais: ${resetError.message}` },
          { status: 500 }
        );
      }
    }

    for (const t of ACCOUNT_TABLES_RESTORE_ORDER) {
      // O dono passa a ser SEMPRE o usuário logado (permite migrar para outra conta).
      const rows = asObjectArray(data[t.table] ?? []).map((row) => ({ ...row, [t.ownerColumn]: user.id }));
      if (rows.length === 0) {
        importedCounts[t.table] = 0;
        continue;
      }
      const res = await upsertRows(supabase, t, rows);
      if (res.error) {
        if (isTableMissingError(res.error)) {
          warnings.push(`Tabela ausente na importação e ignorada: ${t.table}.`);
          importedCounts[t.table] = 0;
          continue;
        }
        return NextResponse.json(
          { error: `Falha ao importar tabela ${t.table}: ${errorMessage(res.error)}` },
          { status: 500 }
        );
      }
      importedCounts[t.table] = rows.length;
    }

    const poItems = asObjectArray(data.purchase_order_items ?? []);
    if (poItems.length > 0) {
      const res = await upsertRows(supabase, { table: 'purchase_order_items' }, poItems);
      if (res.error && !isTableMissingError(res.error)) {
        return NextResponse.json(
          { error: `Falha ao importar tabela purchase_order_items: ${errorMessage(res.error)}` },
          { status: 500 }
        );
      }
    }
    importedCounts.purchase_order_items = poItems.length;

    return NextResponse.json({ ok: true, importedCounts, warnings, replaceExisting });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado ao importar backup.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
