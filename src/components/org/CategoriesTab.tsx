'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, GitMerge, Loader2, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { normCategory, type OrgCategory, type StockAreaRow } from '@/lib/permissions';
import { Chip, ErrorBox, FieldLabel, ModalActions, OrgModal } from '@/components/org/shared';

/** Chave para achar categorias parecidas: sem acento, sem caixa e sem plural ("Equipamento" = "EQUIPAMENTOS"). */
export function categorySimilarityKey(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('S') ? w.slice(0, -1) : w))
    .join(' ');
}

async function categoryAction(orgId: string, action: 'rename' | 'delete' | 'assign', from: string, to?: string | null) {
  const { data, error } = await supabase.rpc('org_category_action', {
    p_org: orgId,
    p_action: action,
    p_from: from,
    p_to: to ?? null,
  });
  if (error) {
    if (error.code === 'PGRST202' || /could not find the function/i.test(error.message)) {
      return { ok: false as const, message: 'O banco ainda não tem a gestão de categorias (etapa 15).' };
    }
    return { ok: false as const, message: error.message };
  }
  return { ok: true as const, items: Number((data as { items?: number } | null)?.items ?? 0) };
}

/**
 * Categorias da organização: em qual almoxarifado cada uma fica, renomear, juntar e apagar.
 * Tudo muda de uma vez nos itens, na lista de categorias e nos almoxarifados.
 */
