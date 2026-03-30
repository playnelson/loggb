'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, UserPlus, Mail, Phone, ExternalLink, X, FileUp, Filter, Package, AlertCircle, History, RotateCcw, Download, Loader2, ArrowLeft } from 'lucide-react';
import ImportSpreadsheet from '@/components/ImportSpreadsheet';

interface Possession {
  item_id: string;
  quantity: number;
  items: {
    code: string;
    description: string;
    category: string;
    unit: string;
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

  // Modals for actions
  const [timelineEmployee, setTimelineEmployee] = useState<Employee | null>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [returnItem, setReturnItem] = useState<{employeeId: string, item: Possession} | null>(null);
  const [returnQty, setReturnQty] = useState<number>(0);

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
      .select(`
        *,
        possession (
          quantity,
          item_id,
          items (
            code,
            description,
            category,
            unit
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

  const openTimeline = async (employee: Employee) => {
    setTimelineEmployee(employee);
    const { data } = await supabase
      .from('movements')
      .select('*, items(description, unit, code)')
      .eq('employee_id', employee.id)
      .order('created_at', { ascending: false })
      .limit(30);
    setMovements(data || []);
  };

  const downloadFullHistory = async (employee: Employee) => {
    const { data } = await supabase
      .from('movements')
      .select('*, items(description, code)')
      .eq('employee_id', employee.id)
      .order('created_at', { ascending: false });

    if (!data) return;

    const content = `HISTÓRICO DE MOVIMENTAÇÕES - ${employee.full_name}\n` +
      `Gerado em: ${new Date().toLocaleString()}\n` +
      `--------------------------------------------------\n\n` +
      data.map(m => {
        const date = new Date(m.created_at).toLocaleString();
        const type = m.type === 'IN' ? '[DEVOLUÇÃO]' : '[RETIRADA] ';
        return `${date} | ${type} | ${m.quantity}x ${m.items?.description} (${m.items?.code})`;
      }).join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historico_${employee.full_name.toLowerCase().replace(/ /g, '_')}.txt`;
    a.click();
  };

  const handleReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnItem || returnQty <= 0) return;
    setIsSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Process Return Movement
    await supabase.from('movements').insert([{
      item_id: returnItem.item.item_id,
      employee_id: returnItem.employeeId,
      quantity: returnQty,
      type: 'IN',
      performed_by: user.id
    }]);

    // 2. Update Possession
    const newQty = returnItem.item.quantity - returnQty;
    if (newQty <= 0) {
      await supabase.from('possession').delete().match({ 
        employee_id: returnItem.employeeId, 
        item_id: returnItem.item.item_id 
      });
    } else {
      await supabase.from('possession').update({ quantity: newQty }).match({ 
        employee_id: returnItem.employeeId, 
        item_id: returnItem.item.item_id 
      });
    }

    // 3. Update Inventory
    await supabase.rpc('update_stock', { 
      p_item_id: returnItem.item.item_id, 
      p_quantity: returnQty 
    });

    setReturnItem(null);
    setIsSubmitting(false);
    fetchEmployees();
  };

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
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">Quadro de Funcionários</h1>
          <p className="text-slate-500 text-sm">Monitoramento de ativos e histórico por colaborador.</p>
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
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Equipamentos em Posse (Descrição)</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    <Loader2 className="animate-spin inline mr-2 text-secondary" size={20} />
                    Carregando quadro...
                  </td>
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
                        <div className="flex flex-wrap gap-2 max-w-sm">
                          {activePossessions.length > 0 ? (
                            activePossessions.map((p, idx) => (
                              <div key={idx} className="flex items-center gap-2 bg-secondary/5 border border-secondary/10 px-2 py-1 rounded text-[10px] font-bold text-secondary group/p">
                                <span className="truncate max-w-[120px]">{p.items?.description}</span>
                                <span className="bg-secondary/20 px-1 rounded">x{p.quantity}</span>
                                <button 
                                  onClick={() => { setReturnItem({employeeId: e.id, item: p}); setReturnQty(p.quantity); }}
                                  className="hover:text-red-500 transition-colors ml-1" 
                                  title="Devolver Item"
                                >
                                  <RotateCcw size={10} />
                                </button>
                              </div>
                            ))
                          ) : (
                            <span className="text-[10px] text-slate-300 font-semibold italic">Nenhum item em posse</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => openTimeline(e)}
                          className="text-slate-400 hover:text-secondary p-2 bg-slate-50 border border-slate-200 rounded-lg transition-all"
                          title="Ver Histórico"
                        >
                          <History size={16} />
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

      {/* Modal Histórico do Colaborador (Timeline) */}
      {timelineEmployee && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-primary">{timelineEmployee.full_name}</h3>
                <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">Histórico de Movimentações (Últimas 30)</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => downloadFullHistory(timelineEmployee)}
                  className="flex items-center gap-2 text-primary bg-white border border-border px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-100 transition-colors"
                >
                  <Download size={14} />
                  Baixar TXT
                </button>
                <button onClick={() => setTimelineEmployee(null)} className="p-2 hover:bg-slate-200 rounded-full">
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
              <div className="relative border-l-2 border-slate-100 ml-3 space-y-6">
                {movements.length === 0 ? (
                  <p className="text-center text-slate-400 py-8 italic ml-[-12px]">Nenhuma movimentação para este colaborador.</p>
                ) : (
                  movements.map((m) => (
                    <div key={m.id} className="relative pl-6">
                      <div className={`absolute left-[-9px] top-1 w-4 h-4 rounded-full border-2 border-white shadow-sm ${m.type === 'IN' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                      <div className="bg-white p-4 rounded-xl border border-border shadow-sm">
                        <div className="flex justify-between items-start mb-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${m.type === 'IN' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                            {m.type === 'IN' ? 'DEVOLUÇÃO' : 'RETIRADA'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">{new Date(m.created_at).toLocaleString()}</span>
                        </div>
                        <h4 className="font-bold text-primary text-sm">{m.items?.description}</h4>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-slate-500 uppercase font-bold">Código: {m.items?.code}</span>
                          <span className="text-sm font-bold text-primary">{m.quantity} {m.items?.unit}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Devolução */}
      {returnItem && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b border-border bg-slate-50">
              <h3 className="text-xl font-bold text-primary">Processar Devolução</h3>
              <p className="text-xs text-slate-500 mt-1">{returnItem.item.items?.description}</p>
            </div>
            <form onSubmit={handleReturn} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-400">Quantidade a Devolver</label>
                <div className="flex items-center gap-3">
                  <input 
                    required
                    type="number" 
                    min="1" 
                    max={returnItem.item.quantity}
                    className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-lg text-lg font-bold outline-none focus:ring-2 focus:ring-secondary/50"
                    value={returnQty === 0 ? '' : returnQty}
                    onChange={(e) => setReturnQty(Math.min(returnItem.item.quantity, Number(e.target.value)))}
                    onFocus={(e) => e.target.select()}
                  />
                  <span className="text-sm font-bold text-slate-400">de {returnItem.item.quantity}</span>
                </div>
              </div>
              <div className="flex gap-2 pt-4">
                <button 
                  type="button"
                  onClick={() => setReturnItem(null)}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 p-3 bg-primary text-white rounded-xl font-bold hover:bg-slate-800 shadow-lg shadow-primary/20 disabled:opacity-50"
                >
                  {isSubmitting ? '...' : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-secondary/20 font-bold"
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
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
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
