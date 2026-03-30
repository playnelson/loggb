'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { ShoppingCart, User, Package, ArrowRight, CheckCircle2, History, Loader2, Clock } from 'lucide-react';

interface Product {
  id: string;
  code: string;
  description: string;
  quantity_current: number;
}

interface Employee {
  id: string;
  full_name: string;
}

interface RecentMovement {
  id: string;
  created_at: string;
  quantity: number;
  type: string;
  items: { code: string };
  employees: { full_name: string };
}

export default function MovementPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [recentMovements, setRecentMovements] = useState<RecentMovement[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [success, setSuccess] = useState(false);

  const fetchData = async () => {
    const { data: pData } = await supabase.from('items').select('*').order('code');
    const { data: eData } = await supabase.from('employees').select('*').order('full_name');
    
    // Fetch recent movements
    const { data: mData } = await supabase
      .from('movements')
      .select('id, created_at, quantity, type, items(code), employees(full_name)')
      .order('created_at', { ascending: false })
      .limit(5);

    setProducts(pData || []);
    setEmployees(eData || []);
    setRecentMovements(mData as any || []);
    setInitialLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchData();
  }, []);

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    if (!selectedProduct || !selectedEmployee || quantity <= 0) {
      alert('Por favor, preencha todos os campos corretamente.');
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Usuário não autenticado.');
      setLoading(false);
      return;
    }

    // 1. Record Movement
    const { error: moveError } = await supabase.from('movements').insert([
      { 
        item_id: selectedProduct, 
        employee_id: selectedEmployee, 
        quantity, 
        type: 'OUT',
        performed_by: user.id
      }
    ]);

    if (moveError) {
       console.error('Movement record error:', moveError);
       alert('Erro ao registrar movimentação.');
       setLoading(false);
       return;
    }

    // 2. Update Possession (UPSERT)
    const { data: currentPos } = await supabase
      .from('possession')
      .select('quantity')
      .eq('employee_id', selectedEmployee)
      .eq('item_id', selectedProduct)
      .single();
    
    const newQty = (currentPos?.quantity || 0) + quantity;
    await supabase.from('possession').upsert({
      employee_id: selectedEmployee,
      item_id: selectedProduct,
      quantity: newQty,
      user_id: user.id
    }, { onConflict: 'employee_id,item_id' });

    // 3. Update stock quantity locally and in DB (RPC should handle DB if set up, elsewhere manual)
    await supabase.rpc('update_stock', { 
      p_item_id: selectedProduct, 
      p_quantity: -quantity 
    });

    setSuccess(true);
    setLoading(false);
    setSelectedProduct('');
    setSelectedEmployee('');
    setQuantity(1);
    
    // Refresh data
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchData();
    
    setTimeout(() => setSuccess(false), 3000);
  }

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin text-secondary" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-primary">Fluxo de Movimentação</h1>
          <p className="text-slate-500 mt-1">Saída rápida de materiais do almoxarifado.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <form 
            onSubmit={handleCheckout} 
            className="bg-white rounded-2xl border border-border shadow-md p-8 relative overflow-hidden"
          >
            {success && (
              <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center z-20 animate-in fade-in zoom-in duration-300">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 text-green-500 shadow-lg shadow-green-100">
                  <CheckCircle2 size={32} />
                </div>
                <h3 className="text-xl font-bold text-primary">Saída Registrada!</h3>
                <p className="text-slate-500">O estoque e a posse do colaborador foram atualizados.</p>
              </div>
            )}

            <div className="space-y-6">
              <div className="space-y-4">
                <label className="flex items-center gap-2 text-sm font-bold text-primary uppercase tracking-wider">
                  <Package size={16} className="text-secondary" />
                  1. Selecionar Material
                </label>
                <select 
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all appearance-none cursor-pointer font-medium"
                  value={selectedProduct}
                  onChange={(e) => setSelectedProduct(e.target.value)}
                  required
                >
                  <option value="">Buscar material no estoque...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.code} - {p.description} ({p.quantity_current} disponíveis)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-4">
                <label className="flex items-center gap-2 text-sm font-bold text-primary uppercase tracking-wider">
                  <User size={16} className="text-secondary" />
                  2. Selecionar Colaborador
                </label>
                <select 
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all appearance-none cursor-pointer font-medium"
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  required
                >
                  <option value="">Quem está retirando o material?</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.full_name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <label className="text-sm font-bold text-primary uppercase tracking-wider block">
                    Quantidade
                  </label>
                  <input 
                    type="number" 
                    min="1"
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all font-bold"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    required
                  />
                </div>
                <div className="flex items-end">
                  <button 
                    type="submit"
                    disabled={loading}
                    className="w-full p-4 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 disabled:bg-slate-300 transition-all shadow-lg shadow-primary/20 group"
                  >
                    {loading ? <Loader2 className="animate-spin" /> : (
                      <>
                        Confirmar Baixa
                        <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-border p-6 shadow-sm">
            <h3 className="flex items-center gap-2 text-primary font-bold mb-4">
              <ShoppingCart size={18} className="text-secondary" />
              Resumo da Operação
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm py-2 border-b border-slate-50">
                <span className="text-slate-400">Material</span>
                <span className="text-primary font-bold">
                  {products.find(p => p.id === selectedProduct)?.code || '--'}
                </span>
              </div>
              <div className="flex justify-between text-sm py-2 border-b border-slate-50">
                <span className="text-slate-400">Funcionário</span>
                <span className="text-primary font-bold">
                  {employees.find(e => e.id === selectedEmployee)?.full_name || '--'}
                </span>
              </div>
              <div className="flex justify-between text-sm py-2 border-b border-slate-50">
                <span className="text-slate-400">Operação</span>
                <span className="text-red-500 font-bold uppercase">Saída (Empréstimo)</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl shadow-primary/40 overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <History size={100} />
            </div>
            <h3 className="flex items-center gap-2 font-bold mb-4 z-10 relative">
              <Clock size={18} className="text-secondary" />
              Histórico Recente
            </h3>
            <div className="space-y-4 z-10 relative">
              {recentMovements.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Nenhuma movimentação recente.</p>
              ) : (
                recentMovements.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 text-xs">
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                      <CheckCircle2 size={14} className="text-green-400" />
                    </div>
                    <div>
                      <p className="font-bold">{m.items?.code} - {m.employees?.full_name}</p>
                      <p className="text-slate-400">
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
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
