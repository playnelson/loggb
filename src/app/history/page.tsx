'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  History, 
  Search, 
  Filter, 
  Download, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Calendar,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Package,
  User
} from 'lucide-react';

interface Movement {
  id: string;
  created_at: string;
  quantity: number;
  type: string;
  items: {
    description: string;
    unit: string;
  };
  employees?: {
    full_name: string;
  };
}

export default function HistoryPage() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('');

  const fetchMovements = async () => {
    setLoading(true);
    let query = supabase
      .from('movements')
      .select('*, items(description, unit), employees(full_name)')
      .order('created_at', { ascending: false });

    if (typeFilter !== 'ALL') {
      query = query.eq('type', typeFilter);
    }

    if (dateFilter) {
      // Filter by date (YYYY-MM-DD)
      const startOfDay = `${dateFilter}T00:00:00Z`;
      const endOfDay = `${dateFilter}T23:59:59Z`;
      query = query.gte('created_at', startOfDay).lte('created_at', endOfDay);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching history:', error);
    } else {
      setMovements(data as any || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchMovements();
  }, [typeFilter, dateFilter]);

  const filteredMovements = movements.filter(m =>
    m.items?.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.employees?.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const downloadCSV = () => {
    const headers = ['Data', 'Tipo', 'Material', 'Funcionário', 'Quantidade', 'Unidade'];
    const rows = filteredMovements.map(m => [
      new Date(m.created_at).toLocaleString(),
      m.type === 'IN' ? 'Entrada' : 'Saída',
      m.items?.description,
      m.employees?.full_name || 'N/A',
      m.quantity,
      m.items?.unit
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `historico_movimentacoes_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <History className="text-secondary" />
            Histórico Completo
          </h1>
          <p className="text-slate-500 text-sm">Registro detalhado de todas as entradas e saídas do sistema.</p>
        </div>
        <button 
          onClick={downloadCSV}
          className="flex items-center gap-2 bg-white border border-border px-4 py-2 rounded-lg text-primary font-bold text-sm hover:bg-slate-50 transition-all shadow-sm"
        >
          <Download size={16} />
          Exportar CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl border border-border shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Buscar por material ou funcionário..." 
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/50 outline-none transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1">
              <Filter size={14} className="text-slate-400" />
              <select 
                className="bg-transparent border-none text-sm font-bold text-slate-600 focus:ring-0 outline-none"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="ALL">Todos os Tipos</option>
                <option value="IN">Entradas (IN)</option>
                <option value="OUT">Saídas (OUT)</option>
              </select>
            </div>

            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1">
              <Calendar size={14} className="text-slate-400" />
              <input 
                type="date" 
                className="bg-transparent border-none text-sm font-bold text-slate-600 focus:ring-0 outline-none"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* History Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Data / Hora</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Tipo</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Material</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Colaborador</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Qtd.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    <Loader2 className="animate-spin inline mr-2 text-secondary" size={20} />
                    Carregando histórico...
                  </td>
                </tr>
              ) : filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-300 italic font-medium">Nenhuma movimentação encontrada com estes filtros.</td>
                </tr>
              ) : (
                filteredMovements.map((move) => (
                  <tr key={move.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-xs font-bold text-primary font-mono bg-slate-50 inline-block px-2 py-1 rounded">
                        {new Date(move.created_at).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${
                        move.type === 'IN' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-red-100 text-red-700'
                      }`}>
                        {move.type === 'IN' ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
                        {move.type === 'IN' ? 'Entrada' : 'Saída'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-white transition-colors">
                          <Package size={14} className="text-slate-400" />
                        </div>
                        <div className="flex flex-col">
                          <p className="text-sm font-bold text-primary leading-tight">{move.items?.description}</p>

                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {move.employees ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold text-secondary">
                            {move.employees.full_name.charAt(0)}
                          </div>
                          <span className="text-sm font-medium text-slate-600">{move.employees.full_name}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300 italic">Sistema / Almoxarifado</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={`text-sm font-black ${move.type === 'IN' ? 'text-green-600' : 'text-red-600'}`}>
                        {move.type === 'IN' ? '+' : '-'}{move.quantity}
                      </span>
                      <span className="ml-1 text-[10px] font-bold text-slate-400 lowercase">{move.items?.unit}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
