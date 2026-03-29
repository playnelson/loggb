'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Search, Plus, Filter, AlertCircle, MoreHorizontal, X, FileUp } from 'lucide-react';
import ImportSpreadsheet from '@/components/ImportSpreadsheet';

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

function InventoryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    code: '',
    description: '',
    category: 'Ferramenta',
    location: '',
    quantity_current: 0,
    quantity_min: 0,
    unit: 'un'
  });

  const fetchProducts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('code', { ascending: true });

    if (error) {
      console.error('Error fetching products:', error);
      // Fallback data for preview
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
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchProducts();
  }, []);

  useEffect(() => {
    if (searchParams?.get('new') === 'true') {
      setIsModalOpen(true);
      // Clear the param without full refresh
      router.replace('/inventory', { scroll: false });
    }
  }, [searchParams, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const { error } = await supabase
      .from('items')
      .insert([formData]);

    if (error) {
      console.error('Error adding item:', error);
      alert('Erro ao cadastrar item. Verifique o console.');
    } else {
      setIsModalOpen(false);
      setFormData({
        code: '',
        description: '',
        category: 'Ferramenta',
        location: '',
        quantity_current: 0,
        quantity_min: 0,
        unit: 'un'
      });
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      fetchProducts();
    }
    setIsSubmitting(false);
  };

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
        <div className="flex gap-2">
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 bg-slate-100 text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-200 transition-all font-medium"
          >
            <FileUp size={18} className="text-secondary" />
            Importar Inventário
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-all font-medium"
          >
            <Plus size={18} />
            Cadastrar Material
          </button>
        </div>
      </div>

      {isImportModalOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <ImportSpreadsheet 
            onComplete={() => {
              setIsImportModalOpen(false);
              fetchProducts();
            }} 
          />
        </div>
      )}

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

      {/* Modal Cadastro */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b border-border flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-primary">Novo Material</h2>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1 hover:bg-slate-200 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-500">Código</label>
                  <input 
                    required
                    type="text" 
                    placeholder="Ex: MAT-101"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/20 outline-none"
                    value={formData.code}
                    onChange={(e) => setFormData({...formData, code: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-500">Unidade</label>
                  <select 
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                    value={formData.unit}
                    onChange={(e) => setFormData({...formData, unit: e.target.value})}
                  >
                    <option value="un">Unidade (un)</option>
                    <option value="par">Par</option>
                    <option value="m">Metros (m)</option>
                    <option value="kg">Quilos (kg)</option>
                    <option value="cx">Caixa (cx)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-500">Descrição</label>
                <input 
                  required
                  type="text" 
                  placeholder="Nome do material..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-500">Categoria</label>
                  <select 
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                  >
                    <option value="Ferramenta">Ferramenta</option>
                    <option value="EPI">EPI</option>
                    <option value="Tubulação">Tubulação</option>
                    <option value="Consumível">Consumível</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-500">Localização</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Prateleira A1"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                    value={formData.location}
                    onChange={(e) => setFormData({...formData, location: e.target.value})}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-500 text-secondary">Qtd. Atual</label>
                  <input 
                    type="number" 
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                    value={formData.quantity_current}
                    onChange={(e) => setFormData({...formData, quantity_current: Number(e.target.value)})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-500 text-red-500">Qtd. Mínima</label>
                  <input 
                    type="number" 
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                    value={formData.quantity_min}
                    onChange={(e) => setFormData({...formData, quantity_min: Number(e.target.value)})}
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 p-3 bg-secondary text-white rounded-xl font-bold hover:bg-secondary/90 transition-all shadow-lg shadow-secondary/20 disabled:opacity-50"
                >
                  {isSubmitting ? 'Salvando...' : 'Cadastrar Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Carregando almoxarifado...</div>}>
      <InventoryContent />
    </Suspense>
  );
}
