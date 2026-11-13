'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/lib/workspace';

/** O que pode ser excluído com aprovação (etapa 10). */
export type DeletionEntity = 'colaborador' | 'item' | 'ordem_compra' | 'aluguel' | 'documento';

export const DELETION_ENTITY_LABEL: Record<DeletionEntity, string> = {
  colaborador: 'Colaborador',
  item: 'Item do estoque',
  ordem_compra: 'Ordem de compra',
  aluguel: 'Aluguel',
  documento: 'Documento',
};

export type DeletionStatus = 'pendente' | 'aprovado' | 'recusado' | 'cancelado';

export type DeletionRequestRow = {
  id: string;
  entity: DeletionEntity;
  entity_id: string;
  entity_label: string;
  reason: string | null;
  status: DeletionStatus;
  result: 'apagado' | 'arquivado' | null;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
  mine: boolean;
  requested_by_email: string | null;
  decided_by_email: string | null;
};

/** Resposta de excluir/aprovar: o que aconteceu e, se for documento, o arquivo a apagar. */
export type DeletionResult = {
  result: 'apagado' | 'arquivado';
  storage_path: string | null;
  label: string;
};

/** Avisa as telas (e o contador do topo) que um pedido mudou. */
export const DELETIONS_CHANGED_EVENT = 'loggb:deletions-changed';

export function notifyDeletionsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DELETIONS_CHANGED_EVENT));
}

export function isMissingDeletionSchema(message: string | undefined): boolean {
  return /could not find the function|deletion_requests|schema cache|does not exist/i.test(String(message || ''));
}

export function deletionErrorText(message: string | undefined): string {
  if (isMissingDeletionSchema(message)) {
    return 'O banco ainda não tem os pedidos de exclusão. Aplique a etapa 10 (supabase/etapa10_exclusao_aprovacao.sql).';
  }
  return String(message || 'Não foi possível concluir.');
}

/** Quem tem "Aprovar exclusões" (ADM e cargo Gestor) exclui na hora; os outros pedem. */
export function useCanApproveDeletion(): boolean {
  const { can } = useWorkspace();
  return can('exclusoes_aprovar');
}

/** Quantos pedidos de exclusão aguardam decisão no workspace atual (só para quem aprova). */
export function usePendingDeletionCount(): number {
  const { status, currentWorkspace, readOnly } = useWorkspace();
  const approver = useCanApproveDeletion();
  const [count, setCount] = useState(0);
  const enabled = status === 'ready' && !readOnly && approver && Boolean(currentWorkspace);

  const load = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    const { count: n, error } = await supabase
      .from('deletion_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pendente');
    setCount(error ? 0 : n ?? 0);
  }, [enabled]);

  useEffect(() => {
    // Busca inicial e atualização a cada minuto ou quando um pedido muda.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    if (!enabled) return;
    const onChange = () => void load();
    window.addEventListener(DELETIONS_CHANGED_EVENT, onChange);
    const timer = window.setInterval(onChange, 60_000);
    return () => {
      window.removeEventListener(DELETIONS_CHANGED_EVENT, onChange);
      window.clearInterval(timer);
    };
  }, [enabled, load, currentWorkspace?.id]);

  return count;
}
