import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const RLS_MESSAGE = 'Seu acesso não permite essa alteração. Peça ao ADM da organização.';

/**
 * Troca a mensagem técnica de bloqueio do banco ("row-level security") por uma frase clara.
 * As mensagens dos cargos e áreas (etapa 9) já vêm em português e passam direto.
 */
const friendlyFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status !== 401 && res.status !== 403) return res;
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) return res;
  try {
    const body = (await res.clone().json()) as { code?: string; message?: string } | null;
    if (body && body.code === '42501' && /row-level security/i.test(String(body.message || ''))) {
      const headers = new Headers(res.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      return new Response(JSON.stringify({ ...body, message: RLS_MESSAGE }), {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    }
  } catch {
    // corpo não era JSON: devolve como veio
  }
  return res;
};

// Avoid crashing during build/prerender when envs are absent.
// In runtime, envs should be provided; otherwise app will fail on usage.
export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createBrowserClient(supabaseUrl, supabaseAnonKey, { global: { fetch: friendlyFetch } })
    : (null as unknown as ReturnType<typeof createBrowserClient>);
