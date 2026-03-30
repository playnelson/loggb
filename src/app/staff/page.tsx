'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, UserPlus, Mail, Phone, ExternalLink, X, FileUp, Filter, Package, AlertCircle } from 'lucide-react';
import ImportSpreadsheet from '@/components/ImportSpreadsheet';

interface Possession {
  item_id: string;
  quantity: number;
  items: {
    code: string;
    description: string;
    category: string;
  };
}

interface Employee {
  id: string;
  full_name: string;
  role: string | null;
  status: string;
  possession?: Possession[];
}

export default function StaffPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [hasItemsFilter, setHasItemsFilter] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    full_name: '',
    role: '',
    status: 'Ativo'
  });

  const fetchEmployees = async () => {
    setLoading(true);
    // Fetch employees with their possession items joined
    const { data, error } = await supabase
      .from('employees')
      .select(`
        *,
        possession (
          quantity,
          item_id,
          items (
            code,
            description,
            category
          )
        )
      `)
      .order('full_name', { ascending: true });

    if (error) {
      console.error('Error fetching employees:', error);
      setEmployees([]);
    } else {
      setEmployees(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchEmployees();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const { error } = await supabase
      .from('employees')
      .insert([formData]);

    if (error) {
      console.error('Error adding employee:', error);
      alert('Erro ao cadastrar colaborador.');
    } else {
      setIsModalOpen(false);
      setFormData({ full_name: '', role: '', status: 'Ativo' });
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      fetchEmployees();
    }
    setIsSubmitting(false);
  };

  const filteredEmployees = employees.filter(e => {
    const matchesSearch = e.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (e.role && e.role.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'Todos' || e.status === statusFilter;
    const activePossessions = e.possession?.filter(p => p.quantity > 0) || [];
    const matchesHasItems = !hasItemsFilter || activePossessions.length > 0;
    
    return matchesSearch && matchesStatus && matchesHasItems;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">Quadro de Funcionários</h1>
          <p className="text-slate-500 text-sm">Monitoramento de ativos e gestão de pessoal.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 bg-slate-100 text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-200 transition-all font-medium text-sm"
          >
            <FileUp size={16} className="text-secondary" />
            Importar Histórico
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-all font-medium text-sm"
          >
            <UserPlus size={16} />
            Novo Colaborador
          </button>
        </div>
      </div>

      {isImportModalOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <ImportSpreadsheet 
            mode="movement"
            onComplete={() => {
              setIsImportModalOpen(false);
              fetchEmployees();
            }} 
          />
        </div>
      )}

      {/* Filters Container */}
      <div className="bg-white p-4 rounded-xl border border-border shadow-sm flex flex-col lg:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar por nome ou cargo..." 
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/50 outline-none"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1">
            <Filter size={14} className="text-slate-400" />
            <select 
              className="bg-transparent border-none text-sm focus:ring-0 outline-none font-medium text-slate-600"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="Todos">Todos Status</option>
              <option value="Ativo">Ativo</option>
              <option value="Em Férias">Em Férias</option>
              <option value="Afastado">Afastado</option>
              <option value="Desligado">Desligado</option>
            </select>
          </div>
          
          <button 
            onClick={() => setHasItemsFilter(!hasItemsFilter)}
            className={`flex items-center gap-2 px-3 py-1 rounded-lg border text-sm font-medium transition-all ${
              hasItemsFilter 
              ? 'bg-secondary/10 border-secondary text-secondary' 
              : 'bg-slate-50 border-slate-200 text-slate-600'
            }`}
          >
            <Package size={14} />
            Com Itens em Posse
          </button>
        </div>
      </div>

      {/* Staff Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Colaborador</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Cargo</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Equipamentos em Posse</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">Carregando quadro de funcionários...</td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">Nenhum funcionário encontrado.</td>
                </tr>
              ) : (
                filteredEmployees.map((e) => {
                  const activePossessions = e.possession?.filter(p => p.quantity > 0) || [];
                  return (
                    <tr key={e.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-primary font-bold uppercase shrink-0 group-hover:bg-secondary/10 group-hover:text-secondary transition-colors">
                            {e.full_name.charAt(0)}
                          </div>
                          <span className="font-bold text-primary">{e.full_name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-medium">
                        {e.role || '---'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${e.status === 'Ativo' ? 'bg-green-500' : 'bg-slate-300'}`}></div>
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{e.status}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2 max-w-md">
                          {activePossessions.length > 0 ? (
                            activePossessions.map((p, idx) => (
                              <div key={idx} className="flex items-center gap-1.5 bg-secondary/5 border border-secondary/10 px-2 py-1 rounded text-[10px] font-bold text-secondary">
                                <Package size={10} />
                                {p.items?.code} ({p.quantity})
                              </div>
                            ))
                          ) : (
                            <span className="text-[10px] text-slate-300 font-semibold italic">Nenhum item pendente</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="text-secondary hover:text-primary p-2 bg-secondary/5 border border-secondary/10 rounded-lg transition-all">
                          <ExternalLink size={16} />
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

      {/* Modal Cadastro Colaborador */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b border-border flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-primary">Novo Colaborador</h2>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1 hover:bg-slate-200 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-500">Nome Completo</label>
                <input 
                  required
                  type="text" 
                  placeholder="Nome do colaborador..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-secondary/20"
                  value={formData.full_name}
                  onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-500">Cargo / Função</label>
                <input 
                  required
                  type="text" 
                  placeholder="Ex: Téc. Eletricista"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                  value={formData.role}
                  onChange={(e) => setFormData({...formData, role: e.target.value})}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-500">Status Inicial</label>
                <select 
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                  value={formData.status}
                  onChange={(e) => setFormData({...formData, status: e.target.value})}
                >
                  <option value="Ativo">Ativo</option>
                  <option value="Em Férias">Em Férias</option>
                  <option value="Afastado">Afastado</option>
                  <option value="Desligado">Desligado</option>
                </select>
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
                  className="flex-1 p-3 bg-primary text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                >
                  {isSubmitting ? 'Salvando...' : 'Cadastrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
