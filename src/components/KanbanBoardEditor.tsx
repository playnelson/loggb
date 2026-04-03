'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { KanbanColumnRow } from '@/lib/kanbanColumns';
import { X, Plus, Trash2, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';

export function KanbanBoardEditor({
  isOpen,
  columns,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  columns: KanbanColumnRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [local, setLocal] = useState<KanbanColumnRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && columns.length > 0) {
      setLocal([...columns].sort((a, b) => a.sort_order - b.sort_order));
      setError(null);
    }
  }, [isOpen, columns]);

  if (!isOpen) return null;

  const persistOrder = async (next: KanbanColumnRow[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setSaving(true);
    setError(null);
    for (let i = 0; i < next.length; i++) {
      const { error: e } = await supabase
        .from('kanban_columns')
        .update({ sort_order: i, updated_at: new Date().toISOString() })
        .eq('id', next[i].id)
        .eq('user_id', user.id);
      if (e) {
        setError(e.message);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    onSaved();
  };

  const saveTitle = async (id: string, title: string) => {
    const t = title.trim();
    if (t.length < 1) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error: e } = await supabase
      .from('kanban_columns')
      .update({ title: t, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    if (e) {
      alert(e.message);
      return;
    }
    await supabase
      .from('purchase_orders')
      .update({ stage: t, updated_at: new Date().toISOString() })
      .eq('kanban_column_id', id)
      .eq('user_id', user.id);
    onSaved();
  };

  const addColumn = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const slug = `col_${Date.now().toString(36)}`;
    const sort_order = local.length ? Math.max(...local.map((c) => c.sort_order)) + 1 : 0;
    const title = 'Nova coluna';
    const { data, error: e } = await supabase
      .from('kanban_columns')
      .insert([
        {
          user_id: user.id,
          title,
          slug,
          sort_order,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ])
      .select('id, user_id, title, slug, sort_order, created_at, updated_at')
      .single();
    if (e || !data) {
      alert(e?.message || 'Erro ao criar coluna.');
      return;
    }
    onSaved();
  };

  const removeColumn = async (col: KanbanColumnRow) => {
    if (!confirm(`Excluir a coluna "${col.title}"? Pedidos nela ficam sem coluna até você arrastar para outra.`)) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { count } = await supabase
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('kanban_column_id', col.id)
      .eq('user_id', user.id);
    if (count && count > 0) {
      if (!confirm(`Existem ${count} pedido(s) nesta coluna. Confirma excluir a coluna? (Os pedidos permanecem, só perdem a coluna.)`)) return;
    }
    const { error: e } = await supabase.from('kanban_columns').delete().eq('id', col.id).eq('user_id', user.id);
    if (e) {
      alert(e.message);
      return;
    }
    onSaved();
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= local.length) return;
    const next = [...local];
    [next[idx], next[j]] = [next[j], next[idx]];
    setLocal(next);
    void persistOrder(next);
  };

  const sorted = useMemo(() => {
    const base = local.length > 0 ? local : columns;
    return [...base].sort((a, b) => a.sort_order - b.sort_order);
  }, [local, columns]);

  return (
    <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
          <h2 className="text-lg font-bold text-primary">Editar quadro (colunas)</h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-2">
          {error && <div className="text-sm text-red-600 font-medium">{error}</div>}
          <p className="text-xs text-slate-500">
            Renomeie colunas, reordene ou crie novas. Os cartões do kanban seguem estas colunas.
          </p>
          {sorted.map((col, idx) => (
            <div key={col.id} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2">
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  disabled={saving || idx === 0}
                  onClick={() => move(idx, -1)}
                  className="p-1 hover:bg-white rounded disabled:opacity-30"
                  aria-label="Subir"
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  type="button"
                  disabled={saving || idx === sorted.length - 1}
                  onClick={() => move(idx, 1)}
                  className="p-1 hover:bg-white rounded disabled:opacity-30"
                  aria-label="Descer"
                >
                  <ChevronDown size={16} />
                </button>
              </div>
              <input
                className="flex-1 min-w-0 p-2 border border-slate-200 rounded-lg text-sm font-bold"
                defaultValue={col.title}
                key={col.id + col.title}
                onBlur={(e) => {
                  if (e.target.value.trim() !== col.title) void saveTitle(col.id, e.target.value);
                }}
              />
              <button
                type="button"
                onClick={() => void removeColumn(col)}
                className="p-2 text-slate-400 hover:text-red-600 shrink-0"
                title="Excluir coluna"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={saving}
            onClick={() => void addColumn()}
            className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-300 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            <Plus size={18} />
            Nova coluna
          </button>
        </div>
        <div className="p-4 border-t bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-primary text-white rounded-lg font-bold text-sm"
          >
            Fechar
          </button>
          {saving && (
            <span className="flex items-center gap-2 text-xs text-slate-500 mr-auto">
              <Loader2 className="animate-spin" size={14} /> Salvando ordem…
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