export default function CategoriesTab({
  orgId,
  areas,
  categories,
  onChanged,
}: {
  orgId: string;
  areas: StockAreaRow[];
  categories: OrgCategory[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<OrgCategory | null>(null);
  const [creating, setCreating] = useState(false);

  const areaOf = useMemo(() => {
    const m = new Map<string, StockAreaRow>();
    for (const a of areas) for (const c of a.categories) m.set(normCategory(c), a);
    return m;
  }, [areas]);

  /** Outras categorias com nome parecido (singular/plural, acento, caixa). */
  const similar = useMemo(() => {
    const byKey = new Map<string, OrgCategory[]>();
    for (const c of categories) {
      const k = categorySimilarityKey(c.name);
      byKey.set(k, [...(byKey.get(k) ?? []), c]);
    }
    return (c: OrgCategory) => (byKey.get(categorySimilarityKey(c.name)) ?? []).filter((x) => x.name !== c.name);
  }, [categories]);

  const problems = categories.filter((c) => !c.registered || !areaOf.has(normCategory(c.name)) || similar(c).length > 0).length;

  const run = async (key: string, fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(key);
    setError(null);
    const res = await fn();
    if (!res.ok) setError(res.message ?? 'Não foi possível concluir.');
    await onChanged();
    setBusy(null);
  };

  const assign = (c: OrgCategory, areaId: string) => run(`a:${c.name}`, () => categoryAction(orgId, 'assign', c.name, areaId || null));

  const merge = (from: OrgCategory, into: OrgCategory) => {
    if (!confirm(`Juntar "${from.name}" em "${into.name}"? Os ${from.items} item(ns) de "${from.name}" passam para "${into.name}" e "${from.name}" deixa de existir.`)) return;
    void run(`m:${from.name}`, () => categoryAction(orgId, 'rename', from.name, into.name));
  };

  const remove = (c: OrgCategory) => {
    if (!confirm(`Apagar a categoria "${c.name}"?`)) return;
    void run(`d:${c.name}`, () => categoryAction(orgId, 'delete', c.name));
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 text-sm text-slate-600 leading-relaxed">
        Cada item tem uma <strong>categoria</strong>, e cada categoria fica em um <strong>almoxarifado</strong>. Item de
        categoria sem almoxarifado aparece em &quot;Sem almoxarifado&quot;. Renomear ou juntar categorias muda todos os
        itens de uma vez.
        {problems > 0 ? (
          <div className="mt-2 flex items-center gap-2 text-amber-800 font-bold">
            <AlertTriangle size={16} /> {problems} categoria(s) precisam de atenção (marcadas abaixo).
          </div>
        ) : null}
      </div>

      <ErrorBox message={error} />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-bar-2"
        >
          <Plus size={16} /> Nova categoria
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Categoria</th>
              <th className="px-3 py-2 text-right">Itens</th>
              <th className="px-3 py-2 text-left">Almoxarifado</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                  Nenhuma categoria ainda.
                </td>
              </tr>
            ) : (
              categories.map((c) => {
                const area = areaOf.get(normCategory(c.name));
                const twins = similar(c);
                const isBusy = busy?.endsWith(`:${c.name}`);
                return (
                  <tr key={c.name} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <div className="font-bold text-primary flex items-center gap-1.5">
                        {c.locked ? <Lock size={12} className="text-slate-400" /> : null}
                        {c.name}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {!c.registered ? <Chip tone="amber">Não cadastrada (veio de item ou importação)</Chip> : null}
                        {!area ? <Chip tone="amber">Sem almoxarifado</Chip> : null}
                        {twins.map((t) => (
                          <button
                            key={t.name}
                            type="button"
                            onClick={() => merge(c, t)}
                            disabled={Boolean(busy) || Boolean(c.locked)}
                            title={`Juntar "${c.name}" em "${t.name}"`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-900 text-[11px] font-bold hover:bg-amber-100 disabled:opacity-50"
                          >
                            <GitMerge size={11} /> Parecida com &quot;{t.name}&quot; — juntar nela
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-slate-600">{c.items}</td>
                    <td className="px-3 py-2">
                      <select
                        className="w-full min-w-40 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                        value={area?.id ?? ''}
                        disabled={Boolean(busy)}
                        onChange={(e) => void assign(c, e.target.value)}
                      >
                        <option value="">Sem almoxarifado</option>
                        {areas.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {isBusy ? <Loader2 size={16} className="animate-spin text-slate-400 m-2" /> : null}
                        <button
                          type="button"
                          onClick={() => setRenaming(c)}
                          disabled={Boolean(busy) || Boolean(c.locked)}
                          title={c.locked ? 'Categoria travada' : 'Renomear ou juntar com outra'}
                          className="p-2 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-40"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(c)}
                          disabled={Boolean(busy) || Boolean(c.locked) || c.items > 0}
                          title={c.items > 0 ? 'Tem itens: junte em outra categoria antes de apagar' : 'Apagar'}
                          className="p-2 rounded hover:bg-red-50 text-red-500 disabled:opacity-40"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {renaming ? (
        <RenameModal
          orgId={orgId}
          category={renaming}
          categories={categories}
          onClose={() => setRenaming(null)}
          onDone={async () => {
            setRenaming(null);
            await onChanged();
          }}
        />
      ) : null}
      {creating ? (
        <CreateModal
          orgId={orgId}
          areas={areas}
          categories={categories}
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false);
            await onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function RenameModal({
  orgId,
  category,
  categories,
  onClose,
  onDone,
}: {
  orgId: string;
  category: OrgCategory;
  categories: OrgCategory[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState(category.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = categories.find((c) => c.name !== category.name && normCategory(c.name) === normCategory(name));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || n === category.name) return onClose();
    setSaving(true);
    const res = await categoryAction(orgId, 'rename', category.name, target ? target.name : n);
    setSaving(false);
    if (!res.ok) return setError(res.message);
    await onDone();
  };

  return (
    <OrgModal title={`Categoria: ${category.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <FieldLabel htmlFor="cat-name">Novo nome</FieldLabel>
          <input
            id="cat-name"
            list="cat-existing"
            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg font-bold"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <datalist id="cat-existing">
            {categories
              .filter((c) => c.name !== category.name)
              .map((c) => (
                <option key={c.name} value={c.name} />
              ))}
          </datalist>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          {target ? (
            <>
              Já existe a categoria <strong>{target.name}</strong>: os {category.items} item(ns) de {category.name} vão
              para ela e <strong>{category.name}</strong> deixa de existir.
            </>
          ) : (
            <>Os {category.items} item(ns) e o almoxarifado passam a usar o nome novo.</>
          )}
        </p>
        <ErrorBox message={error} />
        <ModalActions onCancel={onClose} saving={saving} submitLabel={target ? 'Juntar' : 'Renomear'} />
      </form>
    </OrgModal>
  );
}

function CreateModal({
  orgId,
  areas,
  categories,
  onClose,
  onDone,
}: {
  orgId: string;
  areas: StockAreaRow[];
  categories: OrgCategory[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const twin = categories.find((c) => categorySimilarityKey(c.name) === categorySimilarityKey(name) && name.trim() !== '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Dê um nome para a categoria.');
    if (twin && !confirm(`Já existe "${twin.name}", parecida com "${n}". Criar mesmo assim?`)) return;
    setSaving(true);
    const res = await categoryAction(orgId, 'assign', n, areaId || null);
    setSaving(false);
    if (!res.ok) return setError(res.message);
    await onDone();
  };

  return (
    <OrgModal title="Nova categoria" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <FieldLabel htmlFor="cat-new">Nome</FieldLabel>
          <input
            id="cat-new"
            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg font-bold"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Equipamentos"
            autoFocus
          />
          {twin ? <p className="text-xs text-amber-800 font-bold mt-1">Já existe &quot;{twin.name}&quot;, parecida.</p> : null}
        </div>
        <div>
          <FieldLabel htmlFor="cat-area">Almoxarifado</FieldLabel>
          <select
            id="cat-area"
            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg"
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
          >
            <option value="">Sem almoxarifado</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <ErrorBox message={error} />
        <ModalActions onCancel={onClose} saving={saving} submitLabel="Criar categoria" />
      </form>
    </OrgModal>
  );
}
