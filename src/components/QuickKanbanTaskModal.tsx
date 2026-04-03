'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { EmployeeLite } from '@/lib/purchaseOrders';
import type { KanbanColumnRow } from '@/lib/kanbanColumns';
import { X, Loader2, Plus } from 'lucide-react';

export function QuickKanbanTaskModal({
  isOpen,
  onClose,
  columns,
  employees,
  defaultColumnId,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  columns: KanbanColumnRow[];
  employees: EmployeeLite[];
  defaultColumnId: string;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [columnId, setColumnId] = useState('');
  const [requesterId, setRequesterId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setNotes('');
      setColumnId(defaultColumnId || columns[0]?.id || '');
      setRequesterId('');
    }
  }, [isOpen, defaultColumnId, columns]);

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (t.length < 2) {
      alert('Informe um título para a tarefa (mín. 2 caracteres).');
      return;
    }
    if (!requesterId) {
      alert('Selecione o solicitante.');
      return;
    }
    if (!columnId) {
      alert('Selecione a coluna.');
      return;
    }
    const col = columns.find((c) => c.id === columnId);
    if (!col) return;

    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      return;
    }

    const { error } = await supabase.from('purchase_orders').insert([
      {
        user_id: user.id,
        requester_employee_id: requesterId,
        title: t,
        notes: notes.trim() || null,
        kanban_column_id: columnId,
        stage: col.title,
        updated_at: new Date().toISOString(),
      },
    ]);

    setSubmitting(false);
    if (error) {
      alert(`Erro ao criar tarefa: ${error.message}`);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
          <h2 className="text-lg font-bold text-primary">Nova tarefa no quadro</h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-bold uppercase text-slate-400">Título *</label>
            <input
              className="mt-1 w-full p-3 border border-slate-200 rounded-lg font-bold text-primary"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Comprar EPI para obra X"
              required
              minLength={2}
            />
          </div>
          <div>
            <label className="text-xs font-bold uppercase text-slate-400">Coluna</label>
            <select
              className="mt-1 w-full p-3 border border-slate-200 rounded-lg"
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold uppercase text-slate-400">Solicitante *</label>
            <select
              className="mt-1 w-full p-3 border border-slate-200 rounded-lg"
              value={requesterId}
              onChange={(e) => setRequesterId(e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold uppercase text-slate-400">Detalhes (opcional)</label>
            <textarea
              className="mt-1 w-full p-3 border border-slate-200 rounded-lg text-sm min-h-[72px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações da tarefa…"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-500"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-3 bg-secondary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
              Criar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
