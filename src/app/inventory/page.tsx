'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, Plus, Filter, AlertCircle, MoreHorizontal } from 'lucide-react';

interface Product {
  id: string;
  code: string;
  description: string;
  category: string;
  location: string;
  quantity_current: number;
  quantity_min: number;
  unit: string;
}

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchProducts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('code', { ascending: true });

    if (error) {
      console.error('Error fetching products:', error);
      // Fallback data for preview if Supabase is not connected
      setProducts([
        { id: '1', code: 'MAT-161', description: 'Chave Inglesa 10"', category: 'Ferramenta', location: 'Prateleira A1', quantity_current: 5, quantity_min: 10, unit: 'un' },
        { id: '2', code: 'MAT-162', description: 'Luva de Raspa', category: 'EPI', location: 'Gaveta B2', quantity_current: 50, quantity_min: 20, unit: 'par' },
        { id: '3', code: 'MAT-163', description: 'Tubo PVC 20mm', category: 'Tubulação', location: 'Pátio 4', quantity_current: 15, quantity_min: 30, unit: 'm' },
      ]);
    } else {
      setProducts(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises, react-hooks/set-state-in-effect
    fetchProducts();
  }, []);

  const filteredProducts = products.filter(p => 
    p.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">Almoxarifado LoggB</h1>
          <p className="text-slate-500">Gestão de materiais, EPIs e ferramentas.</p>
        </div>
        <button className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-all font-medium">
          <Plus size={18} />
          Cadastrar Material
        </button>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-xl border border-border shadow-sm flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar por código ou descrição..." 
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-all text-slate-600 font-medium whitespace-nowrap">
            <Filter size={18} />
            Categorias
          </button>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Código</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Descrição</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Categoria</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Local</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Quantidade</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Unidade</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">Carregando inventário...</td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">Nenhum item encontrado.</td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const isLowStock = p.quantity_current <= p.quantity_min;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4 font-mono text-sm font-bold text-primary">{p.code}</td>
                      <td className="px-6 py-4 text-slate-700">{p.description}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-md text-[10px] uppercase font-bold ${
                          p.category === 'Ferramenta' ? 'bg-blue-100 text-blue-700' :
                          p.category === 'EPI' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'
                        }`}>
                          {p.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">{p.location}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col items-center">
                          <span className={`text-sm font-bold ${isLowStock ? 'text-red-500' : 'text-primary'}`}>
                            {p.quantity_current}
                          </span>
                          {isLowStock && (
                            <div className="flex items-center gap-1 text-[10px] text-red-400 mt-0.5">
                              <AlertCircle size={10} />
                              Crítico ({p.quantity_min})
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">{p.unit}</td>
                      <td className="px-6 py-4 text-right">
                        <button className="p-2 hover:bg-slate-100 rounded-full transition-all text-slate-400 hover:text-primary">
                          <MoreHorizontal size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
