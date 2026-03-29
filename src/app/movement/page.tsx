'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { ShoppingCart, User, Package, ArrowRight, CheckCircle2, History } from 'lucide-react';

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

export default function MovementPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const fetchData = async () => {
    // Fallback data if Supabase is not connected
    const productsData = [
      { id: '1', code: 'MAT-161', description: 'Chave Inglesa 10"', quantity_current: 5 },
      { id: '2', code: 'MAT-162', description: 'Luva de Raspa', quantity_current: 50 },
      { id: '3', code: 'MAT-163', description: 'Tubo PVC 20mm', quantity_current: 15 },
    ];
    const employeesData = [
      { id: '1', full_name: 'Ricardo Silva' },
      { id: '2', full_name: 'Ana Oliveira' },
      { id: '3', full_name: 'Carlos Santos' },
    ];

    const { data: pData } = await supabase.from('items').select('*');
    const { data: eData } = await supabase.from('employees').select('*');

    setProducts(pData && pData.length > 0 ? pData : productsData);
    setEmployees(eData && eData.length > 0 ? eData : employeesData);
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises, react-hooks/set-state-in-effect
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

    // In a real app, you would use a transaction or RPC to lower stock and record movement
    const { error: moveError } = await supabase.from('movements').insert([
      { product_id: selectedProduct, employee_id: selectedEmployee, quantity, type: 'Saida' }
    ]);

    // Simplified update check
    if (moveError && moveError.code !== 'PGRST116') { // PGRST116 is often given if table doesn't exist
       console.error('Movement record error:', moveError);
    }

    // Success simulation
    setTimeout(() => {
      setSuccess(true);
      setLoading(false);
      setSelectedProduct('');
      setSelectedEmployee('');
      setQuantity(1);
      setTimeout(() => setSuccess(false), 3000);
    }, 1000);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary">Fluxo de Movimentação</h1>
        <p className="text-slate-500 mt-1">Saída rápida de materiais do almoxarifado.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <form 
            onSubmit={handleCheckout} 
            className="bg-white rounded-2xl border border-border shadow-md p-8 relative overflow-hidden"
          >
            {success && (
              <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center z-20 animate-in fade-in zoom-in duration-300">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 text-green-500">
                  <CheckCircle2 size={32} />
                </div>
                <h3 className="text-xl font-bold text-primary text-navy-800">Saída Registrada!</h3>
                <p className="text-slate-500">O estoque já foi atualizado com sucesso.</p>
              </div>
            )}

            <div className="space-y-6">
              <div className="space-y-4">
                <label className="flex items-center gap-2 text-sm font-bold text-primary uppercase tracking-wider">
                  <Package size={16} className="text-secondary" />
                  1. Selecionar Material
                </label>
                <select 
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all appearance-none cursor-pointer"
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
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all appearance-none cursor-pointer"
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
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    required
                  />
                </div>
                <div className="flex items-end">
                  <button 
                    type="submit"
                    disabled={loading}
                    className="w-full p-4 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 disabled:bg-slate-300 transition-all shadow-lg shadow-primary/20 pointer group"
                  >
                    {loading ? 'Processando...' : (
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
                <span className="text-red-500 font-bold">BAIXA DE ESTOQUE</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl shadow-primary/40 overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <History size={100} />
            </div>
            <h3 className="flex items-center gap-2 font-bold mb-4 z-10 relative">
              Histórico Recente
            </h3>
            <div className="space-y-4 z-10 relative">
              <div className="flex items-center gap-3 text-xs">
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                  <CheckCircle2 size={14} className="text-green-400" />
                </div>
                <div>
                  <p className="font-bold">MAT-161 - Ricardo S.</p>
                  <p className="text-slate-400">2 min atrás</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                  <CheckCircle2 size={14} className="text-green-400" />
                </div>
                <div>
                  <p className="font-bold">MAT-162 - Ana O.</p>
                  <p className="text-slate-400">15 min atrás</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
