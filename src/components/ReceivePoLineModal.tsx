'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatProductLabelDisplay } from '@/lib/productDisplayText';
import { normalizeSearchText } from '@/lib/employeeName';
import { formatQty, parseQty } from '@/lib/movements';
import {
  createItemForPoLine,
  exactItemForDescription,
  loadReceivableItems,
  receivePoItem,
  suggestItems,
  type ReceivableItem,
  type ReceivePoItemResult,
} from '@/lib/purchaseReceiving';
import { AlertCircle, Loader2, PackageCheck, Plus, Search, X } from 'lucide-react';

export type ReceivePoLine = {
  id: string;
  line_number: number;
  description: string;
  quantity: number | null;
  unit: string;
  received_quantity: number | null;
  stocked_quantity?: number | null;
  inventory_item_id?: string | null;
  stock_skip?: boolean | null;
};

const FALLBACK_CATEGORIES = ['Consumível', 'Ferramenta', 'EPI', 'Tubulação'];

type Props = {
  line: ReceivePoLine;
  ocNumber: string | null;
  onClose: () => void;
  onDone: (result: Extract<ReceivePoItemResult, { ok: true }>) => void;
};

/**
 * Recebimento de uma linha do pedido: escolhe/cria o item do almoxarifado, informa o total recebido
 * e mostra o que vai entrar no estoque antes de confirmar.
 */
