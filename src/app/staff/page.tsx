'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, UserPlus, Mail, Phone, ExternalLink, X, FileUp, Filter, Package, AlertCircle, History, RotateCcw, Download, Loader2, ArrowLeft, FileText } from 'lucide-react';
import ImportSpreadsheet from '@/components/ImportSpreadsheet';
import { downloadEpiFichaPdf } from '@/lib/epiFichaPdf';

interface Possession {
  item_id: string;
  quantity: number;
  items: {
    description: string;
    category: string;
    unit: string;
    consumable: boolean;
  };
}

interface Employee {
  id: string;
  full_name: string;
  role: string | null;
  status: string;
  cpf?: string | null;
  department?: string | null;
  possession?: Possession[];
}

const EPI_FICHA_STORAGE_KEY = 'loggb_epi_ficha_defaults';

type EpiFichaFormState = {
  companyName: string;
  companyCnpj: string;
  branchOrDept: string;
  issuedAt: string;
  responsibleName: string;
};

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
  const [epiFichaEmployee, setEpiFichaEmployee] = useState<Employee | null>(null);
  const [epiFichaForm, setEpiFichaForm] = useState<EpiFichaFormState>({
    companyName: '',
    companyCnpj: '',
    branchOrDept: '',
    issuedAt: '',
    responsibleName: '',
  });

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
            description,
            category,
            unit,
            consumable
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
      .select('*, items(description, unit)')
      .eq('employee_id', employee.id)
      .order('created_at', { ascending: false })
      .limit(30);
    setMovements(data || []);
  };

  const downloadFullHistory = async (employee: Employee) => {
    const { data } = await supabase
      .from('movements')
      .select('*, items(description)')
      .eq('employee_id', employee.id)
      .order('created_at', { ascending: false });

    if (!data) return;

    const content = `HISTÓRICO DE MOVIMENTAÇÕES - ${employee.full_name}\n` +
      `Gerado em: ${new Date().toLocaleString()}\n` +
      `--------------------------------------------------\n\n` +
      data.map(m => {
        const date = new Date(m.created_at).toLocaleString();
        const type = m.type === 'IN' ? '[DEVOLUÇÃO]' : '[RETIRADA] ';
        return `${date} | ${type} | ${m.quantity}x ${m.items?.description}`;
      }).join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historico_${employee.full_name.toLowerCase().replace(/ /g, '_')}.txt`;
    a.click();
  };

  const openEpiFichaModal = (employee: Employee) => {
    let saved: Partial<EpiFichaFormState> = {};
    if (typeof window !== 'undefined') {
      try {
        saved = JSON.parse(localStorage.getItem(EPI_FICHA_STORAGE_KEY) || '{}') as Partial<EpiFichaFormState>;
      } catch {
        saved = {};
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    setEpiFichaForm({
      companyName: typeof saved.companyName === 'string' ? saved.companyName : '',
      companyCnpj: typeof saved.companyCnpj === 'string' ? saved.companyCnpj : '',
      branchOrDept:
        typeof saved.branchOrDept === 'string' && saved.branchOrDept
          ? saved.branchOrDept
          : (employee.department || ''),
      issuedAt: today,
      responsibleName: typeof saved.responsibleName === 'string' ? saved.responsibleName : '',
    });
    setEpiFichaEmployee(employee);
  };

  const handleDownloadEpiFicha = (e: React.FormEvent) => {
    e.preventDefault();
    if (!epiFichaEmployee) return;
    if (!epiFichaForm.companyName.trim()) {
      alert('Informe o nome da empresa (razão social ou nome fantasia).');
      return;
    }
    const issued = epiFichaForm.issuedAt
      ? new Date(epiFichaForm.issuedAt + 'T12:00:00').toLocaleDateString('pt-BR')
      : new Date().toLocaleDateString('pt-BR');

    const epiRows =
      epiFichaEmployee.possession
        ?.filter(
          (p) =>
            p.quantity > 0 &&
            !p.items?.consumable &&
            p.items?.category === 'EPI'
        )
        .map((p) => [
          p.items?.description ?? '—',
          p.items?.unit ?? '—',
          String(p.quantity),
        ] as [string, string, string]) ?? [];

    downloadEpiFichaPdf(
      {
        full_name: epiFichaEmployee.full_name,
        role: epiFichaEmployee.role,
        cpf: epiFichaEmployee.cpf,
        department: epiFichaEmployee.department,
      },
      epiRows,
      {
        companyName: epiFichaForm.companyName,
        companyCnpj: epiFichaForm.companyCnpj,
        branchOrDept: epiFichaForm.branchOrDept,
        issuedAtLabel: issued,
        responsibleName: epiFichaForm.responsibleName,
      }
    );

    if (typeof window !== 'undefined') {
      localStorage.setItem(
        EPI_FICHA_STORAGE_KEY,
        JSON.stringify({
          companyName: epiFichaForm.companyName,
          companyCnpj: epiFichaForm.companyCnpj,
          branchOrDept: epiFichaForm.branchOrDept,
          responsibleName: epiFichaForm.responsibleName,
        })
      );
    }
    setEpiFichaEmployee(null);
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
    // Search matches name, role OR any item description in possession
    const matchesSearch = e.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (e.role && e.role.toLowerCase().includes(searchTerm.toLowerCase())) ||
                         (e.possession?.some(p => p.items?.description.toLowerCase().includes(searchTerm.toLowerCase())));
                         
    const matchesStatus = statusFilter === 'Todos' || e.status === statusFilter;
    
    // Only count non-consumable items for the possession filter
    const activePossessions = e.possession?.filter(p => p.quantity > 0 && !p.items?.consumable) || [];
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
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Carteira de Ativos (EPIs / Diversos)</th>
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
                        <div className="flex flex-col gap-3 min-w-[200px]">
                          {/* EPIs Wallet */}
                          <div>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <div className="w-1 h-3 bg-purple-500 rounded-full"></div>
                              <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Carteira de EPIs</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {e.possession?.filter(p => p.quantity > 0 && !p.items?.consumable && p.items?.category === 'EPI').length ? (
                                e.possession
                                  .filter(p => p.quantity > 0 && !p.items?.consumable && p.items?.category === 'EPI')
                                  .map((p, idx) => (
                                    <div key={idx} className="flex items-center gap-2 bg-purple-50 border border-purple-100 px-2 py-1 rounded text-[10px] font-bold text-purple-700 group/p">
                                      <span className="truncate max-w-[150px]">{p.items?.description}</span>
                                      <span className="bg-purple-200/50 px-1 rounded">x{p.quantity}</span>
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
                                <span className="text-[9px] text-slate-300 italic font-medium ml-2">Vazia</span>
                              )}
                            </div>
                          </div>

                          {/* Others Wallet */}
                          <div>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <div className="w-1 h-3 bg-blue-500 rounded-full"></div>
                              <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Demais Itens</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {e.possession?.filter(p => p.quantity > 0 && !p.items?.consumable && p.items?.category !== 'EPI').length ? (
                                e.possession
                                  .filter(p => p.quantity > 0 && !p.items?.consumable && p.items?.category !== 'EPI')
                                  .map((p, idx) => (
                                    <div key={idx} className="flex items-center gap-2 bg-blue-50 border border-blue-100 px-2 py-1 rounded text-[10px] font-bold text-blue-700 group/p">
                                      <span className="truncate max-w-[150px]">{p.items?.description}</span>
                                      <span className="bg-blue-200/50 px-1 rounded">x{p.quantity}</span>
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
                                <span className="text-[9px] text-slate-300 italic font-medium ml-2">Vazia</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button 
                            type="button"
                            onClick={() => openEpiFichaModal(e)}
                            className="text-slate-400 hover:text-secondary p-2 bg-slate-50 border border-slate-200 rounded-lg transition-all"
                            title="Ficha de EPI (PDF)"
                          >
                            <FileText size={16} />
                          </button>
                          <button 
                            type="button"
                            onClick={() => openTimeline(e)}
                            className="text-slate-400 hover:text-secondary p-2 bg-slate-50 border border-slate-200 rounded-lg transition-all"
                            title="Ver Histórico"
                          >
                            <History size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Ficha de EPI */}
      {epiFichaEmployee && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in duration-300">
            <div className="p-6 border-b bg-slate-50 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-xl font-bold text-primary">Ficha de EPI</h3>
                <p className="text-xs text-slate-500 mt-1 font-medium">{epiFichaEmployee.full_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setEpiFichaEmployee(null)}
                className="p-2 hover:bg-slate-200 rounded-full"
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleDownloadEpiFicha} className="p-6 space-y-4 overflow-y-auto">
              <p className="text-xs text-slate-600 leading-relaxed">
                Ajuste os dados do empregador abaixo; o PDF incluirá os EPIs em posse deste colaborador
                (categoria EPI, não consumíveis). Nome, função e CPF vêm do cadastro.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-500">Nome da empresa *</label>
                <input
                  required
                  type="text"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-secondary/30 font-medium text-sm"
                  placeholder="Razão social ou nome fantasia"
                  value={epiFichaForm.companyName}
                  onChange={(ev) => setEpiFichaForm((f) => ({ ...f, companyName: ev.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-500">CNPJ (opcional)</label>
                <input
                  type="text"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-secondary/30 text-sm"
                  placeholder="00.000.000/0001-00"
                  value={epiFichaForm.companyCnpj}
                  onChange={(ev) => setEpiFichaForm((f) => ({ ...f, companyCnpj: ev.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-500">Setor / estabelecimento (opcional)</label>
                <input
                  type="text"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-secondary/30 text-sm"
                  placeholder="Ex.: Filial Norte, Obra X"
                  value={epiFichaForm.branchOrDept}
                  onChange={(ev) => setEpiFichaForm((f) => ({ ...f, branchOrDept: ev.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-500">Data do documento</label>
                  <input
                    type="date"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-secondary/30 text-sm"
                    value={epiFichaForm.issuedAt}
                    onChange={(ev) => setEpiFichaForm((f) => ({ ...f, issuedAt: ev.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-500">Responsável pela entrega</label>
                  <input
                    type="text"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-secondary/30 text-sm"
                    placeholder="Nome completo"
                    value={epiFichaForm.responsibleName}
                    onChange={(ev) => setEpiFichaForm((f) => ({ ...f, responsibleName: ev.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEpiFichaEmployee(null)}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 p-3 bg-primary text-white rounded-xl font-bold hover:bg-slate-800 flex items-center justify-center gap-2"
                >
                  <Download size={16} />
                  Baixar PDF
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                        <h4 className="font-bold text-primary text-sm leading-tight">{m.items?.description}</h4>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-400 font-bold uppercase">{m.items?.unit}</span>
                          </div>
                          <span className="text-sm font-black text-primary">x{m.quantity}</span>
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
