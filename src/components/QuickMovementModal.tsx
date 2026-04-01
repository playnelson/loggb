'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  X, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Package, 
  User, 
  Loader2, 
  CheckCircle2,
  AlertCircle,
  Tag
} from 'lucide-react';

interface Product {
  id: string;
  description: string;
  quantity_current: number;
  consumable: boolean;
  unit: string;
}

interface Employee {
  id: string;
  full_name: string;
}

interface QuickMovementModalProps {
  item: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  initialMode?: 'IN' | 'OUT';
}

type ItemHandling = 'CONSUMIVEL' | 'NAO_CONSUMIVEL' | 'ITEM_UNICO';

export default function QuickMovementModal({ 
  item, 
  isOpen, 
  onClose, 
  onComplete,
  initialMode = 'OUT'
}: QuickMovementModalProps) {
  const [mode, setMode] = useState<'IN' | 'OUT'>(initialMode);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [handling, setHandling] = useState<ItemHandling>('NAO_CONSUMIVEL');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEmployees = useCallback(async () => {
    const { data } = await supabase.from('employees').select('id, full_name').eq('status', 'Ativo').order('full_name');
    setEmployees(data || []);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setQuantity(1);
      setSelectedEmployee('');
      setTag('');
      setSuccess(false);
      setError(null);
      setHandling(item?.consumable ? 'CONSUMIVEL' : 'NAO_CONSUMIVEL');
      void fetchEmployees();
    }
  }, [isOpen, initialMode, item?.consumable, fetchEmployees]);

  const needsEmployee = useMemo(() => {
    // OUT: always identify who is taking (even if consumable) for audit/history.
    // IN: only needs employee when we're removing from someone's wallet (non-consumable / unique).
    if (mode === 'OUT') return true;
    return handling !== 'CONSUMIVEL';
  }, [mode, handling]);

  const isUnique = handling === 'ITEM_UNICO';

  const effectiveQty = useMemo(() => (isUnique ? 1 : quantity), [isUnique, quantity]);

  const validate = useCallback((): string | null => {
    if (!item) return 'Item inválido.';
    if (needsEmployee && !selectedEmployee) return mode === 'IN' ? 'Selecione quem está devolvendo.' : 'Selecione um colaborador para a saída.';
    if (effectiveQty <= 0) return 'Quantidade deve ser maior que zero.';
    if (mode === 'OUT' && effectiveQty > item.quantity_current) return 'Quantidade maior do que o saldo atual.';
    if (isUnique && !tag.trim()) return 'Informe a TAG do item único.';
    return null;
  }, [item, needsEmployee, selectedEmployee, mode, effectiveQty, isUnique, tag]);

  const insertMovement = useCallback(
    async (payload: Record<string, unknown>) => {
      const { error: err1 } = await supabase.from('movements').insert([payload]);
      if (!err1) return null;

      const msg = String(err1.message || '');
      // If DB doesn't have the optional column yet, retry without it.
      if (msg.toLowerCase().includes('column') && msg.toLowerCase().includes('tag')) {
        const { tag: _tag, ...withoutTag } = payload as { tag?: unknown };
        const { error: err2 } = await supabase.from('movements').insert([withoutTag]);
        if (!err2) return null;
        return err2;
      }

      return err1;
    },
    []
  );

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    
    setLoading(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Usuário não autenticado.');
      setLoading(false);
      return;
    }

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      setLoading(false);
      return;
    }

    // 1. Record Movement
    const movePayload: Record<string, unknown> = {
      item_id: item.id,
      employee_id: needsEmployee ? selectedEmployee : null,
      type: mode,
      quantity: effectiveQty,
      performed_by: user.id,
    };
    if (isUnique) movePayload.tag = tag.trim();

    const moveError = await insertMovement(movePayload);

    if (moveError) {
      setError(moveError.message || 'Erro ao registrar movimentação.');
      setLoading(false);
      return;
    }

    // 2. Update Possession (wallet)
    // - Consumível: não mexe na carteira (só estoque + histórico).
    // - Não consumível / Item único: OUT adiciona na carteira; IN remove da carteira.
    if (handling !== 'CONSUMIVEL' && selectedEmployee) {
      const { data: currentPos } = await supabase
        .from('possession')
        .select('quantity')
        .eq('employee_id', selectedEmployee)
        .eq('item_id', item.id)
        .maybeSingle();

      const currentQty = Number(currentPos?.quantity ?? 0);
      const nextQty = mode === 'OUT' ? currentQty + effectiveQty : currentQty - effectiveQty;

      if (mode === 'IN' && nextQty < 0) {
        setError('Esse colaborador não tem essa quantidade na carteira para devolver.');
        setLoading(false);
        return;
      }

      if (nextQty <= 0) {
        await supabase.from('possession').delete().match({
          employee_id: selectedEmployee,
          item_id: item.id,
        });
      } else {
        await supabase.from('possession').upsert(
          {
            employee_id: selectedEmployee,
            item_id: item.id,
            quantity: nextQty,
            user_id: user.id,
          },
          { onConflict: 'employee_id,item_id' }
        );
      }
    }

    // 3. Update stock quantity via RPC
    const rpcQty = mode === 'IN' ? effectiveQty : -effectiveQty;
    const { error: stockError } = await supabase.rpc('update_stock', { 
      p_item_id: item.id, 
      p_quantity: rpcQty 
    });

    if (stockError) {
      console.error('Stock update error:', stockError);
    }

    setSuccess(true);
    setLoading(false);
    
    setTimeout(() => {
      onComplete();
      onClose();
    }, 1500);
  };

  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-300">
        <div className="p-6 border-b border-border flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${mode === 'IN' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
              {mode === 'IN' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-primary leading-tight">
                {mode === 'IN' ? 'Entrada' : 'Saída'} - {item.description}
              </h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">UNIDADE: {item.unit}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleAction} className="p-6 space-y-6">
          {success ? (
            <div className="py-8 text-center space-y-4 animate-in zoom-in duration-300">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-500">
                <CheckCircle2 size={32} />
              </div>
              <h3 className="text-xl font-bold text-primary">Movimentação Concluída!</h3>
              <p className="text-slate-500">O estoque foi atualizado com sucesso.</p>
            </div>
          ) : (
            <>
              {/* Mode Toggle */}
              <div className="flex p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setMode('OUT')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${
                    mode === 'OUT' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <ArrowUpRight size={16} />
                  Saída
                </button>
                <button
                  type="button"
                  onClick={() => setMode('IN')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${
                    mode === 'IN' ? 'bg-white text-green-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <ArrowDownLeft size={16} />
                  Entrada
                </button>
              </div>

              {/* Handling options */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-400 flex items-center gap-2">
                  <Package size={14} className="text-secondary" />
                  Tipo do item no lançamento
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setHandling('CONSUMIVEL')}
                    className={`px-3 py-2 rounded-lg text-xs font-black border transition-all ${
                      handling === 'CONSUMIVEL'
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                    title="Consumível: não entra na carteira do colaborador (só histórico e estoque)"
                  >
                    Consumível
                  </button>
                  <button
                    type="button"
                    onClick={() => setHandling('NAO_CONSUMIVEL')}
                    className={`px-3 py-2 rounded-lg text-xs font-black border transition-all ${
                      handling === 'NAO_CONSUMIVEL'
                        ? 'bg-blue-50 border-blue-200 text-blue-800'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                    title="Não consumível: entra/sai da carteira do colaborador"
                  >
                    Não consumível
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHandling('ITEM_UNICO');
                      setQuantity(1);
                    }}
                    className={`px-3 py-2 rounded-lg text-xs font-black border transition-all ${
                      handling === 'ITEM_UNICO'
                        ? 'bg-secondary/10 border-secondary/40 text-secondary'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                    title="Item único: normalmente 1 unidade com TAG"
                  >
                    Item único
                  </button>
                </div>
                <div className="text-[10px] text-slate-400 font-bold">
                  Dica: “Item único” força quantidade 1 e pede TAG.
                </div>
              </div>

              {needsEmployee && (
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-400 flex items-center gap-2">
                    <User size={14} className="text-secondary" />
                    {mode === 'IN' ? 'Quem está devolvendo?' : 'Quem está retirando?'}
                  </label>
                  <select
                    required
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/20 outline-none font-medium"
                    value={selectedEmployee}
                    onChange={(e) => setSelectedEmployee(e.target.value)}
                  >
                    <option value="">{mode === 'IN' ? 'Selecione quem está devolvendo...' : 'Selecione o colaborador...'}</option>
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>{e.full_name}</option>
                    ))}
                  </select>
                </div>
              )}

              {isUnique && (
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase flex items-center gap-2 text-secondary">
                    <Tag size={14} />
                    TAG do item único *
                  </label>
                  <input
                    required
                    type="text"
                    className="w-full p-3 bg-white border-2 border-secondary/60 rounded-lg focus:ring-4 focus:ring-secondary/15 outline-none font-black tracking-wide text-primary"
                    placeholder="Ex.: TAG-000123"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                  />
                  <div className="text-[10px] text-slate-400 font-bold">
                    Essa TAG vai junto no histórico da movimentação.
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-400">Quantidade</label>
                  <input
                    required
                    type="number"
                    min="1"
                    disabled={isUnique}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/20 outline-none font-bold text-center text-lg disabled:opacity-60"
                    value={effectiveQty}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-400">Saldo Atual</label>
                  <div className="w-full p-3 bg-slate-100 border border-slate-200 rounded-lg text-center">
                    <span className="font-bold text-primary text-lg">{item.quantity_current}</span>
                    <span className="ml-1 text-xs text-slate-400">{item.unit}</span>
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-red-600 text-xs font-bold animate-in shake duration-300">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`w-full p-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg disabled:opacity-50 ${
                  mode === 'IN' 
                  ? 'bg-green-600 text-white shadow-green-100 hover:bg-green-700' 
                  : 'bg-red-600 text-white shadow-red-100 hover:bg-red-700'
                }`}
              >
                {loading ? <Loader2 className="animate-spin" /> : (
                  <>
                    Confirmar {mode === 'IN' ? 'Entrada' : 'Saída'}
                    <Package size={20} />
                  </>
                )}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
