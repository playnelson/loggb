'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, Eye, Loader2, MailWarning, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTimeBR } from '@/lib/workspace';
import { OrgLogo } from '@/components/OrganizationSetup';
import { formatEmployeeName } from '@/lib/employeeName';

type InviteInfo = {
  status: 'valido' | 'invalido' | 'cancelado' | 'expirado' | 'usado';
  role?: 'membro' | 'gestor';
  /** Etapa 9: cargo, áreas e se é só consulta. */
  cargo_name?: string | null;
  read_only?: boolean;
  all_areas?: boolean;
  areas?: string[];
  organization_name?: string;
  logo_data?: string | null;
  label?: string | null;
  /** Etapa 12: ficha de funcionário ligada ao convite. */
  employee_name?: string | null;
  access_expires_at?: string | null;
  invite_expires_at?: string | null;
  all_workspaces?: boolean;
  workspaces?: string[];
  already_member?: boolean;
};

const STATUS_MESSAGE: Record<InviteInfo['status'], string> = {
  valido: '',
  invalido: 'Este link de convite não existe. Confira se ele foi copiado inteiro.',
  cancelado: 'Este convite foi cancelado por quem o enviou. Peça um novo link.',
  expirado: 'Este convite expirou. Peça um novo link a quem o enviou.',
  usado: 'Este convite já foi usado. Peça um novo link a quem o enviou.',
};

export default function ConvitePage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === 'string' ? params.token : '';
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: rpcError } = await supabase.rpc('invite_info', { p_token: token });
      if (cancelled) return;
      if (rpcError) setError(rpcError.message);
      else setInfo(data as InviteInfo);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const accept = async () => {
    setAccepting(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('accept_invite', { p_token: token });
    if (rpcError) {
      setError(rpcError.message);
      setAccepting(false);
      return;
    }
    window.location.assign(info?.already_member || !readOnly ? '/' : '/gestor');
  };

  // Sem a etapa 9 no banco, o convite de "gestor" era só consulta.
  const readOnly = info ? (typeof info.read_only === 'boolean' ? info.read_only : info.role === 'gestor') : false;
  const areasText = info?.all_areas
    ? 'Todos os almoxarifados'
    : info?.areas && info.areas.length
      ? info.areas.join(', ')
      : 'Nenhuma (consulta o estoque)';

  return (
    <div className="max-w-lg mx-auto py-6 sm:py-12">
      <div className="bg-white border border-slate-200 border-t-[3px] border-t-secondary shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center text-slate-400">
            <Loader2 className="animate-spin" size={28} />
          </div>
        ) : !info || info.status !== 'valido' ? (
          <div className="p-8 text-center space-y-3">
            <MailWarning className="mx-auto text-amber-500" size={36} />
            <h1 className="text-xl font-bold text-primary">Convite indisponível</h1>
            <p className="text-sm text-slate-500">
              {error || (info ? STATUS_MESSAGE[info.status] : 'Não foi possível abrir o convite.')}
            </p>
          </div>
        ) : (
          <>
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center gap-4">
              <OrgLogo src={info.logo_data} name={info.organization_name ?? ''} size={56} />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Convite para acessar</p>
                <h1 className="text-xl font-bold text-primary truncate">{info.organization_name}</h1>
                {info.employee_name ? (
                  <p className="text-xs text-slate-500 truncate">
                    Para: <strong className="text-primary">{formatEmployeeName(info.employee_name)}</strong>
                  </p>
                ) : info.label ? (
                  <p className="text-xs text-slate-500 truncate">Para: {info.label}</p>
                ) : null}
              </div>
            </div>
            <div className="p-6 space-y-4">
              {!readOnly ? (
                <div className="flex items-start gap-3 bg-secondary/5 border border-secondary/30 border-l-[3px] border-l-secondary p-3 text-primary">
                  <Users size={18} className="mt-0.5 shrink-0 text-secondary" />
                  <p className="text-sm">
                    Você vai entrar como <strong>{info.cargo_name || 'membro da equipe'}</strong> e usar o workspace junto com a
                    equipe: a mesma lista de colaboradores, o mesmo estoque e as mesmas compras. No estoque, você movimenta
                    os itens dos almoxarifados abaixo.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 border-l-[3px] border-l-amber-500 p-3 text-amber-900">
                  <Eye size={18} className="mt-0.5 shrink-0" />
                  <p className="text-sm">
                    Acesso de <strong>{info.cargo_name || 'consulta'}, somente leitura</strong>: você vai ver o estoque, os
                    colaboradores e o histórico e poderá baixar planilhas e documentos, mas não poderá alterar nada.
                  </p>
                </div>
              )}

              <dl className="text-sm space-y-2">
                {!readOnly && info.cargo_name ? (
                  <div>
                    <dt className="text-xs font-bold uppercase text-slate-400">Almoxarifados que você gerencia</dt>
                    <dd className="font-medium text-primary">{areasText}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs font-bold uppercase text-slate-400">Workspaces liberados</dt>
                  <dd className="font-medium text-primary">
                    {info.all_workspaces ? 'Todos os workspaces da organização' : (info.workspaces ?? []).join(', ') || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase text-slate-400">Acesso válido até</dt>
                  <dd className="font-medium text-primary">
                    {info.access_expires_at ? formatDateTimeBR(info.access_expires_at) : 'Sem prazo (até ser removido)'}
                  </dd>
                </div>
              </dl>

              {info.already_member ? (
                <p className="text-xs text-slate-500">
                  Você já participa desta organização com acesso completo; o convite só vai abrir o workspace.
                </p>
              ) : null}

              {error ? (
                <div className="text-sm font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">{error}</div>
              ) : null}

              <button
                type="button"
                onClick={() => void accept()}
                disabled={accepting}
                className="w-full inline-flex items-center justify-center gap-2 bg-secondary text-white px-5 py-2.5 rounded font-semibold hover:brightness-110 disabled:opacity-60"
              >
                {accepting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                Aceitar convite
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
