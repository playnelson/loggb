'use client';

import { useState, type FormEvent } from 'react';
import { KeyRound, Loader2, LogIn } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { parseInviteInput } from '@/lib/inviteCode';

/**
 * Entrar na organização de outra pessoa com a chave (ex.: K7QM-3XPA) ou o link do convite.
 * Leva para a página do convite, que mostra o cargo e pede a confirmação.
 */
export default function JoinWithInvite({ compact = false }: { compact?: boolean }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = parseInviteInput(value);
    if (!parsed) {
      setError('Cole a chave de 8 letras e números (ex.: K7QM-3XPA) ou o link do convite inteiro.');
      return;
    }
    if (parsed.kind === 'token') {
      window.location.assign(`/convite/${parsed.token}`);
      return;
    }
    setBusy(true);
    const { data, error: rpcErr } = await supabase.rpc('invite_token_by_code', { p_code: parsed.code });
    setBusy(false);
    if (rpcErr) {
      setError(
        /could not find the function|schema cache/i.test(rpcErr.message)
          ? 'A chave curta ainda não está ativa. Use o link do convite.'
          : rpcErr.message
      );
      return;
    }
    if (!data) {
      setError('Chave não encontrada. Confira as letras com quem enviou o convite.');
      return;
    }
    window.location.assign(`/convite/${data as string}`);
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      {!compact ? (
        <label htmlFor="join-invite" className="flex items-center gap-2 text-sm font-bold text-primary">
          <KeyRound size={18} className="text-secondary" />
          Recebeu um convite? Entre na equipe
        </label>
      ) : null}
      <p className="text-xs text-slate-500">
        Cole a <strong>chave</strong> (ex.: K7QM-3XPA) ou o <strong>link</strong> que o ADM da empresa enviou.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id="join-invite"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Chave ou link do convite"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="flex-1 min-w-0 p-2.5 border border-slate-300 rounded font-mono text-sm uppercase placeholder:normal-case placeholder:font-sans"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="inline-flex items-center justify-center gap-2 bg-secondary text-white px-4 py-2.5 rounded font-bold hover:opacity-95 disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
          Entrar
        </button>
      </div>
      {error ? <p className="text-xs font-bold text-red-700">{error}</p> : null}
    </form>
  );
}
