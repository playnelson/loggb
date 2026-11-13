'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, Send, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  DELETION_ENTITY_LABEL,
  deletionErrorText,
  notifyDeletionsChanged,
  useCanApproveDeletion,
  type DeletionEntity,
  type DeletionResult,
} from '@/lib/deletion';
import { EQUIPMENT_DOCS_BUCKET } from '@/lib/equipmentDocs';
import { ErrorBox, FieldLabel, OrgModal } from '@/components/org/shared';

export type DeletionOutcome =
  | { kind: 'done'; result: DeletionResult }
  | { kind: 'requested' };

/**
 * Excluir com aprovação.
 * Quem tem "Aprovar exclusões" exclui na hora (fica registrado).
 * Os outros mandam um pedido, que aparece em Aprovações para o ADM ou o gestor.
 */
export default function DeletionDialog({
  entity,
  id,
  label,
  note,
  onClose,
  onDone,
}: {
  entity: DeletionEntity;
  id: string;
  /** Nome do registro, como a pessoa reconhece. */
  label: string;
  /** Aviso extra (ex.: "tem histórico, será arquivado"). */
  note?: string;
  onClose: () => void;
  onDone: (outcome: DeletionOutcome) => void;
}) {
  const approver = useCanApproveDeletion();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = reason.trim();
    if (!approver && r.length < 3) {
      setError('Escreva o motivo, para quem vai aprovar entender.');
      return;
    }
    setSaving(true);
    setError(null);
    if (approver) {
      const { data, error: rpcErr } = await supabase.rpc('delete_now', { p_entity: entity, p_id: id, p_reason: r || null });
      setSaving(false);
      if (rpcErr) {
        setError(deletionErrorText(rpcErr.message));
        return;
      }
      const result = data as DeletionResult;
      if (result?.storage_path) {
        await supabase.storage.from(EQUIPMENT_DOCS_BUCKET).remove([result.storage_path]);
      }
      notifyDeletionsChanged();
      onDone({ kind: 'done', result });
      return;
    }
    const { error: rpcErr } = await supabase.rpc('request_deletion', { p_entity: entity, p_id: id, p_reason: r });
    setSaving(false);
    if (rpcErr) {
      setError(deletionErrorText(rpcErr.message));
      return;
    }
    notifyDeletionsChanged();
    setSent(true);
  };

  if (sent) {
    return (
      <OrgModal title="Pedido enviado" onClose={() => onDone({ kind: 'requested' })}>
        <div className="p-4 space-y-3">
          <p className="flex items-start gap-2 text-sm text-slate-700">
            <CheckCircle2 size={20} className="text-secondary shrink-0" />
            <span>
              O pedido para excluir <strong className="text-primary">{label}</strong> foi enviado. O ADM ou o gestor precisa
              aprovar. Acompanhe em{' '}
              <Link href="/aprovacoes" className="font-bold text-secondary underline">
                Aprovações
              </Link>
              .
            </span>
          </p>
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => onDone({ kind: 'requested' })}
              className="bg-secondary text-white px-5 py-2.5 rounded font-bold hover:opacity-95"
            >
              OK
            </button>
          </div>
        </div>
      </OrgModal>
    );
  }

  return (
    <OrgModal title={approver ? 'Excluir' : 'Pedir exclusão'} onClose={onClose}>
      <form onSubmit={submit} className="p-4 space-y-4">
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500">{DELETION_ENTITY_LABEL[entity]}</span>
          <span className="block text-sm font-bold text-primary break-words">{label}</span>
        </div>
        {note ? <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded p-3">{note}</p> : null}
        <p className="text-xs text-slate-600">
          {approver
            ? 'Você pode excluir na hora. Fica registrado em Aprovações quem excluiu e quando.'
            : 'Excluir precisa de aprovação. O pedido vai para o ADM ou o gestor, e você acompanha em Aprovações.'}
        </p>
        <ErrorBox message={error} />
        <div>
          <FieldLabel htmlFor="del-reason">{approver ? 'Motivo (opcional)' : 'Motivo'}</FieldLabel>
          <textarea
            id="del-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            rows={3}
            placeholder="Ex.: cadastrado em duplicidade"
            className="w-full p-2.5 border border-slate-300 rounded text-sm"
            autoFocus
          />
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded font-bold text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className={`inline-flex items-center justify-center gap-2 text-white px-5 py-2.5 rounded font-bold hover:opacity-95 disabled:opacity-60 ${
              approver ? 'bg-red-600' : 'bg-secondary'
            }`}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : approver ? <Trash2 size={16} /> : <Send size={16} />}
            {approver ? 'Excluir' : 'Enviar pedido'}
          </button>
        </div>
      </form>
    </OrgModal>
  );
}
