'use client';

import { useMemo, useState } from 'react';
import { Layers, Loader2, Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatProductLabelDisplay } from '@/lib/productDisplayText';
import { normalizeSearchText } from '@/lib/employeeName';
import { sizeLabel, splitSize } from '@/lib/itemSizes';
import { SuggestInput } from './SuggestInput';
import { TagPlate } from './TagPlate';

export type GroupableItem = {
  id: string;
  description: string;
  tag?: string | null;
  category: string;
  group_name?: string | null;
};

/** Nome do grupo do jeito padrão: maiúsculas, sem espaços sobrando. */
export const cleanGroupName = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();
const sameGroup = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && normalizeSearchText(a) === normalizeSearchText(b);

/**
 * Criar ou editar um grupo de itens: dá um nome e marca os itens que fazem parte.
 * `editing` = nome do grupo que está sendo editado (null = grupo novo).
 */
export default function ItemGroupModal({
  editing,
  items,
  canEdit,
  onClose,
  onSaved,
}: {
  editing: string | null;
  /** Itens ativos do almoxarifado escolhido. */
  items: GroupableItem[];
  canEdit: (category: string) => boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const inGroup = useMemo(
    () => new Set(editing ? items.filter((i) => sameGroup(i.group_name, editing)).map((i) => i.id) : []),
    [items, editing]
  );
  const [name, setName] = useState(editing ?? '');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(inGroup));
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const groupNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) if (i.group_name?.trim()) m.set(normalizeSearchText(i.group_name), cleanGroupName(i.group_name));
    return [...m.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [items]);

  const editable = useMemo(() => items.filter((i) => canEdit(i.category)), [items, canEdit]);

  const list = useMemo(() => {
    const t = normalizeSearchText(q);
    const match = editable.filter(
      (i) => !t || normalizeSearchText(i.description).includes(t) || normalizeSearchText(i.tag || '').includes(t)
    );
    // Os que já estavam no grupo primeiro; depois em ordem alfabética (a lista não pula ao marcar).
    return match
      .sort(
        (a, b) =>
          Number(inGroup.has(b.id)) - Number(inGroup.has(a.id)) || a.description.localeCompare(b.description, 'pt-BR')
      )
      .slice(0, 300);
  }, [editable, q, inGroup]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const shownIds = list.map((i) => i.id);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selected.has(id));

  const save = async () => {
    const clean = cleanGroupName(name);
    if (!clean) return setError('Dê um nome ao grupo.');
    if (clean.length > 80) return setError('O nome do grupo pode ter até 80 letras.');
    if (selected.size === 0) return setError('Marque pelo menos um item.');
    const other = groupNames.find((g) => sameGroup(g, clean) && !sameGroup(g, editing));
    if (other && !confirm(`Já existe o grupo "${other}". Juntar estes itens a ele?`)) return;
    setSaving(true);
    setError('');
    const add = [...selected];
    const remove = [...inGroup].filter((id) => !selected.has(id));
    const r1 = await supabase.from('items').update({ group_name: other ?? clean }).in('id', add);
    const r2 = remove.length ? await supabase.from('items').update({ group_name: null }).in('id', remove) : { error: null };
    setSaving(false);
    const err = r1.error || r2.error;
    if (err) return setError(`Não consegui salvar o grupo: ${err.message}`);
    onSaved();
  };

  const undo = async () => {
    if (!editing) return;
    if (!confirm(`Desfazer o grupo "${editing}"? Os itens continuam cadastrados, só deixam de ficar juntos.`)) return;
    setSaving(true);
    const { error: err } = await supabase.from('items').update({ group_name: null }).in('id', [...inGroup]);
    setSaving(false);
    if (err) return setError(`Não consegui desfazer: ${err.message}`);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-2xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <Layers size={18} className="text-secondary" />
          <h2 className="font-bold text-primary mr-auto">{editing ? 'Editar grupo de itens' : 'Criar grupo de itens'}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-xs text-slate-500">
            Itens do mesmo grupo aparecem juntos numa linha só no almoxarifado, com estoque, posse e total somados. Ex.: junte
            “BOTA Nº 40” e “BOTA NUMERO 39” no grupo <b>BOTAS</b>.
          </p>
          {error ? <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700 font-medium">{error}</div> : null}
          <SuggestInput
            label="Nome do grupo"
            required
            options={groupNames}
            groupLabel="Grupos que já existem"
            placeholder="Ex.: BOTAS, RÁDIOS, FARDAMENTO"
            value={name}
            onChange={setName}
            className="space-y-1"
            inputClassName="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold uppercase focus:border-secondary"
          />

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none"
                placeholder="Procurar item para marcar…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="text-xs font-bold text-secondary hover:underline whitespace-nowrap"
              onClick={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  for (const id of shownIds) {
                    if (allShownSelected) next.delete(id);
                    else next.add(id);
                  }
                  return next;
                })
              }
            >
              {allShownSelected ? 'Desmarcar os da lista' : 'Marcar os da lista'}
            </button>
          </div>
          <div className="text-xs font-bold text-slate-600">{selected.size} item(ns) marcado(s)</div>

          <div className="border rounded-xl divide-y max-h-[45vh] overflow-y-auto">
            {list.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400">Nenhum item encontrado.</div>
            ) : (
              list.map((i) => {
                const s = splitSize(i.description);
                const plate = i.tag?.trim() || (s ? sizeLabel(s) : '');
                const elsewhere = i.group_name && !sameGroup(i.group_name, editing) ? cleanGroupName(i.group_name) : null;
                return (
                  <label key={i.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-secondary" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-primary truncate">{formatProductLabelDisplay(i.description)}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 uppercase font-bold">
                        {i.category}
                        {plate ? <TagPlate size="xs">{plate}</TagPlate> : null}
                        {elsewhere ? <span className="text-amber-700 normal-case">já está no grupo {elsewhere}</span> : null}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t flex flex-wrap gap-2">
          {editing ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void undo()}
              className="py-2.5 px-4 border border-red-200 text-red-700 rounded-xl font-bold text-sm hover:bg-red-50 disabled:opacity-50"
            >
              Desfazer grupo
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="ml-auto py-2.5 px-4 border rounded-xl font-bold text-slate-500 text-sm">
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="py-2.5 px-5 bg-primary text-white rounded-xl font-bold text-sm disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            Salvar grupo
          </button>
        </div>
      </div>
    </div>
  );
}
