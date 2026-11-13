'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, MailCheck } from 'lucide-react';

/** Telas do acesso: uma coisa de cada vez. */
type Mode = 'entrar' | 'criar' | 'esqueci' | 'confira' | 'nova-senha';

const RESEND_WAIT = 60;

function isLimitExceededMessage(message: string) {
  const msg = message.toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('limite') ||
    msg.includes('excedido') ||
    msg.includes('over_email_send_rate_limit') ||
    msg.includes('for security purposes')
  );
}

/** Volta para a página pedida antes do login (ex.: convite ou item aberto pelo QR). Só caminhos internos. */
function safeNextPath(): string {
  try {
    const next = new URLSearchParams(window.location.search).get('next') || '';
    if (next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !next.startsWith('/login')) return next;
  } catch {
    // ignora
  }
  return '/';
}

/** Endereço de volta do link do e-mail (confirmação), mantendo o convite. */
function confirmRedirect(): string {
  const next = safeNextPath();
  return `${window.location.origin}/login?confirmado=1${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`;
}

/** Mensagens do login em português (o Supabase responde em inglês). */
function authMessage(msg: string): string {
  const m = msg.toLowerCase();
  if (isLimitExceededMessage(msg)) return 'Muitas tentativas seguidas. Aguarde 1 minuto e tente de novo.';
  if (m.includes('anonymous sign-ins are disabled') || m.includes('missing email')) return 'Preencha o e-mail.';
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Seu e-mail ainda não foi confirmado.';
  if (m.includes('user already registered') || m.includes('already been registered'))
    return 'Este e-mail já tem conta. Use "Entrar" com a sua senha.';
  if (m.includes('password should be at least') || m.includes('weak password')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (m.includes('same as the old') || m.includes('should be different')) return 'Use uma senha diferente da anterior.';
  if (m.includes('unable to validate email') || m.includes('invalid email') || (m.includes('email address') && m.includes('invalid')))
    return 'E-mail inválido. Confira o endereço digitado.';
  return msg;
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-slate-700 block">
        {label}
      </label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          className="w-full pl-10 pr-11 py-3 text-base border border-slate-300 rounded-lg focus:border-secondary focus:ring-2 focus:ring-secondary/20 outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-primary"
          aria-label={show ? 'Esconder senha' : 'Mostrar senha'}
          title={show ? 'Esconder senha' : 'Mostrar senha'}
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function EmailField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor="login-email" className="text-sm font-semibold text-slate-700 block">
        E-mail
      </label>
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input
          id="login-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="seu@email.com"
          autoFocus={autoFocus}
          className="w-full pl-10 pr-3 py-3 text-base border border-slate-300 rounded-lg focus:border-secondary focus:ring-2 focus:ring-secondary/20 outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function PrimaryButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full py-3 bg-secondary text-white rounded-lg font-bold text-base flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-60"
    >
      {loading ? <Loader2 className="animate-spin" size={20} /> : children}
    </button>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('entrar');
  const [fromInvite, setFromInvite] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  /** O que o e-mail enviado faz: confirmar o cadastro ou trocar a senha. */
  const [sentKind, setSentKind] = useState<'cadastro' | 'senha'>('cadastro');

  useEffect(() => {
    // Lê o endereço só no navegador (evita diferença entre servidor e navegador).
    const params = new URLSearchParams(window.location.search);
    const invite = safeNextPath().startsWith('/convite/');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFromInvite(invite);
    const isConfirm = params.get('confirmado') === '1';
    const isRecovery = params.get('recuperar') === '1';
    setConfirmed(isConfirm);
    if (isRecovery) setMode('nova-senha');
    else if (invite && !isConfirm) setMode('criar'); // convidado quase sempre ainda não tem conta
    if (!isConfirm && !isRecovery) return;
    // Veio do link do e-mail: o navegador troca o código do link pela sessão.
    const t = setTimeout(() => {
      void (async () => {
        const { data } = await supabase.auth.getSession();
        if (isConfirm && data.session) window.location.replace(safeNextPath());
        if (isRecovery && !data.session) {
          setError('Este link não abriu aqui. Peça um novo link em "Esqueci minha senha" e abra no mesmo aparelho.');
        }
      })();
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
    setNeedsConfirm(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) return setError(email.trim() ? 'E-mail inválido. Confira o endereço digitado.' : 'Preencha o e-mail.');
    if (!password) return setError('Preencha a senha.');
    setLoading(true);
    setError(null);
    setNeedsConfirm(false);
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (loginError) {
      setError(authMessage(loginError.message));
      setNeedsConfirm(loginError.message.toLowerCase().includes('email not confirmed'));
      setLoading(false);
      return;
    }
    // Pequena espera para os cookies chegarem antes de trocar de página.
    setTimeout(() => window.location.replace(safeNextPath()), 400);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) return setError(email.trim() ? 'E-mail inválido. Confira o endereço digitado.' : 'Preencha o e-mail.');
    if (password.length < 6) return setError('A senha precisa ter pelo menos 6 caracteres.');
    setLoading(true);
    setError(null);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: confirmRedirect() },
    });
    setLoading(false);
    if (signUpError) {
      setError(authMessage(signUpError.message));
      return;
    }
    // E-mail já cadastrado: o Supabase não avisa, devolve usuário sem identidades.
    if (data.user && (data.user.identities ?? []).length === 0) {
      setError('Este e-mail já tem conta. Use "Entrar" com a sua senha.');
      return;
    }
    if (data.session) {
      window.location.replace(safeNextPath());
      return;
    }
    setSentKind('cadastro');
    setCooldown(RESEND_WAIT);
    go('confira');
  };

  const resend = async () => {
    if (cooldown > 0 || !isEmail(email)) return;
    setLoading(true);
    setError(null);
    const { error: rErr } =
      sentKind === 'senha'
        ? await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/login?recuperar=1` })
        : await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: confirmRedirect() } });
    setLoading(false);
    if (rErr) setError(authMessage(rErr.message));
    else {
      setNotice('E-mail reenviado.');
      setCooldown(RESEND_WAIT);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) return setError(email.trim() ? 'E-mail inválido. Confira o endereço digitado.' : 'Preencha o e-mail.');
    setLoading(true);
    setError(null);
    const { error: fErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login?recuperar=1`,
    });
    setLoading(false);
    if (fErr) return setError(authMessage(fErr.message));
    setSentKind('senha');
    setCooldown(RESEND_WAIT);
    go('confira');
  };

  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return setError('A senha precisa ter pelo menos 6 caracteres.');
    setLoading(true);
    setError(null);
    const { error: uErr } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (uErr) return setError(authMessage(uErr.message));
    window.location.replace('/');
  };

  const titles: Record<Mode, { title: string; sub: string }> = {
    entrar: { title: 'Entrar', sub: 'Use o e-mail e a senha da sua conta.' },
    criar: { title: 'Criar sua conta', sub: 'Leva menos de um minuto.' },
    esqueci: { title: 'Esqueci minha senha', sub: 'Enviamos um link para você criar uma senha nova.' },
    confira: { title: 'Confira seu e-mail', sub: '' },
    'nova-senha': { title: 'Criar nova senha', sub: 'Escolha a senha que você vai usar daqui para frente.' },
  };

  return (
    <div className="min-h-[100dvh] bg-slate-100 flex flex-col items-center justify-center px-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-[400px]">
        <p className="text-center text-3xl font-extrabold tracking-tight text-primary mb-6">
          LOGG<span className="text-secondary">B</span>
        </p>

        {confirmed && mode === 'entrar' ? (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
            <b>E-mail confirmado!</b> Agora é só entrar com o seu e-mail e senha{fromInvite ? ' para abrir o convite' : ''}.
          </div>
        ) : null}
        {fromInvite && (mode === 'criar' || mode === 'entrar') && !confirmed ? (
          <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            <b>Você foi convidado para o LoggB.</b>{' '}
            {mode === 'criar' ? 'Crie sua conta abaixo para aceitar o convite.' : 'Entre na sua conta para aceitar o convite.'}
          </div>
        ) : null}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-primary">{titles[mode].title}</h1>
          {titles[mode].sub ? <p className="text-sm text-slate-500 mt-1">{titles[mode].sub}</p> : null}

          {mode === 'confira' ? (
            <div className="mt-5 space-y-4 text-sm text-slate-700">
              <div className="flex justify-center">
                <MailCheck size={56} className="text-secondary" />
              </div>
              <p>
                Enviamos um e-mail para <b className="break-all">{email.trim()}</b>.
              </p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Abra o seu e-mail (veja também a caixa de <b>spam</b> ou <b>lixo eletrônico</b>).</li>
                <li>
                  Clique no botão <b>{sentKind === 'senha' ? 'do link para criar nova senha' : '“Confirmar meu e-mail”'}</b>.
                </li>
                <li>{sentKind === 'senha' ? 'Escolha a nova senha.' : 'Volte aqui e entre com o seu e-mail e senha.'}</li>
              </ol>
              {notice ? <p className="text-green-700 font-semibold">{notice}</p> : null}
              {error ? <p className="text-red-700">{error}</p> : null}
              <button
                type="button"
                onClick={() => void resend()}
                disabled={cooldown > 0 || loading}
                className="w-full py-3 border border-slate-300 rounded-lg font-semibold text-primary hover:bg-slate-50 disabled:opacity-60"
              >
                {cooldown > 0 ? `Reenviar e-mail (${cooldown}s)` : 'Reenviar e-mail'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPassword('');
                  go('entrar');
                }}
                className="w-full py-3 bg-secondary text-white rounded-lg font-bold hover:brightness-110"
              >
                {sentKind === 'senha' ? 'Voltar para entrar' : 'Já confirmei, entrar'}
              </button>
              <p className="text-xs text-slate-500">
                Digitou o e-mail errado?{' '}
                <button type="button" className="font-semibold text-secondary hover:underline" onClick={() => go(sentKind === 'senha' ? 'esqueci' : 'criar')}>
                  Corrigir
                </button>
              </p>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={mode === 'entrar' ? handleLogin : mode === 'criar' ? handleSignUp : mode === 'esqueci' ? handleForgot : handleNewPassword}
              className="mt-6 space-y-4"
            >
              {mode !== 'nova-senha' ? <EmailField value={email} onChange={setEmail} autoFocus /> : null}

              {mode === 'entrar' ? (
                <div>
                  <PasswordField id="login-password" label="Senha" value={password} onChange={setPassword} autoComplete="current-password" />
                  <button
                    type="button"
                    onClick={() => go('esqueci')}
                    className="mt-2 text-sm font-semibold text-secondary hover:underline"
                  >
                    Esqueci minha senha
                  </button>
                </div>
              ) : null}
              {mode === 'criar' ? (
                <PasswordField
                  id="signup-password"
                  label="Crie uma senha"
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                  hint="Pelo menos 6 caracteres. Toque no olho para ver o que digitou."
                />
              ) : null}
              {mode === 'nova-senha' ? (
                <PasswordField
                  id="new-password"
                  label="Nova senha"
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                  hint="Pelo menos 6 caracteres."
                />
              ) : null}

              {error ? (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                  <p>{error}</p>
                  {needsConfirm ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSentKind('cadastro');
                        void resend().then(() => go('confira'));
                      }}
                      className="font-semibold underline"
                    >
                      Reenviar o e-mail de confirmação
                    </button>
                  ) : null}
                </div>
              ) : null}

              <PrimaryButton loading={loading}>
                {mode === 'entrar' ? (
                  'Entrar'
                ) : mode === 'criar' ? (
                  'Criar conta'
                ) : mode === 'esqueci' ? (
                  'Enviar link'
                ) : (
                  <>
                    <KeyRound size={18} /> Salvar nova senha
                  </>
                )}
              </PrimaryButton>
            </form>
          )}
        </div>

        <div className="mt-6 text-center text-sm text-slate-600">
          {mode === 'entrar' ? (
            <>
              Não tem conta?{' '}
              <button type="button" onClick={() => go('criar')} className="font-bold text-secondary hover:underline">
                Criar conta
              </button>
            </>
          ) : mode === 'criar' ? (
            <>
              Já tem conta?{' '}
              <button type="button" onClick={() => go('entrar')} className="font-bold text-secondary hover:underline">
                Entrar
              </button>
            </>
          ) : mode === 'esqueci' ? (
            <button type="button" onClick={() => go('entrar')} className="inline-flex items-center gap-1 font-bold text-secondary hover:underline">
              <ArrowLeft size={16} /> Voltar para entrar
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
