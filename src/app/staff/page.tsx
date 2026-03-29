'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, UserPlus, Mail, Phone, ExternalLink } from 'lucide-react';

interface Employee {
  id: string;
  name: string;
  role: string | null;
  status: string;
  active_assets_count: number;
}

export default function StaffPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchEmployees = async () => {
    setLoading(true);
    // In a real app, you would join with movements to calculate assets
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching employees:', error);
      // Fallback data for preview
      setEmployees([
        { id: '1', name: 'Ricardo Silva', role: 'Soldador Especialista', status: 'Ativo', active_assets_count: 5 },
        { id: '2', name: 'Ana Oliveira', role: 'Segurança do Trabalho', status: 'Ativo', active_assets_count: 2 },
        { id: '3', name: 'Carlos Santos', role: 'Almoxarife Sênior', status: 'Em Férias', active_assets_count: 0 },
        { id: '4', name: 'Mariana Lima', role: 'Téc. Tubulação', status: 'Ativo', active_assets_count: 8 },
      ]);
    } else {
      setEmployees(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises, react-hooks/set-state-in-effect
    fetchEmployees();
  }, []);

  const filteredEmployees = employees.filter(e => 
    e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.role && e.role.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary text-navy-800">Quadro de Funcionários</h1>
          <p className="text-slate-500">Gestão de colaboradores e ativos em posse.</p>
        </div>
        <button className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-all font-medium">
          <UserPlus size={18} />
          Novo Colaborador
        </button>
      </div>

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
            <div key={e.id} className="bg-white rounded-xl border border-border p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-primary font-bold text-xl uppercase">
                    {e.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-primary group-hover:text-secondary transition-colors">{e.name}</h3>
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
                  <button className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-100 rounded-lg transition-colors text-slate-500">
                    <Mail size={16} />
                  </button>
                  <button className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-100 rounded-lg transition-colors text-slate-500">
                    <Phone size={16} />
                  </button>
                </div>
                <button className="flex items-center gap-2 text-sm font-bold text-primary hover:text-secondary transition-colors">
                  Ver Ficha de Ativos <ExternalLink size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
