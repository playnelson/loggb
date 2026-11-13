'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Mail, Lock, LogIn, Loader2 } from 'lucide-react';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isLimitExceededMessage(message: string) {
  const msg = message.toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('limite') ||
    msg.includes('excedido') ||
    msg.includes('over_email_send_rate_limit')
  );
}

/** Volta para a página pedida antes do login (ex.: item aberto pelo QR). Só caminhos internos. */
function safeNextPath(): string {
  try {
    const next = new URLSearchParams(window.location.search).get('next') || '';
    if (next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !next.startsWith('/login')) return next;
  } catch {
    // ignora
  }
  return '/';
}

function isInviteNext(): boolean {
  if (typeof window === 'undefined') return false;
  return safeNextPath().startsWith('/convite/');
}

/** Mensagens do login em português (o Supabase responde em inglês). */
function authMessage(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('anonymous sign-ins are disabled') || m.includes('missing email')) return 'Preencha o e-mail.';
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme o e-mail pelo link que enviamos antes de entrar.';
  if (m.includes('user already registered') || m.includes('already been registered'))
    return 'Este e-mail já tem conta. Use "Entrar" com a sua senha.';
  if (m.includes('password should be at least') || m.includes('weak password')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (m.includes('unable to validate email') || m.includes('invalid email') || m.includes('email address') && m.includes('invalid'))
    return 'E-mail inválido. Confira o endereço digitado.';
  return msg;
}

function checkFields(email: string, password: string): string | null {
  if (!email.trim()) return 'Preencha o e-mail.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'E-mail inválido. Confira o endereço digitado.';
  if (password.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.';
  return null;
}

export default function LoginPage() {
  const [fromInvite, setFromInvite] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    // Lê o endereço só no navegador (evita diferença entre servidor e navegador).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFromInvite(isInviteNext());
    const isConfirm = new URLSearchParams(window.location.search).get('confirmado') === '1';
    setConfirmed(isConfirm);
    if (!isConfirm) return;
    // Veio do link de confirmação do e-mail: se a sessão já abriu, segue direto (ex.: convite).
    const t = setTimeout(() => {
      void (async () => {
        const { data } = await supabase.auth.getSession();
        if (data.session) window.location.replace(safeNextPath());
      })();
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = checkFields(email, password);
    if (invalid) {
      setError(invalid);
      return;
    }
    setLoading(true);
    setError(null);

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (loginError) {
      console.error('Login error details:', loginError);
      setError(authMessage(loginError.message));
      setLoading(false);
    } else {
      // Force a tiny delay for cookies to settle on client before hitting the edge proxy
      setTimeout(() => {
        window.location.replace(safeNextPath());
      }, 500);
    }
  };

  const handleSignUp = async () => {
    const invalid = checkFields(email, password);
    if (invalid) {
      setError(invalid);
      return;
    }
    setLoading(true);
    setError(null);

    let signUpError: { message: string } | null = null;
    let hasSession = false;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const next = safeNextPath();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // O link do e-mail volta para o LoggB, que avisa "e-mail confirmado" e segue (ex.: convite).
          emailRedirectTo: `${window.location.origin}/login?confirmado=1${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`,
        },
      });

      if (!error) {
        signUpError = null;
        hasSession = !!data.session;
        break;
      }

      signUpError = error;

      if (!isLimitExceededMessage(error.message) || attempt === maxAttempts) {
        break;
      }

      // Quando o provedor limita tentativas/requests, aguarda e tenta novamente.
      await wait(attempt * 1200);
    }

    if (signUpError) {
      if (isLimitExceededMessage(signUpError.message)) {
        setError('Limite temporário de criação atingido. Aguarde 1 minuto e tente novamente.');
      } else {
        setError(authMessage(signUpError.message));
      }
    } else if (hasSession) {
      // Conta criada e já logada: segue direto (ex.: abre o convite).
      window.location.replace(safeNextPath());
      return;
    } else {
      setError('Conta criada. Abra o link que enviamos para o seu e-mail e depois clique em "Entrar".');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-[100dvh] bg-background flex items-stretch pb-[env(safe-area-inset-bottom)]">
      <aside className="hidden lg:flex w-[42%] max-w-[560px] bg-bar text-white flex-col justify-between p-10 xl:p-14">
        <div>
          <p className="text-3xl font-extrabold tracking-tight">
            LOGG<span className="text-accent">B</span>
          </p>
          <p className="text-sm text-slate-400 mt-1">Estoque e Suprimentos</p>
        </div>
        <div className="space-y-5">
          <h2 className="text-2xl font-semibold leading-snug text-white">
            Estoque, compras e equipe de cada obra no mesmo lugar.
          </h2>
          <ul className="space-y-3 text-sm text-slate-300">
            <li className="flex items-start gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 bg-accent" aria-hidden />
              Saldos, retiradas e inventário por canteiro, cidade ou sede
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 bg-accent" aria-hidden />
              Ordens de compra com recebimento direto no estoque
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 bg-accent" aria-hidden />
              Gestores convidados acompanham o estoque só para consulta
            </li>
          </ul>
        </div>
        <p className="text-xs text-slate-500">Acesso restrito a usuários autorizados.</p>
      </aside>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="max-w-sm w-full">
          <div className="lg:hidden text-center mb-6">
            <p className="text-3xl font-extrabold tracking-tight text-primary">
              LOGG<span className="text-secondary">B</span>
            </p>
            <p className="text-slate-500 mt-1 text-sm">Estoque e Suprimentos</p>
          </div>
          {confirmed ? (
            <div className="mb-4 rounded border border-green-200 border-l-[3px] border-l-green-600 bg-green-50 p-3 text-sm text-green-900">
              <b>E-mail confirmado!</b> Sua conta no LoggB está ativa. Entre com o seu e-mail e senha
              {fromInvite ? ' para abrir o convite.' : '.'}
            </div>
          ) : null}
          {fromInvite && !confirmed ? (
            <div className="mb-4 rounded border border-amber-200 border-l-[3px] border-l-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
              Você recebeu um convite. Entre com sua conta ou crie uma (e-mail e senha) para abrir o convite.
            </div>
          ) : null}

          <div className="bg-white border border-border border-t-[3px] border-t-secondary shadow-md">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h1 className="text-base font-bold text-primary">Acesse sua conta</h1>
              <p className="text-xs text-slate-500">Entre com o e-mail e a senha cadastrados.</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4 p-6">
              <div className="space-y-1">
                <label htmlFor="login-email" className="text-xs font-semibold text-slate-600 block">
                  E-mail
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="seu@email.com"
                    className="w-full pl-9 pr-3 py-2.5 text-sm"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="login-password" className="text-xs font-semibold text-slate-600 block">
                  Senha
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2.5 text-sm"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 border-l-[3px] border-l-red-500 p-3">
                  {error}
                </p>
              )}

              <div className="pt-1 flex flex-col gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-secondary text-white rounded font-semibold text-sm flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-60"
                >
                  {loading ? <Loader2 className="animate-spin" size={18} /> : <><LogIn size={18} /> Entrar</>}
                </button>

                <button
                  type="button"
                  onClick={handleSignUp}
                  disabled={loading}
                  className="w-full py-2.5 bg-white text-primary border border-slate-300 rounded font-semibold text-sm hover:bg-slate-100"
                >
                  Criar nova conta
                </button>
              </div>
            </form>
          </div>

          <p className="lg:hidden text-center text-slate-400 text-xs mt-6">Acesso restrito a usuários autorizados.</p>
        </div>
      </main>
    </div>
  );
}
