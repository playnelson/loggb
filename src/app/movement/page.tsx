'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { recordMovement, updatePossessionQuantity, updateStock } from '@/lib/movements';
import {
  ShoppingCart,
  User,
  Package,
  CheckCircle2,
  History,
  Loader2,
  Clock,
  Plus,
  Trash2,
  Minus,
  Tag,
} from 'lucide-react';

interface Product {
  id: string;
  description: string;
  quantity_current: number;
  consumable: boolean;
  unique_item?: boolean;
  unit: string;
}

interface Employee {
  id: string;
  full_name: string;
  status?: string;
}

interface RecentMovement {
  id: string;
  created_at: string;
  quantity: number;
  type: string;
  items: { description: string };
  employees: { full_name: string };
}

interface CartLine {
  lineId: string;
  itemId: string;
  description: string;
  unit: string;
  quantity: number;
  consumable: boolean;
  unique_item: boolean;
  tag?: string;
}

function lineKey(itemId: string, tag: string | undefined, unique: boolean) {
  if (unique && tag) return `${itemId}::${tag.trim().toLowerCase()}`;
  return itemId;
}

export default function MovementPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [recentMovements, setRecentMovements] = useState<RecentMovement[]>([]);

  const [pickProductId, setPickProductId] = useState('');
  const [pickQty, setPickQty] = useState(1);
  const [pickTag, setPickTag] = useState('');

  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [success, setSuccess] = useState(false);

  const fetchData = async () => {
    const { data: pData } = await supabase
      .from('items')
      .select('id, description, quantity_current, consumable, unique_item, unit')
      .order('description');
    const { data: eData } = await supabase.from('employees').select('id, full_name, status').order('full_name');

    const { data: mData } = await supabase
      .from('movements')
      .select('id, created_at, quantity, type, items(description), employees(full_name)')
      .order('created_at', { ascending: false })
      .limit(5);

    setProducts((pData as Product[]) || []);
    setEmployees((eData || []).filter((e: Employee) => !e.status || e.status === 'Ativo'));
    setRecentMovements((mData as RecentMovement[]) || []);
    setInitialLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promise
    fetchData();
  }, []);

  const pickedProduct = useMemo(
    () => products.find((p) => p.id === pickProductId) || null,
    [products, pickProductId]
  );

  const qtyInCartForItem = useCallback(
    (itemId: string) =>
      cart.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.quantity, 0),
    [cart]
  );

  const addToCart = () => {
    if (!pickedProduct) {
      alert('Selecione um material.');
      return;
    }
    const isUnique = Boolean(pickedProduct.unique_item);
    const unitQty = isUnique ? 1 : Math.max(1, Math.floor(Number(pickQty) || 0));
    if (!Number.isFinite(unitQty) || unitQty < 1) {
      alert('Quantidade inválida.');
      return;
    }
    if (isUnique && !pickTag.trim()) {
      alert('Informe a TAG do item único.');
      return;
    }

    const alreadyInCart = qtyInCartForItem(pickedProduct.id);
    const available = pickedProduct.quantity_current - alreadyInCart;
    if (available < unitQty) {
      alert(
        available <= 0
          ? 'Não há saldo suficiente no estoque para este item (considerando o carrinho).'
          : `Saldo disponível: ${available} (considerando o carrinho). Reduza a quantidade.`
      );
      return;
    }

    if (isUnique) {
      const tagNorm = pickTag.trim();
      const dup = cart.some((l) => l.itemId === pickedProduct.id && (l.tag || '').trim().toLowerCase() === tagNorm.toLowerCase());
      if (dup) {
        alert('Esta TAG já está no carrinho para este item.');
        return;
      }
      setCart((prev) => [
        ...prev,
        {
          lineId: crypto.randomUUID(),
          itemId: pickedProduct.id,
          description: pickedProduct.description,
          unit: pickedProduct.unit || 'un',
          quantity: 1,
          consumable: pickedProduct.consumable,
          unique_item: true,
          tag: tagNorm,
        },
      ]);
      setPickTag('');
    } else {
      setCart((prev) => {
        const key = lineKey(pickedProduct.id, undefined, false);
        const idx = prev.findIndex((l) => lineKey(l.itemId, l.tag, l.unique_item) === key);
        if (idx === -1) {
          return [
            ...prev,
            {
              lineId: crypto.randomUUID(),
              itemId: pickedProduct.id,
              description: pickedProduct.description,
              unit: pickedProduct.unit || 'un',
              quantity: unitQty,
              consumable: pickedProduct.consumable,
              unique_item: false,
            },
          ];
        }
        const next = [...prev];
        const line = next[idx];
        const mergedQty = line.quantity + unitQty;
        if (mergedQty > pickedProduct.quantity_current) {
          alert('Saldo insuficiente ao somar com o que já está no carrinho.');
          return prev;
        }
        next[idx] = { ...line, quantity: mergedQty };
        return next;
      });
    }

    setPickQty(1);
  };

  const removeLine = (lineId: string) => {
    setCart((prev) => prev.filter((l) => l.lineId !== lineId));
  };

  const bumpLineQty = (lineId: string, delta: number) => {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.lineId === lineId);
      if (i === -1) return prev;
      const line = prev[i];
      if (line.unique_item) return prev;
      const stock = products.find((p) => p.id === line.itemId)?.quantity_current ?? 0;
      const others = prev.filter((l) => l.itemId === line.itemId && l.lineId !== lineId).reduce((s, l) => s + l.quantity, 0);
      const nextQty = line.quantity + delta;
      if (nextQty < 1) return prev.filter((l) => l.lineId !== lineId);
      if (others + nextQty > stock) {
        alert('Saldo insuficiente no estoque.');
        return prev;
      }
      const next = [...prev];
      next[i] = { ...line, quantity: nextQty };
      return next;
    });
  };

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEmployee) {
      alert('Selecione o colaborador que está retirando.');
      return;
    }
    if (cart.length === 0) {
      alert('Adicione ao menos um item ao carrinho.');
      return;
    }

    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Usuário não autenticado.');
      setLoading(false);
      return;
    }

    const { data: freshItems } = await supabase
      .from('items')
      .select('id, quantity_current, consumable')
      .in(
        'id',
        [...new Set(cart.map((c) => c.itemId))]
      );

    const stockMap = new Map<string, number>();
    for (const r of freshItems || []) {
      const row = r as { id: string; quantity_current?: number | null };
      stockMap.set(String(row.id), Number(row.quantity_current ?? 0));
    }

    const needByItem = new Map<string, number>();
    for (const line of cart) {
      needByItem.set(line.itemId, (needByItem.get(line.itemId) || 0) + line.quantity);
    }
    for (const [itemId, need] of needByItem) {
      const have = stockMap.get(itemId) ?? -1;
      if (have < need) {
        alert('O estoque mudou e não comporta mais esta retirada. Atualize quantidades e tente de novo.');
        setLoading(false);
        // eslint-disable-next-line @typescript-eslint/no-floating-promise
        fetchData();
        return;
      }
    }

    const batch = [...cart];
    for (let i = 0; i < batch.length; i++) {
      const line = batch[i];
      const mvRes = await recordMovement(supabase, {
        item_id: line.itemId,
        employee_id: selectedEmployee,
        quantity: line.quantity,
        type: 'OUT',
        performed_by: user.id,
        tag: line.tag || null,
      });
      if (!mvRes.ok) {
        alert(
          `Erro na linha ${i + 1}/${batch.length} (${line.description}): ${mvRes.message}\n` +
            (i > 0
              ? `As ${i} primeiras retirada(s) foram registradas. O carrinho foi atualizado com o que falta concluir.`
              : '')
        );
        setLoading(false);
        // eslint-disable-next-line @typescript-eslint/no-floating-promise
        fetchData();
        setCart(batch.slice(i));
        return;
      }

      if (!line.consumable) {
        const { data: currentPos } = await supabase
          .from('possession')
          .select('quantity')
          .eq('employee_id', selectedEmployee)
          .eq('item_id', line.itemId)
          .maybeSingle();

        const newQty = Number(currentPos?.quantity ?? 0) + line.quantity;
        const posRes = await updatePossessionQuantity(supabase, selectedEmployee, line.itemId, newQty, user.id);
        if (!posRes.ok) {
          alert(
            `Erro ao atualizar carteira (${line.description}): ${posRes.message}\n` +
              'A movimentação desta linha já foi registrada. Conferir histórico e carteira; itens seguintes foram mantidos no carrinho.'
          );
          setLoading(false);
          // eslint-disable-next-line @typescript-eslint/no-floating-promise
          fetchData();
          setCart(batch.slice(i + 1));
          return;
        }
      }

      const stockRes = await updateStock(supabase, line.itemId, -line.quantity);
      if (!stockRes.ok) {
        alert(
          `Estoque não atualizado: ${line.description}\n${stockRes.message}\n` +
            'Histórico e carteira desta linha podem já estar atualizados. Use “Ajustar estoque” em Inventário se necessário. Itens seguintes foram mantidos no carrinho.'
        );
        setLoading(false);
        // eslint-disable-next-line @typescript-eslint/no-floating-promise
        fetchData();
        setCart(batch.slice(i + 1));
        return;
      }
    }

    setCart([]);
    setPickProductId('');
    setPickQty(1);
    setPickTag('');
    setSuccess(true);
    setLoading(false);
    // eslint-disable-next-line @typescript-eslint/no-floating-promise
    fetchData();
    setTimeout(() => setSuccess(false), 3000);
  }

  const cartLineCount = cart.length;
  const cartUnitTotal = cart.reduce((s, l) => s + l.quantity, 0);

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin text-secondary" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold text-primary">Fluxo de Movimentação</h1>
        <p className="text-slate-500 mt-1">Monte um carrinho e registre várias retiradas de uma vez para o mesmo colaborador.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <form onSubmit={handleCheckout} className="space-y-6">
            <div className="bg-white rounded-2xl border border-border shadow-md p-6 overflow-hidden relative">
              {success && (
                <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center z-20 animate-in fade-in zoom-in duration-300">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 text-green-500 shadow-lg shadow-green-100">
                    <CheckCircle2 size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-primary">Retiradas registradas!</h3>
                  <p className="text-slate-500 text-center px-6">O estoque e a carteira foram atualizados.</p>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm font-bold text-primary uppercase tracking-wider mb-3">
                <User size={16} className="text-secondary" />
                Colaborador
              </label>
              <select
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary font-medium mb-6"
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                required
              >
                <option value="">Quem está retirando?</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>

              <div className="border-t border-slate-100 pt-6 space-y-4">
                <label className="flex items-center gap-2 text-sm font-bold text-primary uppercase tracking-wider">
                  <Package size={16} className="text-secondary" />
                  Adicionar ao carrinho
                </label>
                <select
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-secondary/50 font-medium"
                  value={pickProductId}
                  onChange={(e) => {
                    setPickProductId(e.target.value);
                    setPickTag('');
                    const p = products.find((x) => x.id === e.target.value);
                    setPickQty(p?.unique_item ? 1 : 1);
                  }}
                >
                  <option value="">Material no estoque…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.quantity_current <= 0}>
                      {p.description} — saldo {p.quantity_current}
                      {p.unique_item ? ' (único)' : ''}
                    </option>
                  ))}
                </select>

                {pickedProduct?.unique_item && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-[11px] font-black uppercase text-secondary">
                      <Tag size={14} />
                      TAG do item único
                    </label>
                    <input
                      type="text"
                      className="w-full p-3 border-2 border-secondary/40 rounded-xl font-bold tracking-wide"
                      placeholder="Ex.: TAG-000123"
                      value={pickTag}
                      onChange={(e) => setPickTag(e.target.value)}
                    />
                  </div>
                )}

                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Quantidade</label>
                    <input
                      type="number"
                      min={1}
                      disabled={Boolean(pickedProduct?.unique_item)}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold disabled:opacity-60"
                      value={pickedProduct?.unique_item ? 1 : pickQty === 0 ? '' : pickQty}
                      onChange={(e) => setPickQty(Number(e.target.value))}
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addToCart}
                    className="px-5 py-3 bg-secondary text-white rounded-xl font-bold flex items-center gap-2 hover:opacity-95 shadow-md"
                  >
                    <Plus size={18} />
                    Adicionar
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-border shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="flex items-center gap-2 text-lg font-bold text-primary">
                  <ShoppingCart size={20} className="text-secondary" />
                  Carrinho
                  <span className="text-slate-400 font-medium text-sm">
                    ({cartLineCount} {cartLineCount === 1 ? 'linha' : 'linhas'} · {cartUnitTotal} {cartUnitTotal === 1 ? 'unidade' : 'unidades'})
                  </span>
                </h2>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Limpar todo o carrinho?')) setCart([]);
                    }}
                    className="text-xs font-bold text-red-600 hover:underline"
                  >
                    Limpar
                  </button>
                )}
              </div>

              {cart.length === 0 ? (
                <p className="text-sm text-slate-400 italic py-6 text-center border border-dashed border-slate-200 rounded-xl">
                  Nenhum item ainda. Selecione o material e clique em Adicionar.
                </p>
              ) : (
                <ul className="space-y-2">
                  {cart.map((line) => (
                    <li
                      key={line.lineId}
                      className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl"
                    >
                      <div className="flex-1 min-w-[180px]">
                        <div className="font-bold text-primary text-sm">{line.description}</div>
                        <div className="text-[10px] text-slate-400 font-bold uppercase">
                          {line.unit}
                          {line.tag && (
                            <span className="ml-2 inline-flex items-center gap-1 text-secondary">
                              <Tag size={10} /> {line.tag}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!line.unique_item && (
                          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg">
                            <button
                              type="button"
                              className="p-2 hover:bg-slate-50 rounded-l-lg"
                              onClick={() => bumpLineQty(line.lineId, -1)}
                              aria-label="Diminuir"
                            >
                              <Minus size={14} />
                            </button>
                            <span className="px-2 font-black text-sm w-8 text-center">{line.quantity}</span>
                            <button
                              type="button"
                              className="p-2 hover:bg-slate-50 rounded-r-lg"
                              onClick={() => bumpLineQty(line.lineId, 1)}
                              aria-label="Aumentar"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        )}
                        {line.unique_item && <span className="font-black text-sm px-2">×1</span>}
                        <button
                          type="button"
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg ml-1"
                          onClick={() => removeLine(line.lineId)}
                          aria-label="Remover"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="submit"
                disabled={loading || cart.length === 0 || !selectedEmployee}
                className="w-full mt-6 p-4 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none transition-all shadow-lg"
              >
                {loading ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={20} />}
                Confirmar retirada do carrinho
              </button>
            </div>
          </form>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-border p-6 shadow-sm">
            <h3 className="flex items-center gap-2 text-primary font-bold mb-4">
              <ShoppingCart size={18} className="text-secondary" />
              Resumo
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span className="text-slate-400">Colaborador</span>
                <span className="text-primary font-bold text-right max-w-[160px] truncate">
                  {employees.find((e) => e.id === selectedEmployee)?.full_name || '—'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span className="text-slate-400">Itens no carrinho</span>
                <span className="text-primary font-bold">{cartUnitTotal}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span className="text-slate-400">Operação</span>
                <span className="text-red-500 font-bold uppercase text-[10px] bg-red-50 px-2 py-0.5 rounded">Saída (lote)</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <History size={100} />
            </div>
            <h3 className="flex items-center gap-2 font-bold mb-4 relative z-10">
              <Clock size={18} className="text-secondary" />
              Histórico recente
            </h3>
            <div className="space-y-4 relative z-10">
              {recentMovements.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Nenhuma movimentação recente.</p>
              ) : (
                recentMovements.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 text-xs">
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                      <CheckCircle2 size={14} className="text-green-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-100 truncate">{m.items?.description}</p>
                      <div className="flex justify-between items-center mt-1 gap-2">
                        <p className="text-[9px] text-slate-500 font-bold uppercase truncate">Colab: {m.employees?.full_name}</p>
                        <p className={`text-[10px] font-black shrink-0 ${m.type === 'IN' ? 'text-green-400' : 'text-red-400'}`}>
                          {m.type === 'IN' ? '+' : '-'}
                          {m.quantity}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
