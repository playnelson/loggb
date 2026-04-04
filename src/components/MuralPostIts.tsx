'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Plus, StickyNote, Trash2 } from 'lucide-react';

type NoteColor = 'yellow' | 'mint' | 'pink' | 'sky';

type MuralNote = {
  id: string;
  body: string;
  color: NoteColor;
  sort_order: number;
  created_at: string;
};

const COLOR_STYLES: Record<NoteColor, string> = {
  yellow: 'bg-[#fff8b0] border-[#e6d25c] text-amber-950',
  mint: 'bg-[#d6f5ef] border-[#5ec4b0] text-teal-950',
  pink: 'bg-[#ffe4f0] border-[#f0a8c8] text-rose-950',
  sky: 'bg-[#dbeafe] border-[#7cb8f0] text-sky-950',
};

const COLOR_PICK: { id: NoteColor; label: string }[] = [
  { id: 'yellow', label: 'Amarelo' },
  { id: 'mint', label: 'Verde' },
  { id: 'pink', label: 'Rosa' },
  { id: 'sky', label: 'Azul' },
];

function isMissingMuralTable(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  const m = String(err.message ?? '').toLowerCase();
  if (m.includes('mural_notes') && (m.includes('does not exist') || m.includes('not find'))) return true;
  if (String(err.code) === '42P01') return true;
  return false;
}

export function MuralPostIts() {
  const [notes, setNotes] = useState<MuralNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [newBody, setNewBody] = useState('');
  const [newColor, setNewColor] = useState<NoteColor>('yellow');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setSchemaError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setNotes([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('mural_notes')
      .select('id, body, color, sort_order, created_at')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      if (isMissingMuralTable(error)) {
        setSchemaError(
          'Tabela mural_notes não encontrada. Execute o script supabase/mural_notes.sql no SQL Editor do Supabase.'
        );
      } else {
        setSchemaError(error.message);
      }
      setNotes([]);
      setLoading(false);
      return;
    }

    setNotes(
      (data || []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        body: String(r.body ?? ''),
        color: (['yellow', 'mint', 'pink', 'sky'].includes(String(r.color)) ? r.color : 'yellow') as NoteColor,
        sort_order: Number(r.sort_order ?? 0),
        created_at: String(r.created_at),
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addNote = async () => {
    const body = newBody.trim();
    if (!body) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setSaving(true);
    const nextOrder = notes.length > 0 ? Math.max(...notes.map((n) => n.sort_order)) + 1 : 0;
    const { error } = await supabase.from('mural_notes').insert([
      {
        user_id: user.id,
        body,
        color: newColor,
        sort_order: nextOrder,
        updated_at: new Date().toISOString(),
      },
    ]);
    setSaving(false);
    if (error) {
      alert(`Erro ao criar nota: ${error.message}`);
      return;
    }
    setNewBody('');
    void load();
  };

  const updateBody = async (id: string, body: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from('mural_notes')
      .update({ body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) alert(`Erro ao salvar: ${error.message}`);
    else setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, body } : n)));
  };

  const remove = async (id: string) => {
    if (!confirm('Remover este post-it?')) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('mural_notes').delete().eq('id', id).eq('user_id', user.id);
    if (error) alert(`Erro ao remover: ${error.message}`);
    else setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2">
        <Loader2 className="animate-spin" size={22} />
        Carregando mural…
      </div>
    );
  }

  if (schemaError) {
    return (
      <div className="p-5 bg-amber-50 border border-amber-200 rounded-xl text-amber-950 text-sm leading-relaxed">
        <strong className="font-bold">Mural:</strong> {schemaError}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-white p-4 rounded-xl border border-border shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-primary font-bold text-sm">
          <StickyNote size={18} className="text-secondary" />
          Novo post-it
        </div>
        <textarea
          className="w-full min-h-[88px] p-3 rounded-lg border border-slate-200 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-secondary/40 resize-y"
          placeholder="Lembrete, lista do dia, fornecedor, telefone…"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] font-bold uppercase text-slate-500">Cor</span>
          <div className="flex flex-wrap gap-2">
            {COLOR_PICK.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setNewColor(c.id)}
                className={`text-[10px] font-bold px-2 py-1 rounded-md border-2 transition-all ${
                  newColor === c.id ? 'border-primary ring-2 ring-secondary/30' : 'border-transparent opacity-80'
                } ${COLOR_STYLES[c.id]}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={saving || !newBody.trim()}
            onClick={() => void addNote()}
            className="ml-auto flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
            Adicionar
          </button>
        </div>
      </div>

      <div
        className="rounded-2xl border-2 border-dashed border-slate-300 bg-[#f8fafc] min-h-[360px] p-4 md:p-6"
        style={{
          backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      >
        {notes.length === 0 ? (
          <p className="text-center text-slate-500 text-sm font-medium py-16">
            Nenhum post-it ainda. Use o formulário acima.
          </p>
        ) : (
          <div className="flex flex-wrap gap-4 justify-start content-start">
            {notes.map((n) => (
              <div
                key={n.id}
                className={`w-[200px] min-h-[160px] rounded-sm border-2 shadow-[3px_3px_0_0_rgba(15,23,42,0.08)] p-3 flex flex-col ${COLOR_STYLES[n.color]}`}
              >
                <div className="flex justify-end mb-1">
                  <button
                    type="button"
                    onClick={() => void remove(n.id)}
                    className="p-1 rounded hover:bg-black/10 text-current opacity-70"
                    title="Remover"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <textarea
                  className="flex-1 w-full bg-transparent border-none text-xs font-bold leading-snug outline-none resize-none placeholder:opacity-50"
                  defaultValue={n.body}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== n.body) void updateBody(n.id, v);
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