export default function ReceivePoLineModal({ line, ocNumber, onClose, onDone }: Props) {
  const [items, setItems] = useState<ReceivableItem[] | null>(null);
  const [categories, setCategories] = useState<string[]>(FALLBACK_CATEGORIES);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(line.inventory_item_id ?? null);
  const [skip, setSkip] = useState(Boolean(line.stock_skip));
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newDesc, setNewDesc] = useState(formatProductLabelDisplay(line.description));
  const [newUnit, setNewUnit] = useState(line.unit || 'un');
  const [newCategory, setNewCategory] = useState('Consumível');
  const [newConsumable, setNewConsumable] = useState(true);
  const [received, setReceived] = useState<string>(() => {
    const cur = Number(line.received_quantity ?? 0);
    const full = line.quantity != null ? Number(line.quantity) : cur;
    return String(cur >= full ? cur : full).replace('.', ',');
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      try {
        const [list, cats] = await Promise.all([
          loadReceivableItems(supabase, user.id),
          supabase.from('item_categories').select('name').order('name', { ascending: true }),
        ]);
        if (cancelled) return;
        setItems(list);
        const names = ((cats.data || []) as Array<{ name: string }>).map((c) => c.name).filter(Boolean);
        if (names.length) setCategories(names);
        // Liga automaticamente se já existe item com a mesma descrição.
        if (!line.inventory_item_id) {
          const exact = exactItemForDescription(line.description, list);
          if (exact) setItemId(exact.id);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Erro ao carregar itens.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [line.description, line.inventory_item_id]);

  const selected = useMemo(() => items?.find((i) => i.id === itemId) ?? null, [items, itemId]);

  const options = useMemo(() => {
    if (!items) return [];
    const q = normalizeSearchText(search);
    if (q) return items.filter((i) => normalizeSearchText(i.description).includes(q)).slice(0, 30);
    return suggestItems(line.description, items);
  }, [items, search, line.description]);

  const receivedQty = parseQty(received);
  const stocked = Number(line.stocked_quantity ?? 0);
  const willLinkOrCreate = !skip && (Boolean(itemId) || creating);
  const stockDelta = willLinkOrCreate ? Math.round((receivedQty - stocked) * 1000) / 1000 : 0;
  const unitLabel = selected?.unit || (creating ? newUnit : line.unit) || 'un';
  const over = line.quantity != null && receivedQty > Number(line.quantity);

  const confirm = async () => {
    setError(null);
    if (!Number.isFinite(receivedQty) || receivedQty < 0) {
      setError('Informe uma quantidade recebida válida.');
      return;
    }
    if (!skip && !itemId && !creating && receivedQty > 0) {
      const ok = window.confirm(
        'Nenhum item do almoxarifado escolhido: o recebimento fica registrado, mas a entrada no estoque fica PENDENTE até você ligar um item. Continuar?'
      );
      if (!ok) return;
    }
    setBusy(true);
    let targetItem = itemId;
    if (!skip && creating) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setBusy(false);
        setError('Sessão expirada.');
        return;
      }
      const created = await createItemForPoLine(supabase, user.id, {
        description: newDesc,
        unit: newUnit,
        category: newCategory,
        consumable: newConsumable,
      });
      if (!created.ok) {
        setBusy(false);
        setError(created.message);
        return;
      }
      targetItem = created.id;
    }
    const res = await receivePoItem(supabase, {
      lineId: line.id,
      received: receivedQty,
      itemId: skip ? null : targetItem,
      stockSkip: skip,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onDone(res);
  };

  return (
    <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b bg-slate-50 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-primary flex items-center gap-2">
              <PackageCheck size={20} className="text-secondary shrink-0" />
              Receber item {line.line_number}
              {ocNumber ? <span className="text-slate-400 font-medium">· OC {ocNumber}</span> : null}
            </h3>
            <p className="text-xs text-slate-600 mt-1 break-words">{line.description}</p>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              Pedido: {line.quantity != null ? `${formatQty(line.quantity)} ${line.unit}` : '—'} · já recebido:{' '}
              {formatQty(line.received_quantity ?? 0)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-full" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-slate-500">Total recebido desta linha</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-lg text-lg font-bold outline-none focus:ring-2 focus:ring-secondary/40"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
              <span className="text-sm font-bold text-slate-400">{line.unit}</span>
            </div>
            {over ? (
              <p className="text-[11px] font-bold text-amber-700">Acima do pedido ({formatQty(line.quantity)}). Confira antes de confirmar.</p>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-600 cursor-pointer">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            Esta linha não entra no estoque (serviço, frete, taxa…)
          </label>

          {!skip && (
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase text-slate-500">Item do almoxarifado</div>
              {loadError ? (
                <p className="text-xs text-red-700 font-bold">{loadError}</p>
              ) : items == null ? (
                <div className="text-sm text-slate-400 flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" /> Carregando itens…
                </div>
              ) : creating ? (
                <div className="border border-secondary/30 bg-secondary/5 rounded-xl p-3 space-y-2">
                  <div className="text-[11px] font-bold uppercase text-secondary">Novo item (saldo começa em 0)</div>
                  <input
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm font-bold"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      className="p-2.5 bg-white border border-slate-200 rounded-lg text-sm"
                      value={newUnit}
                      maxLength={10}
                      onChange={(e) => setNewUnit(e.target.value)}
                      placeholder="un"
                    />
                    <select
                      className="col-span-2 p-2.5 bg-white border border-slate-200 rounded-lg text-sm"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                    >
                      {[...new Set([...categories, newCategory])].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                    <input type="checkbox" checked={newConsumable} onChange={(e) => setNewConsumable(e.target.checked)} />
                    Consumível (não volta para o almoxarifado)
                  </label>
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="text-xs font-bold text-slate-500 hover:underline"
                  >
                    Escolher um item existente
                  </button>
                </div>
              ) : (
                <>
                  {selected ? (
                    <div className="flex items-center justify-between gap-2 border border-emerald-200 bg-emerald-50 rounded-xl px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-emerald-900 truncate">
                          {formatProductLabelDisplay(selected.description)}
                        </div>
                        <div className="text-[11px] text-emerald-800">
                          Saldo atual {formatQty(selected.quantity_current)} {selected.unit} · {selected.category}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setItemId(null)}
                        className="text-xs font-bold text-emerald-800 hover:underline shrink-0"
                      >
                        Trocar
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                          placeholder="Buscar item do almoxarifado…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
                        {options.length === 0 ? (
                          <div className="p-3 text-xs text-slate-400 italic">
                            {search ? 'Nenhum item encontrado.' : 'Nenhuma sugestão parecida. Busque ou crie um item novo.'}
                          </div>
                        ) : (
                          options.map((it) => (
                            <button
                              key={it.id}
                              type="button"
                              onClick={() => setItemId(it.id)}
                              className="w-full text-left px-3 py-2 hover:bg-slate-50"
                            >
                              <div className="text-sm font-bold text-primary">{formatProductLabelDisplay(it.description)}</div>
                              <div className="text-[11px] text-slate-500">
                                Saldo {formatQty(it.quantity_current)} {it.unit} · {it.category}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                  {!selected && (
                    <button
                      type="button"
                      onClick={() => setCreating(true)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-secondary hover:underline"
                    >
                      <Plus size={14} /> Criar item novo com esta descrição
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700">
            {skip ? (
              'Só registra o recebimento; nada entra no estoque.'
            ) : !willLinkOrCreate ? (
              <span className="text-amber-800">
                Sem item ligado: o recebimento fica registrado e a entrada no estoque fica pendente.
              </span>
            ) : stockDelta > 0 ? (
              <>
                Vai dar <b>entrada de {formatQty(stockDelta)} {unitLabel}</b> no estoque
                {selected ? ` (saldo passa para ${formatQty(selected.quantity_current + stockDelta)})` : ''}.
              </>
            ) : stockDelta < 0 ? (
              <span className="text-red-700">
                Vai <b>retirar {formatQty(-stockDelta)} {unitLabel}</b> do estoque (estorno de recebimento).
              </span>
            ) : (
              'Nenhuma mudança no estoque.'
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-red-700 text-xs font-bold">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-slate-50 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 p-3 border border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-white"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || items == null}
            onClick={() => void confirm()}
            className="flex-1 p-3 bg-primary text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : null}
            Confirmar recebimento
          </button>
        </div>
      </div>
    </div>
  );
}
