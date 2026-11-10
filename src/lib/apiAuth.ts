import type { User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

/**
 * Garante que a requisição veio de um usuário logado.
 * O proxy (src/proxy.ts) NÃO cobre /api, então toda rota de API precisa chamar isto.
 *
 * Uso:
 *   const auth = await requireUser();
 *   if (!auth.ok) return auth.response;
 *   const user = auth.user;
 */
export async function requireUser(): Promise<
  { ok: true; user: User } | { ok: false; response: Response }
> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return {
        ok: false,
        response: Response.json({ error: 'Não autenticado.' }, { status: 401 }),
      };
    }
    return { ok: true, user };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: 'Não autenticado.' }, { status: 401 }),
    };
  }
}
