'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatProductLabelDisplay } from '@/lib/productDisplayText';
import { normalizeSearchText } from '@/lib/employeeName';
import { formatQty, parseQty } from '@/lib/movements';
import { buildCountSheetHtml, loadCompanyInfo, openPrintable } from '@/lib/printDocs';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Plus,
  Printer,
  Search,
  XCircle,
} from 'lucide-react';

type CountRow = {
  id: string;
  title: string;
  status: 'aberta' | 'concluida' | 'cancelada';
  blind: boolean;
  filter_category: string | null;
  filter_location: string | null;
  created_at: string;
  closed_at: string | null;
  adjusted_lines: number | null;
};

type LineRow = {
  id: string;
  item_id: string;
  system_qty: number | null;
  counted_qty: number | null;
  counted_at: string | null;
  description: string;
  unit: string;
  location: string;
  category: string;
  quantity_current: number;
};

const STATUS_LABEL: Record<CountRow['status'], string> = {
  aberta: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

function todayBr() {
  return new Date().toLocaleDateString('pt-BR');
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function diffOf(l: LineRow) {
  return l.counted_qty == null ? 0 : Math.round((l.counted_qty - Number(l.system_qty ?? 0)) * 1000) / 1000;
}

export default function InventarioPage() {
  const [counts, setCounts] = useState<CountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newBlind, setNewBlind] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) {
        if (!cancelled) setLoading(false);
        return;
      }
      const [c, cats] = await Promise.all([
        supabase
          .from('inventory_counts')
          .select('id, title, status, blind, filter_category, filter_location, created_at, closed_at, adjusted_lines')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase.from('item_categories').select('name').order('name', { ascending: true }),
      ]);
      if (cancelled) return;
      if (c.error) setListError(c.error.message);
      else setListError(null);
      setCounts(((c.data || []) as CountRow[]).sort((a, b) => Number(b.status === 'aberta') - Number(a.status === 'aberta')));
      setCategories(((cats.data || []) as Array<{ name: string }>).map((x) => x.name).filter(Boolean));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const startCount = async () => {
    const title = newTitle.trim() || `Inventário ${todayBr()}`;
    setCreating(true);
    const { data, error } = await supabase.rpc('start_inventory_count', {
      p_title: title,
      p_category: newCategory || null,
      p_location: newLocation.trim() || null,
      p_blind: newBlind,
    });
    setCreating(false);
    if (error) {
      alert(`Erro ao iniciar a contagem: ${error.message}`);
      return;
    }
    setShowNew(false);
    setNewTitle('');
    setNewCategory('');
    setNewLocation('');
    setNewBlind(false);
    setReloadKey((k) => k + 1);
    setOpenId(String(data));
  };

  if (openId) {
    return (
      <CountSheet
        countId={openId}
        onBack={() => {
          setOpenId(null);
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <ClipboardCheck className="text-secondary" />
            Inventário (contagem)
          </h1>
          <p className="text-slate-500 text-sm">
            Conte o estoque físico, compare com o sistema e ajuste tudo de uma vez, com histórico.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-3 rounded-lg font-bold text-sm min-h-[48px]"
        >
          <Plus size={18} />
          Nova contagem
        </button>
      </div>

      {showNew && (
        <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
          <h2 className="font-bold text-primary">Nova contagem</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-bold uppercase text-slate-500">Título</label>
              <input
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                placeholder={`Inventário ${todayBr()}`}
                maxLength={120}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">Categoria (opcional)</label>
              <select
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              >
                <option value="">Todas</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">Local contém (opcional)</label>
              <input
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                placeholder="Ex.: Prateleira A"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={newBlind} onChange={(e) => setNewBlind(e.target.checked)} />
            <span>
              <b>Contagem cega</b> — quem conta não vê o saldo do sistema (evita “copiar” o número). As diferenças
              aparecem só na hora de concluir.
            </span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="flex-1 sm:flex-none px-4 py-2.5 border border-slate-200 rounded-lg font-bold text-slate-500"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={creating}
              onClick={() => void startCount()}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-primary text-white rounded-lg font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {creating ? <Loader2 size={16} className="animate-spin" /> : null}
              Iniciar contagem
            </button>
          </div>
        </div>
      )}

      {listError ? (
        <p className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          Erro ao carregar contagens: {listError}
        </p>
      ) : null}

      <div className="bg-white rounded-xl border border-border shadow-sm divide-y divide-slate-100">
        {loading ? (
          <div className="p-10 text-center text-slate-400">
            <Loader2 className="animate-spin inline" />
          </div>
        ) : counts.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            Nenhuma contagem ainda. Comece com “Nova contagem” — dá para contar só uma categoria ou um local.
          </div>
        ) : (
          counts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpenId(c.id)}
              className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-bold text-primary truncate">{c.title}</div>
                <div className="text-[11px] text-slate-500">
                  {new Date(c.created_at).toLocaleDateString('pt-BR')}
                  {c.filter_category ? ` · ${c.filter_category}` : ''}
                  {c.filter_location ? ` · local “${c.filter_location}”` : ''}
                  {c.blind ? ' · cega' : ''}
                  {c.status === 'concluida' && c.adjusted_lines != null ? ` · ${c.adjusted_lines} ajuste(s)` : ''}
                </div>
              </div>
              <span
                className={`text-[10px] font-black uppercase px-2 py-1 rounded-full shrink-0 ${
                  c.status === 'aberta'
                    ? 'bg-amber-100 text-amber-800'
                    : c.status === 'concluida'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {STATUS_LABEL[c.status]}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function CountSheet({ countId, onBack }: { countId: string; onBack: () => void }) {
  const [count, setCount] = useState<CountRow | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'all' | 'pending' | 'diff'>('all');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: c, error: ce } = await supabase
        .from('inventory_counts')
        .select('id, title, status, blind, filter_category, filter_location, created_at, closed_at, adjusted_lines')
        .eq('id', countId)
        .maybeSingle();
      if (cancelled) return;
      if (ce || !c) {
        setError(ce?.message || 'Contagem não encontrada.');
        setLoading(false);
        return;
      }
      const all: LineRow[] = [];
      for (let from = 0; from < 100_000; from += 1000) {
        const { data, error: le } = await supabase
          .from('inventory_count_lines')
          .select('id, item_id, system_qty, counted_qty, counted_at, items(description, unit, location, category, quantity_current)')
          .eq('count_id', countId)
          .order('id', { ascending: true })
          .range(from, from + 999);
        if (cancelled) return;
        if (le) {
          setError(le.message);
          break;
        }
        const chunk = (data || []) as Array<Record<string, unknown>>;
        for (const r of chunk) {
          const it = one(r.items as Record<string, unknown> | Record<string, unknown>[] | null) || {};
          all.push({
            id: String(r.id),
            item_id: String(r.item_id),
            system_qty: r.system_qty == null ? null : Number(r.system_qty),
            counted_qty: r.counted_qty == null ? null : Number(r.counted_qty),
            counted_at: (r.counted_at as string | null) ?? null,
            description: String(it.description ?? '—'),
            unit: String(it.unit ?? 'un'),
            location: String(it.location ?? ''),
            category: String(it.category ?? ''),
            quantity_current: Number(it.quantity_current ?? 0),
          });
        }
        if (chunk.length < 1000) break;
      }
      all.sort(
        (a, b) => a.location.localeCompare(b.location, 'pt-BR') || a.description.localeCompare(b.description, 'pt-BR')
      );
      setCount(c as CountRow);
      setLines(all);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [countId, reloadKey]);

  const isOpen = count?.status === 'aberta';
  const hideSystem = Boolean(count?.blind && isOpen);
  const countedN = lines.filter((l) => l.counted_qty != null).length;
  const diffLines = lines.filter((l) => diffOf(l) !== 0);

  const visible = useMemo(() => {
    const q = normalizeSearchText(search);
    return lines.filter((l) => {
      if (view === 'pending' && l.counted_qty != null) return false;
      if (view === 'diff' && diffOf(l) === 0) return false;
      if (!q) return true;
      return normalizeSearchText(`${l.description} ${l.location} ${l.category}`).includes(q);
    });
  }, [lines, search, view]);

  const saveLine = useCallback(
    async (line: LineRow, raw: string) => {
      const trimmed = raw.trim();
      const value = trimmed === '' ? null : parseQty(trimmed);
      if (value != null && (!Number.isFinite(value) || value < 0)) {
        alert('Quantidade inválida.');
        return;
      }
      if (value === line.counted_qty) return;
      setSavingId(line.id);
      const { data, error: e } = await supabase.rpc('record_inventory_count', {
        p_line_id: line.id,
        p_counted: value,
      });
      setSavingId(null);
      if (e) {
        alert(`Erro ao salvar a contagem: ${e.message}`);
        return;
      }
      const sys = (data as { system_qty?: number | null } | null)?.system_qty;
      setLines((prev) =>
        prev.map((l) =>
          l.id === line.id
            ? {
                ...l,
                counted_qty: value,
                system_qty: value == null ? null : Number(sys ?? 0),
                counted_at: value == null ? null : new Date().toISOString(),
              }
            : l
        )
      );
      setDrafts((d) => {
        const next = { ...d };
        delete next[line.id];
        return next;
      });
    },
    []
  );

  const closeCount = async () => {
    if (!count) return;
    const uncounted = lines.length - countedN;
    const msg =
      `Concluir "${count.title}"?\n\n` +
      `• ${diffLines.length} item(ns) com diferença serão ajustados no estoque (motivo Inventário).\n` +
      (uncounted > 0 ? `• ${uncounted} item(ns) NÃO contados ficam como estão (não são zerados).\n` : '') +
      '\nDepois de concluída, a contagem não pode mais ser alterada.';
    if (!window.confirm(msg)) return;
    setClosing(true);
    const { data, error: e } = await supabase.rpc('close_inventory_count', { p_count_id: count.id });
    setClosing(false);
    if (e) {
      alert(`Erro ao concluir: ${e.message}`);
      return;
    }
    const r = (data || {}) as { adjusted?: number; clamped?: number; skipped_archived?: number };
    alert(
      `Contagem concluída. ${r.adjusted ?? 0} ajuste(s) lançado(s) no estoque.` +
        (r.clamped ? `\n${r.clamped} item(ns) tiveram saídas depois da contagem; o saldo foi ajustado até zero.` : '') +
        (r.skipped_archived ? `\n${r.skipped_archived} item(ns) arquivados foram ignorados.` : '')
    );
    setReloadKey((k) => k + 1);
  };

  const cancelCount = async () => {
    if (!count || !window.confirm('Cancelar esta contagem? Nada será ajustado no estoque.')) return;
    const { error: e } = await supabase.from('inventory_counts').update({ status: 'cancelada', closed_at: new Date().toISOString() }).eq('id', count.id);
    if (e) alert(`Erro ao cancelar: ${e.message}`);
    else setReloadKey((k) => k + 1);
  };

  const printSheet = () => {
    if (!count) return;
    const sheet = buildCountSheetHtml(
      count.title,
      lines.map((l) => ({ description: l.description, location: l.location, unit: l.unit, system_qty: l.quantity_current })),
      loadCompanyInfo(),
      { blind: count.blind }
    );
    void openPrintable(count.title, async () => sheet);
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300 max-w-5xl">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-bold text-secondary hover:underline">
        <ArrowLeft size={18} />
        Voltar às contagens
      </button>

      {loading ? (
        <div className="p-10 text-center text-slate-400">
          <Loader2 className="animate-spin inline" />
        </div>
      ) : error || !count ? (
        <p className="p-4 rounded-xl bg-red-50 border border-red-100 text-red-800 font-medium">{error}</p>
      ) : (
        <>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-primary">{count.title}</h1>
              <p className="text-sm text-slate-500">
                {STATUS_LABEL[count.status]} · {countedN} de {lines.length} contados
                {!hideSystem ? ` · ${diffLines.length} com diferença` : ''}
                {count.blind ? ' · contagem cega' : ''}
              </p>
              <div className="mt-2 h-2 w-full max-w-sm bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-secondary"
                  style={{ width: `${lines.length ? Math.round((countedN / lines.length) * 100) : 0}%` }}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={printSheet}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-primary"
              >
                <Printer size={16} />
                Folha de contagem
              </button>
              {isOpen && (
                <>
                  <button
                    type="button"
                    onClick={() => void cancelCount()}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-500"
                  >
                    <XCircle size={16} />
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={closing || countedN === 0}
                    onClick={() => void closeCount()}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-bold disabled:opacity-50"
                  >
                    {closing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    Concluir e ajustar estoque
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-border flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                placeholder="Buscar item, local ou categoria…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex p-1 bg-slate-100 rounded-lg text-xs font-bold">
              {(
                [
                  ['all', 'Todos'],
                  ['pending', 'Faltam contar'],
                  ...(hideSystem ? [] : [['diff', 'Com diferença']]),
                ] as Array<[typeof view, string]>
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setView(k)}
                  className={`px-3 py-1.5 rounded-md ${view === k ? 'bg-white text-primary shadow-sm' : 'text-slate-500'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border shadow-sm divide-y divide-slate-100">
            {visible.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">Nenhum item nesta visão.</div>
            ) : (
              visible.map((l) => {
                const d = diffOf(l);
                const draft = drafts[l.id];
                const shown = draft ?? (l.counted_qty == null ? '' : String(l.counted_qty).replace('.', ','));
                return (
                  <div key={l.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-primary">{formatProductLabelDisplay(l.description)}</div>
                      <div className="text-[11px] text-slate-500">
                        {l.location || 'sem local'} · {l.category || '—'}
                        {!hideSystem ? ` · sistema agora: ${formatQty(l.quantity_current)} ${l.unit}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:w-72">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={!isOpen || savingId === l.id}
                        placeholder="Contado"
                        className="w-28 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-right font-bold disabled:opacity-60"
                        value={shown}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [l.id]: e.target.value }))}
                        onBlur={(e) => {
                          if (draft !== undefined) void saveLine(l, e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                      />
                      <span className="text-xs font-bold text-slate-400 w-8">{l.unit}</span>
                      {savingId === l.id ? (
                        <Loader2 size={16} className="animate-spin text-secondary" />
                      ) : l.counted_qty == null ? null : hideSystem ? (
                        <span className="text-[11px] font-bold text-emerald-700">contado</span>
                      ) : d === 0 ? (
                        <span className="text-[11px] font-bold text-emerald-700">confere</span>
                      ) : (
                        <span className={`text-[11px] font-black ${d > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                          {d > 0 ? '+' : '−'}
                          {formatQty(Math.abs(d))} (sistema {formatQty(l.system_qty)})
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {isOpen ? (
            <p className="text-[11px] text-slate-400">
              A quantidade é salva ao sair do campo. A diferença compara com o saldo do sistema no momento em que você
              contou, então saídas feitas depois não atrapalham o ajuste.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
