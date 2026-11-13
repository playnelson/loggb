'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Loader2, RefreshCw, ShieldCheck, Undo2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/lib/workspace';
import {
  DELETION_ENTITY_LABEL,
  DELETIONS_CHANGED_EVENT,
  deletionErrorText,
  isMissingDeletionSchema,
  notifyDeletionsChanged,
  useCanApproveDeletion,
  type DeletionRequestRow,
  type DeletionResult,
} from '@/lib/deletion';
import { EQUIPMENT_DOCS_BUCKET } from '@/lib/equipmentDocs';
import { Chip, ErrorBox, FieldLabel, OrgModal } from '@/components/org/shared';

type View = 'pendentes' | 'historico';

const STATUS_TEXT: Record<DeletionRequestRow['status'], string> = {
  pendente: 'Aguardando',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  cancelado: 'Cancelado',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function who(email: string | null): string {
  return email ? email.split('@')[0] : 'alguém';
}

/** Pedidos de exclusão: quem aprova decide; quem pediu acompanha. */
export default function AprovacoesPage() {
  const { status, currentWorkspace } = useWorkspace();
  const approver = useCanApproveDeletion();
  const [view, setView] = useState<View>('pendentes');
  const [rows, setRows] = useState<DeletionRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [deciding, setDeciding] = useState<{ row: DeletionRequestRow; approve: boolean } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcErr } = await supabase.rpc('list_deletion_requests', { p_limit: 300 });
    if (rpcErr) {
      setMissing(isMissingDeletionSchema(rpcErr.message));
      setError(rpcErr.message);
      setRows([]);
    } else {
      setMissing(false);
      setError(null);
      setRows((data ?? []) as DeletionRequestRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (status !== 'ready') return;
    // Carregamento inicial e quando outra tela cria ou resolve um pedido.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const onChange = () => void load();
    window.addEventListener(DELETIONS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DELETIONS_CHANGED_EVENT, onChange);
  }, [status, load, currentWorkspace?.id]);

  const cancel = async (row: DeletionRequestRow) => {
    if (!window.confirm(`Cancelar o pedido para excluir "${row.entity_label}"?`)) return;
    const { error: rpcErr } = await supabase.rpc('cancel_deletion', { p_request: row.id });
    if (rpcErr) {
      setError(deletionErrorText(rpcErr.message));
      return;
    }
    setFlash('Pedido cancelado.');
    notifyDeletionsChanged();
  };

  const pending = rows.filter((r) => r.status === 'pendente');
  const done = rows.filter((r) => r.status !== 'pendente');
  const list = view === 'pendentes' ? pending : done;

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 erp-titlebar px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-[22px] font-bold tracking-tight text-primary flex items-center gap-2">
            <ShieldCheck className="text-secondary" size={22} />
            Aprovações
          </h1>
          <p className="text-xs text-slate-500">
            {approver
              ? 'Pedidos de exclusão da equipe neste workspace. Aprove ou recuse; tudo fica registrado.'
              : 'Seus pedidos de exclusão e os da equipe. Quem aprova é o ADM ou o gestor.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-bold text-primary border border-slate-300 bg-white rounded hover:bg-slate-50 disabled:opacity-60 self-start md:self-auto"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      <div role="tablist" aria-label="Pedidos" className="flex gap-0 border-b border-slate-300">
        {(
          [
            ['pendentes', 'Aguardando', pending.length],
            ['historico', 'Histórico', done.length],
          ] as const
        ).map(([key, text, n]) => {
          const on = view === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setView(key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-[3px] -mb-px ${
                on ? 'border-secondary text-primary bg-white' : 'border-transparent text-slate-500 hover:text-primary'
              }`}
            >
              {text}
              {!loading ? (
                <span
                  className={`text-[11px] font-bold px-1.5 rounded ${
                    key === 'pendentes' && n > 0 ? 'bg-red-600 text-white' : 'text-slate-400'
                  }`}
                >
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {flash ? (
        <div className="flex items-start justify-between gap-2 text-sm font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded p-3">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} className="p-0.5 hover:bg-emerald-100 rounded" aria-label="Fechar aviso">
            <X size={16} />
          </button>
        </div>
      ) : null}

      {missing ? (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded p-4">
          O banco ainda não tem os pedidos de exclusão. Aplique a <strong>etapa 10</strong> (supabase/etapa10_exclusao_aprovacao.sql)
          no Supabase.
        </div>
      ) : (
        <ErrorBox message={error} />
      )}

      {loading ? (
        <div className="py-16 flex justify-center text-slate-400">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : missing ? null : list.length === 0 ? (
        <div className="bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
          {view === 'pendentes' ? 'Nenhum pedido aguardando.' : 'Nenhuma exclusão registrada ainda.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id} className="bg-white border border-slate-200 border-l-[3px] px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3"
              style={{ borderLeftColor: r.status === 'pendente' ? '#f59e0b' : r.status === 'aprovado' ? '#16a34a' : '#94a3b8' }}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip>{DELETION_ENTITY_LABEL[r.entity] ?? r.entity}</Chip>
                  <Chip tone={r.status === 'pendente' ? 'amber' : r.status === 'aprovado' ? 'green' : 'slate'}>
                    {STATUS_TEXT[r.status]}
                    {r.status === 'aprovado' && r.result ? ` · ${r.result === 'arquivado' ? 'arquivado' : 'apagado'}` : ''}
                  </Chip>
                  {r.mine ? <Chip tone="dark">Seu pedido</Chip> : null}
                </div>
                <p className="text-sm font-bold text-primary break-words">{r.entity_label}</p>
                {r.reason ? <p className="text-sm text-slate-700 break-words">Motivo: {r.reason}</p> : null}
                <p className="text-[11px] text-slate-500">
                  {r.status === 'aprovado' && r.decided_at && r.requested_at === r.decided_at
                    ? `Excluído direto por ${who(r.decided_by_email)} em ${fmtDate(r.decided_at)}`
                    : `Pedido por ${who(r.requested_by_email)} em ${fmtDate(r.requested_at)}`}
                  {r.status !== 'pendente' && r.decided_at && r.requested_at !== r.decided_at
                    ? ` · ${STATUS_TEXT[r.status].toLowerCase()} por ${who(r.decided_by_email)} em ${fmtDate(r.decided_at)}`
                    : ''}
                </p>
                {r.decision_note ? <p className="text-[12px] text-slate-600 break-words">Resposta: {r.decision_note}</p> : null}
                {r.status === 'aprovado' && r.result === 'arquivado' ? (
                  <p className="text-[11px] text-slate-500">
                    Tinha histórico, então foi {r.entity === 'colaborador' ? 'marcado como Desligado' : 'arquivado'} em vez de
                    apagado.
                  </p>
                ) : null}
              </div>
              {r.status === 'pendente' ? (
                <div className="flex flex-wrap gap-2 shrink-0">
                  {approver ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setDeciding({ row: r, approve: true })}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-white bg-red-600 rounded hover:opacity-95"
                      >
                        <Check size={16} />
                        Aprovar exclusão
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeciding({ row: r, approve: false })}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-primary border border-slate-300 bg-white rounded hover:bg-slate-50"
                      >
                        <X size={16} />
                        Recusar
                      </button>
                    </>
                  ) : r.mine ? (
                    <button
                      type="button"
                      onClick={() => void cancel(r)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-primary border border-slate-300 bg-white rounded hover:bg-slate-50"
                    >
                      <Undo2 size={16} />
                      Cancelar pedido
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {deciding ? (
        <DecideModal
          row={deciding.row}
          approve={deciding.approve}
          onClose={() => setDeciding(null)}
          onDone={(msg) => {
            setDeciding(null);
            setFlash(msg);
            notifyDeletionsChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function DecideModal({
  row,
  approve,
  onClose,
  onDone,
}: {
  row: DeletionRequestRow;
  approve: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc('decide_deletion', {
      p_request: row.id,
      p_approve: approve,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (rpcErr) {
      setError(deletionErrorText(rpcErr.message));
      return;
    }
    if (!approve) {
      onDone(`Pedido recusado. "${row.entity_label}" continua cadastrado.`);
      return;
    }
    const res = data as DeletionResult;
    if (res?.storage_path) await supabase.storage.from(EQUIPMENT_DOCS_BUCKET).remove([res.storage_path]);
    onDone(
      res?.result === 'arquivado'
        ? `"${row.entity_label}" tinha histórico e foi ${row.entity === 'colaborador' ? 'marcado como Desligado' : 'arquivado'}. O histórico continua guardado.`
        : `"${row.entity_label}" foi excluído.`
    );
  };

  return (
    <OrgModal title={approve ? 'Aprovar exclusão' : 'Recusar pedido'} onClose={onClose}>
      <form onSubmit={submit} className="p-4 space-y-4">
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {DELETION_ENTITY_LABEL[row.entity] ?? row.entity}
          </span>
          <span className="block text-sm font-bold text-primary break-words">{row.entity_label}</span>
          {row.reason ? <span className="block text-xs text-slate-600 mt-1">Motivo: {row.reason}</span> : null}
        </div>
        {approve ? (
          <p className="text-xs text-slate-600">
            Se tiver histórico (movimentações, aluguéis ou pedidos de compra), {row.entity === 'colaborador' ? 'o colaborador fica como Desligado' : 'o item é arquivado'} em
            vez de apagado, para não perder o histórico.
          </p>
        ) : null}
        <ErrorBox message={error} />
        <div>
          <FieldLabel htmlFor="dec-note">Resposta para quem pediu (opcional)</FieldLabel>
          <input
            id="dec-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            className="w-full p-2.5 border border-slate-300 rounded text-sm"
            autoFocus
          />
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded font-bold text-slate-600 hover:bg-slate-100">
            Voltar
          </button>
          <button
            type="submit"
            disabled={saving}
            className={`inline-flex items-center justify-center gap-2 text-white px-5 py-2.5 rounded font-bold hover:opacity-95 disabled:opacity-60 ${
              approve ? 'bg-red-600' : 'bg-primary'
            }`}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : approve ? <Check size={16} /> : <X size={16} />}
            {approve ? 'Aprovar e excluir' : 'Recusar'}
          </button>
        </div>
      </form>
    </OrgModal>
  );
}
