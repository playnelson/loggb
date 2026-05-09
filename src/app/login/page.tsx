'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
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

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      console.error('Login error details:', loginError);
      setError(`Erro no login: ${loginError.message}`);
      setLoading(false);
    } else {
      // Force a tiny delay for cookies to settle on client before hitting the edge proxy
      setTimeout(() => {
        window.location.replace('/');
      }, 500);
    }
  };

  const handleSignUp = async () => {
    setLoading(true);
    setError(null);

    let signUpError: { message: string } | null = null;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (!error) {
        signUpError = null;
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
        setError(signUpError.message);
      }
    } else {
      setError('Cadastro realizado. Verifique seu e-mail (se habilitado) ou tente entrar.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="max-w-md w-full">
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter text-primary">
            LOGG<span className="text-secondary">B</span>
          </h1>
          <p className="text-slate-500 mt-2 font-medium text-sm sm:text-base px-2">
            Gestão de Almoxarifado Inteligente
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-border shadow-xl p-6 sm:p-8">
          <h2 className="text-xl font-bold text-primary mb-6">Acesse sua conta</h2>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-bold text-primary uppercase tracking-wider block">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="email"
                  placeholder="seu@email.com"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-primary uppercase tracking-wider block">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="password"
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-500 font-medium bg-red-50 p-3 rounded-lg flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                {error}
              </p>
            )}

            <div className="pt-2 flex flex-col gap-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 disabled:bg-slate-300 transition-all shadow-lg shadow-primary/20 pointer"
              >
                {loading ? <Loader2 className="animate-spin" size={20} /> : <><LogIn size={20} /> Entrar</>}
              </button>
              
              <button
                type="button"
                onClick={handleSignUp}
                disabled={loading}
                className="w-full py-3 bg-white text-primary border border-slate-200 rounded-xl font-bold hover:bg-slate-50 transition-all"
              >
                Criar Nova Conta
              </button>
            </div>
          </form>
        </div>

        <p className="text-center text-slate-400 text-sm mt-8">
          Ambiente restrito e monitorado de alta segurança.
        </p>
      </div>
    </div>
  );
}
