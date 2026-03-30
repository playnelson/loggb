'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  X, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Package, 
  User, 
  Loader2, 
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface Product {
  id: string;
  code: string;
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
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setQuantity(1);
      setSelectedEmployee('');
      setSuccess(false);
      setError(null);
      fetchEmployees();
    }
  }, [isOpen, initialMode]);

  const fetchEmployees = async () => {
    const { data } = await supabase.from('employees').select('id, full_name').eq('status', 'Ativo').order('full_name');
    setEmployees(data || []);
  };

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

    if (mode === 'OUT' && !selectedEmployee) {
      setError('Selecione um colaborador para a saída.');
      setLoading(false);
      return;
    }

    if (quantity <= 0) {
      setError('Quantidade deve ser maior que zero.');
      setLoading(false);
      return;
    }

    // 1. Record Movement
    const { error: moveError } = await supabase.from('movements').insert([{
      item_id: item.id,
      employee_id: mode === 'OUT' ? selectedEmployee : null,
      type: mode,
      quantity: quantity,
      performed_by: user.id
    }]);

    if (moveError) {
      setError('Erro ao registrar movimentação.');
      setLoading(false);
      return;
    }

    // 2. Update Possession (Only for OUT and non-consumables)
    if (mode === 'OUT' && !item.consumable && selectedEmployee) {
      const { data: currentPos } = await supabase
        .from('possession')
        .select('quantity')
        .eq('employee_id', selectedEmployee)
        .eq('item_id', item.id)
        .single();
      
      const newPosQty = (currentPos?.quantity || 0) + quantity;
      await supabase.from('possession').upsert({
        employee_id: selectedEmployee,
        item_id: item.id,
        quantity: newPosQty,
        user_id: user.id
      }, { onConflict: 'employee_id,item_id' });
    }

    // 3. Update stock quantity via RPC
    const rpcQty = mode === 'IN' ? quantity : -quantity;
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

              {mode === 'OUT' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-400 flex items-center gap-2">
                    <User size={14} className="text-secondary" />
                    Quem está retirando?
                  </label>
                  <select
                    required
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/20 outline-none font-medium"
                    value={selectedEmployee}
                    onChange={(e) => setSelectedEmployee(e.target.value)}
                  >
                    <option value="">Selecione o colaborador...</option>
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>{e.full_name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-400">Quantidade</label>
                  <input
                    required
                    type="number"
                    min="1"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/20 outline-none font-bold text-center text-lg"
                    value={quantity}
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
