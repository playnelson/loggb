'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Boxes, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { normCategory, type OrgCategory, type PersonRow, type StockAreaRow } from '@/lib/permissions';
import { Chip, ErrorBox, FieldLabel, ModalActions, OrgModal } from '@/components/org/shared';

/** Áreas do estoque: quais categorias cada uma cobre e quem gerencia. */
export default function AreasTab({
  orgId,
  areas,
  areaMembers,
  people,
  categories,
  onChanged,
}: {
  orgId: string;
  areas: StockAreaRow[];
  /** area_id -> user_ids */
  areaMembers: Map<string, string[]>;
  people: PersonRow[];
  categories: OrgCategory[];
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<StockAreaRow | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const emailById = useMemo(() => new Map(people.map((p) => [p.user_id, p.email])), [people]);
  const generalPeople = people.filter((p) => p.is_adm || p.all_areas);

  // Categorias que nenhuma área cobre: só ADM e "todas as áreas" mexem nelas.
  const uncovered = useMemo(() => {
    const covered = new Set(areas.flatMap((a) => a.categories.map(normCategory)));
    return categories.filter((c) => !covered.has(normCategory(c.name)));
  }, [areas, categories]);

  const remove = async (a: StockAreaRow) => {
    const n = areaMembers.get(a.id)?.length ?? 0;
    const msg = n
      ? `Apagar o almoxarifado "${a.name}"? ${n} pessoa(s) deixam de gerenciar esses itens.`
      : `Apagar o almoxarifado "${a.name}"?`;
    if (!window.confirm(msg)) return;
    const { error: delErr } = await supabase.from('stock_areas').delete().eq('id', a.id);
    setError(delErr ? delErr.message : null);
    await onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-xs text-slate-600 max-w-2xl">
          Cada almoxarifado junta categorias de itens (ex.: <strong>EPIs</strong> = categoria EPI) e tem seus responsáveis.
          Eles dão entrada, entregam, devolvem e editam esses itens; os outros almoxarifados ficam escondidos para eles.
          Um almoxarifado pode ter várias pessoas. O ADM vê e gerencia todos.
        </p>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-bold text-white bg-secondary rounded hover:opacity-95 shrink-0"
        >
          <Plus size={16} />
          Novo almoxarifado
        </button>
      </div>

      <ErrorBox message={error} />

      {areas.length === 0 ? (
        <div className="bg-white border border-slate-200 p-6 text-center text-sm text-slate-500">
          Nenhum almoxarifado criado. Comece por <strong>EPIs</strong>, <strong>Ferramentas</strong> e <strong>Equipamentos</strong>.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {areas.map((a) => {
            const members = areaMembers.get(a.id) ?? [];
            return (
              <div key={a.id} className="bg-white border border-slate-200 border-l-[3px] border-l-secondary p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-primary flex items-center gap-1.5">
                    <Boxes size={15} className="text-secondary" />
                    {a.name}
                  </h3>
                  <span className="flex gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditing(a)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-primary border border-slate-300 rounded hover:bg-slate-50"
                    >
                      <Pencil size={12} />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(a)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-red-600 border border-red-200 rounded hover:bg-red-50"
                      aria-label={`Apagar o almoxarifado ${a.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Categorias</p>
                  <span className="flex flex-wrap gap-1 mt-0.5">
                    {a.categories.length ? a.categories.map((c) => <Chip key={c}>{c}</Chip>) : <span className="text-xs text-slate-400">Nenhuma</span>}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Quem gerencia</p>
                  <span className="flex flex-wrap gap-1 mt-0.5">
                    {members.length ? (
                      members.map((uid) => (
                        <Chip key={uid} tone="green">
                          {emailById.get(uid) ?? 'Pessoa removida'}
                        </Chip>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400">Ninguém além dos ADMs</span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {uncovered.length > 0 ? (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-3 flex gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>
            Categorias sem almoxarifado: <strong>{uncovered.map((c) => c.name).join(', ')}</strong>. Esses itens só podem ser
            movimentados por ADM ou por quem tem &quot;todos os almoxarifados&quot;.
          </span>
        </div>
      ) : null}

      {generalPeople.length > 0 ? (
        <p className="text-[11px] text-slate-500">
          Gerenciam todos os almoxarifados: {generalPeople.map((p) => `${p.email}${p.is_adm ? ' (ADM)' : ''}`).join(', ')}.
        </p>
      ) : null}

      {editing ? (
        <AreaModal
          orgId={orgId}
          area={editing === 'new' ? null : editing}
          members={editing === 'new' ? [] : areaMembers.get(editing.id) ?? []}
          people={people.filter((p) => !p.is_adm)}
          categories={categories}
          otherAreas={areas.filter((a) => editing === 'new' || a.id !== editing.id)}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function AreaModal({
  orgId,
  area,
  members,
  people,
  categories,
  otherAreas,
  onClose,
  onSaved,
}: {
  orgId: string;
  area: StockAreaRow | null;
  members: string[];
  people: PersonRow[];
  categories: OrgCategory[];
  otherAreas: StockAreaRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(area?.name ?? '');
  const [cats, setCats] = useState<string[]>(area?.categories ?? []);
  const [extra, setExtra] = useState('');
  const [who, setWho] = useState<string[]>(members);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const has = (c: string) => cats.some((x) => normCategory(x) === normCategory(c));
  const toggle = (c: string, on: boolean) =>
    setCats((prev) => (on ? (prev.some((x) => normCategory(x) === normCategory(c)) ? prev : [...prev, c]) : prev.filter((x) => normCategory(x) !== normCategory(c))));

  // Categorias já salvas na área que não aparecem mais nos itens (ex.: digitadas à mão).
  const listed = new Set(categories.map((c) => normCategory(c.name)));
  const custom = cats.filter((c) => !listed.has(normCategory(c)));
  const areaOf = (c: string) => otherAreas.find((a) => a.categories.some((x) => normCategory(x) === normCategory(c)))?.name;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      setError('Dê um nome para o almoxarifado.');
      return;
    }
    if (cats.length === 0) {
      setError('Marque pelo menos uma categoria.');
      return;
    }
    setSaving(true);
    setError(null);
    let areaId = area?.id ?? null;
    if (areaId) {
      const { error: upErr } = await supabase
        .from('stock_areas')
        .update({ name: n, categories: cats, updated_at: new Date().toISOString() })
        .eq('id', areaId);
      if (upErr) {
        setSaving(false);
        setError(/duplicate|unique/i.test(upErr.message) ? 'Já existe um almoxarifado com esse nome.' : upErr.message);
        return;
      }
    } else {
      const { data, error: insErr } = await supabase
        .from('stock_areas')
        .insert([{ organization_id: orgId, name: n, categories: cats }])
        .select('id')
        .single();
      if (insErr || !data) {
        setSaving(false);
        setError(insErr && /duplicate|unique/i.test(insErr.message) ? 'Já existe um almoxarifado com esse nome.' : insErr?.message || 'Não foi possível criar o almoxarifado.');
        return;
      }
      areaId = String(data.id);
    }

    const removed = members.filter((u) => !who.includes(u));
    const added = who.filter((u) => !members.includes(u));
    if (removed.length) {
      const { error: delErr } = await supabase.from('stock_area_members').delete().eq('area_id', areaId).in('user_id', removed);
      if (delErr) {
        setSaving(false);
        setError(delErr.message);
        return;
      }
    }
    if (added.length) {
      const { error: insErr } = await supabase
        .from('stock_area_members')
        .insert(added.map((u) => ({ organization_id: orgId, area_id: areaId, user_id: u })));
      if (insErr) {
        setSaving(false);
        setError(insErr.message);
        return;
      }
    }
    setSaving(false);
    await onSaved();
  };

  return (
    <OrgModal title={area ? `Almoxarifado: ${area.name}` : 'Novo almoxarifado'} onClose={onClose} wide>
      <form onSubmit={submit} className="p-4 space-y-4">
        <ErrorBox message={error} />
        <div>
          <FieldLabel htmlFor="a-name">Nome do almoxarifado</FieldLabel>
          <input
            id="a-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: EPIs"
            maxLength={60}
            className="w-full p-2.5 border border-slate-300 rounded"
            autoFocus
          />
        </div>

        <fieldset>
          <legend className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
            Categorias de itens deste almoxarifado
          </legend>
          <div className="max-h-56 overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100">
            {categories.map((c) => {
              const other = areaOf(c.name);
              return (
                <label key={c.name} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={has(c.name)} onChange={(e) => toggle(c.name, e.target.checked)} />
                  <span className="font-medium text-primary">{c.name}</span>
                  <span className="text-xs text-slate-400">
                    {c.items} {c.items === 1 ? 'item' : 'itens'}
                    {c.spellings.length > 1 ? ` · também escrito ${c.spellings.filter((s) => s !== c.name).join(', ')}` : ''}
                  </span>
                  {other ? <span className="ml-auto text-[11px] text-amber-700">já está em {other}</span> : null}
                </label>
              );
            })}
            {custom.map((c) => (
              <label key={`x-${c}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                <input type="checkbox" checked onChange={() => toggle(c, false)} />
                <span className="font-medium text-primary">{c}</span>
                <span className="text-xs text-slate-400">nenhum item ainda</span>
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="Outra categoria (digite e adicione)"
              maxLength={80}
              className="flex-1 p-2 text-sm border border-slate-300 rounded"
            />
            <button
              type="button"
              onClick={() => {
                const v = extra.trim();
                if (v) toggle(v, true);
                setExtra('');
              }}
              className="px-3 py-2 text-sm font-bold text-primary border border-slate-300 rounded hover:bg-slate-50"
            >
              Adicionar
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Maiúsculas e minúsculas não importam: &quot;EPI&quot; e &quot;epi&quot; são a mesma.</p>
        </fieldset>

        <fieldset>
          <legend className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Responsáveis por este almoxarifado</legend>
          {people.length === 0 ? (
            <p className="text-xs text-slate-500">
              Ainda não há outras pessoas na organização. Convide pela aba <strong>Convites</strong>.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100">
              {people.map((p) => (
                <label key={p.user_id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    disabled={p.all_areas}
                    checked={p.all_areas || who.includes(p.user_id)}
                    onChange={(e) =>
                      setWho((prev) => (e.target.checked ? [...prev, p.user_id] : prev.filter((u) => u !== p.user_id)))
                    }
                  />
                  <span className="font-medium text-primary break-all">{p.email}</span>
                  {p.all_areas ? <span className="text-[11px] text-slate-400">já gerencia todos</span> : null}
                </label>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-1">Os ADMs gerenciam todos os almoxarifados automaticamente.</p>
        </fieldset>

        <ModalActions
          onCancel={onClose}
          saving={saving}
          submitLabel={area ? 'Salvar almoxarifado' : 'Criar almoxarifado'}
          icon={saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        />
      </form>
    </OrgModal>
  );
}
