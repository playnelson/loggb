'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, UserPlus, Mail, Phone, ExternalLink, X, FileUp } from 'lucide-react';
import ImportSpreadsheet from '@/components/ImportSpreadsheet';

interface Employee {
  id: string;
  full_name: string;
  role: string | null;
  status: string;
  active_assets_count: number;
}

export default function StaffPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
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
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('full_name', { ascending: true });

    if (error) {
      console.error('Error fetching employees:', error);
      // Fallback data for preview
      setEmployees([
        { id: '1', full_name: 'Ricardo Silva', role: 'Soldador Especialista', status: 'Ativo', active_assets_count: 5 },
        { id: '2', full_name: 'Ana Oliveira', role: 'Segurança do Trabalho', status: 'Ativo', active_assets_count: 2 },
        { id: '3', full_name: 'Carlos Santos', role: 'Almoxarife Sênior', status: 'Em Férias', active_assets_count: 0 },
        { id: '4', full_name: 'Mariana Lima', role: 'Téc. Tubulação', status: 'Ativo', active_assets_count: 8 },
      ]);
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

  const filteredEmployees = employees.filter(e => 
    e.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.role && e.role.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">Quadro de Funcionários</h1>
          <p className="text-slate-500">Gestão de colaboradores e ativos em posse.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 bg-slate-100 text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-200 transition-all font-medium"
          >
            <FileUp size={18} className="text-secondary" />
            Importar Histórico
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-all font-medium"
          >
            <UserPlus size={18} />
            Novo Colaborador
          </button>
        </div>
      </div>

      {isImportModalOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <ImportSpreadsheet 
            mode="movement"
            onComplete={() => {
              setIsImportModalOpen(false);
              fetchEmployees();
            }} 
          />
        </div>
      )}

      <div className="bg-white p-4 rounded-xl border border-border shadow-sm flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar por nome ou cargo..." 
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {loading ? (
          <div className="col-span-full py-12 text-center text-slate-400">Carregando quadro de funcionários...</div>
        ) : filteredEmployees.length === 0 ? (
          <div className="col-span-full py-12 text-center text-slate-400">Nenhum colaborador encontrado.</div>
        ) : (
          filteredEmployees.map((e) => (
            <div key={e.id} className="bg-white rounded-xl border border-border p-6 hover:shadow-md transition-shadow group">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-primary font-bold text-xl uppercase group-hover:bg-secondary group-hover:text-white transition-colors">
                    {e.full_name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-primary transition-colors">{e.full_name}</h3>
                    <p className="text-sm text-slate-500">{e.role || 'Cargo não definido'}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <div className={`w-2 h-2 rounded-full ${e.status === 'Ativo' ? 'bg-green-500' : 'bg-slate-300'}`}></div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{e.status}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="bg-secondary/10 text-secondary border border-secondary/20 px-3 py-1 rounded-full text-xs font-bold">
                    {e.active_assets_count} Itens em posse
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-slate-50 pt-4">
                <div className="flex gap-2">
                  <a 
                    href={`mailto:${e.full_name.toLowerCase().replace(' ', '.')}@empresa.com.br`}
                    className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-100 rounded-lg transition-colors text-slate-500"
                  >
                    <Mail size={16} />
                  </a>
                  <a 
                    href="tel:+5511999999999"
                    className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-100 rounded-lg transition-colors text-slate-500"
                  >
                    <Phone size={16} />
                  </a>
                </div>
                <button className="flex items-center gap-2 text-sm font-bold text-primary hover:text-secondary transition-colors">
                  Ver Ficha de Ativos <ExternalLink size={14} />
                </button>
              </div>
            </div>
          ))
        )}
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
