'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { formatProductLabelDisplay } from '@/lib/productDisplayText';
import { formatEmployeeName } from '@/lib/employeeName';
import { registerMovement, receiptNumber, MOVEMENT_DOCUMENT_MAX, MOVEMENT_NOTE_MAX } from '@/lib/movements';
import { openPrintable, buildReceiptHtml, loadCompanyInfo } from '@/lib/printDocs';
import { MovementDocAttach } from '@/components/EquipmentDocuments';
import { TagPlate } from '@/components/TagPlate';
import {
  X,
  ArrowUpRight,
  ArrowDownLeft,
  Package,
  User,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Tag,
  MapPin,
  Printer
} from 'lucide-react';

type PossessionRow = {
  quantity: number;
  employee_id?: string | null;
  employees?: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
};

interface Product {
  id: string;
  description: string;
  quantity_current: number;
  consumable: boolean;
  unit: string;
  unique_item?: boolean;
  tag?: string | null;
  possession?: PossessionRow[];
}

function nestedEmployeeId(employees: PossessionRow['employees']): string | null {
  if (!employees) return null;
  const one = Array.isArray(employees) ? employees[0] : employees;
  return one?.id ? String(one.id) : null;
}

function nestedEmployeeName(employees: PossessionRow['employees']): string {
  if (!employees) return 'Colaborador';
  const one = Array.isArray(employees) ? employees[0] : employees;
  return formatEmployeeName(String(one?.full_name || 'Colaborador'));
}

/** Colaboradores com quantidade > 0 na carteira para este item. */
function employeePossessionHolders(item: Product): { id: string; full_name: string }[] {
  const rows = item.possession?.filter((p) => Number(p.quantity) > 0) ?? [];
  const out: { id: string; full_name: string }[] = [];
  for (const p of rows) {
    const id = p.employee_id ? String(p.employee_id) : nestedEmployeeId(p.employees);
    if (!id) continue;
    out.push({ id, full_name: nestedEmployeeName(p.employees) });
  }
  return out;
}

interface Employee {
  id: string;
  full_name: string;
}

interface WorkSiteOption {
  id: string;
  name: string;
  kind: string;
}

type CounterpartyKind = 'employee' | 'site';

interface QuickMovementModalProps {
  item: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  initialMode?: 'IN' | 'OUT';
}

export default function QuickMovementModal({ 
  item, 
  isOpen, 
  onClose, 
  onComplete,
  initialMode = 'OUT'
}: QuickMovementModalProps) {
  const [mode, setMode] = useState<'IN' | 'OUT'>(initialMode);
  const [counterparty, setCounterparty] = useState<CounterpartyKind>('employee');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [workSites, setWorkSites] = useState<WorkSiteOption[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveDocument, setMoveDocument] = useState('');
  const [note, setNote] = useState('');
  /** Movimentação gravada com colaborador/local: permite imprimir o recibo antes de fechar. */
  const [savedMovementId, setSavedMovementId] = useState<string | null>(null);
  /** Colaborador da entrega/devolução gravada: permite anexar o termo assinado. */
  const [savedEmployeeId, setSavedEmployeeId] = useState<string | null>(null);

  const fetchEmployees = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setEmployees([]);
      return;
    }
    const { data } = await supabase
      .from('employees')
      .select('id, full_name')
      .eq('status', 'Ativo')
      .order('full_name');
    setEmployees((data || []).map((employee: Employee) => ({ ...employee, full_name: formatEmployeeName(employee.full_name) })));
  }, []);

  const fetchWorkSites = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setWorkSites([]);
      return;
    }
    const { data, error } = await supabase
      .from('work_sites')
      .select('id, name, kind')
      .eq('active', true)
      .order('name', { ascending: true });
    if (error) {
      console.warn('work_sites:', error);
      setWorkSites([]);
      return;
    }
    setWorkSites((data || []) as WorkSiteOption[]);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setCounterparty('employee');
      setQuantity(1);
      setSelectedEmployee('');
      setSelectedSiteId('');
      setSuccess(false);
      setError(null);
      setMoveDocument('');
      setNote('');
      setSavedMovementId(null);
      setSavedEmployeeId(null);
      void fetchEmployees();
      void fetchWorkSites();
    }
  }, [isOpen, initialMode, fetchEmployees, fetchWorkSites, item]);

  const needsEmployee = useMemo(() => {
    if (!item || counterparty !== 'employee') return false;
    if (mode === 'OUT') return true;
    return !item.consumable;
  }, [item, mode, counterparty]);

  const needsSite = useMemo(() => {
    if (!item || counterparty !== 'site') return false;
    if (mode === 'OUT') return true;
    return !item.consumable;
  }, [item, mode, counterparty]);

  const showEmployeeOptionalOnIn = useMemo(() => {
    if (!item || counterparty !== 'employee') return false;
    return mode === 'IN' && item.consumable;
  }, [item, mode, counterparty]);

  const showSiteOptionalOnIn = useMemo(() => {
    if (!item || counterparty !== 'site') return false;
    return mode === 'IN' && item.consumable;
  }, [item, mode, counterparty]);

  const isUnique = Boolean(item?.unique_item);
  const registeredTag = item?.tag?.trim() ?? '';
  const movementTag = registeredTag;

  const effectiveQty = useMemo(() => (isUnique ? 1 : quantity), [isUnique, quantity]);

  const restrictUniqueReturnToPossessionHolders = useMemo(
    () => Boolean(item && item.unique_item && !item.consumable && mode === 'IN'),
    [item, mode]
  );

  const possessionHolders = useMemo(() => (item ? employeePossessionHolders(item) : []), [item]);

  const employeeOptionsForSelect = useMemo(() => {
    if (!restrictUniqueReturnToPossessionHolders) {
      return employees.map((e) => ({ id: e.id, full_name: e.full_name }));
    }
    if (possessionHolders.length === 0) {
      return [];
    }
    const nameById = new Map(employees.map((e) => [e.id, e.full_name]));
    return possessionHolders.map((h) => ({
      id: h.id,
      full_name: nameById.get(h.id) ?? h.full_name,
    }));
  }, [restrictUniqueReturnToPossessionHolders, possessionHolders, employees]);

  useEffect(() => {
    if (!isOpen || !item) return;
    if (item.unique_item && !item.consumable && mode === 'IN') {
      setCounterparty('employee');
      if (possessionHolders.length === 1) {
        setSelectedEmployee(possessionHolders[0].id);
      }
    }
  }, [isOpen, item, mode, possessionHolders]);

  const validate = useCallback((): string | null => {
    if (!item) return 'Item inválido.';
    if (restrictUniqueReturnToPossessionHolders && counterparty === 'site') {
      return 'Este equipamento único está com colaborador: a devolução ao almoxarifado deve ser feita por ele (origem Colaborador).';
    }
    if (restrictUniqueReturnToPossessionHolders && counterparty === 'employee') {
      const holderIds = new Set(possessionHolders.map((h) => h.id));
      if (possessionHolders.length === 0) {
        return 'Este equipamento único não está em posse de nenhum colaborador no cadastro; não é possível registrar a devolução por colaborador.';
      }
      if (!selectedEmployee || !holderIds.has(selectedEmployee)) {
        return 'Só quem está com este equipamento na carteira pode devolvê-lo. Selecione esse colaborador.';
      }
    }
    if (counterparty === 'employee') {
      if (needsEmployee && !selectedEmployee) return mode === 'IN' ? 'Selecione quem está devolvendo.' : 'Selecione um colaborador para a saída.';
    } else {
      if (needsSite && !selectedSiteId) return mode === 'IN' ? 'Selecione o local de onde vem a devolução.' : 'Selecione o canteiro ou sede de destino.';
      if (showSiteOptionalOnIn && !selectedSiteId) {
        /* entrada consumível sem local: permitido */
      }
    }
    if (!Number.isFinite(effectiveQty) || effectiveQty <= 0) return 'Quantidade deve ser maior que zero.';
    if (mode === 'OUT' && effectiveQty > item.quantity_current) {
      return 'Quantidade maior do que o saldo atual.';
    }
    if (isUnique && !movementTag) return 'Este item único está sem TAG no cadastro. Edite o item e informe a TAG para continuar.';
    return null;
  }, [
    item,
    counterparty,
    needsEmployee,
    needsSite,
    showSiteOptionalOnIn,
    selectedEmployee,
    selectedSiteId,
    mode,
    effectiveQty,
    isUnique,
    movementTag,
    restrictUniqueReturnToPossessionHolders,
    possessionHolders,
  ]);

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    
    setLoading(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Usuário não autenticado.');
      setLoading(false);
      return;
    }

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      setLoading(false);
      return;
    }

    const employeeForMove =
      counterparty === 'employee' && (needsEmployee || (showEmployeeOptionalOnIn && selectedEmployee))
        ? selectedEmployee
        : null;
    const siteForMove =
      counterparty === 'site' && (needsSite || (showSiteOptionalOnIn && selectedSiteId)) ? selectedSiteId : null;
    const isSiteCounterparty = counterparty === 'site' && !!siteForMove;

    // Antes de gravar: validar carteira (colaborador ou local) para mensagens amigáveis.
    // A função no banco valida de novo dentro da transação.
    if (!item.consumable && mode === 'IN') {
      if (counterparty === 'employee' && selectedEmployee) {
        if (item.unique_item) {
          const holderIds = new Set(possessionHolders.map((h) => h.id));
          if (possessionHolders.length > 0 && !holderIds.has(selectedEmployee)) {
            setError('Só o colaborador que está com este equipamento na carteira pode devolvê-lo.');
            setLoading(false);
            return;
          }
        }
        const { data: currentPosPre } = await supabase
          .from('possession')
          .select('quantity')
          .eq('employee_id', selectedEmployee)
          .eq('item_id', item.id)
          .maybeSingle();
        const preQty = Number(currentPosPre?.quantity ?? 0);
        if (preQty < effectiveQty) {
          setError('Esse colaborador não tem essa quantidade na carteira para devolver.');
          setLoading(false);
          return;
        }
      }
      // Para sede/canteiro na devolução, validamos saldo registrado no local.
    }

    if (isSiteCounterparty && selectedSiteId && mode === 'IN') {
      const { data: currentSpPre } = await supabase
        .from('site_possession')
        .select('quantity')
        .eq('site_id', selectedSiteId)
        .eq('item_id', item.id)
        .maybeSingle();
      const preSiteQty = Number(currentSpPre?.quantity ?? 0);
      if (preSiteQty < effectiveQty) {
        setError('Esse local não tem essa quantidade registrada para devolver ao almoxarifado.');
        setLoading(false);
        return;
      }
    }

    // Movimentação + carteira/local + estoque numa única transação.
    // - Carteira: só itens não consumíveis com colaborador.
    // - Canteiro/sede: envio baixa o almoxarifado e soma no local; devolução faz o inverso.
    const signed = mode === 'OUT' ? effectiveQty : -effectiveQty; // visto do lado do colaborador/local
    const res = await registerMovement(supabase, {
      item_id: item.id,
      type: mode,
      quantity: effectiveQty,
      employee_id: employeeForMove,
      work_site_id: siteForMove,
      tag: isUnique ? movementTag : null,
      stock_delta: -signed,
      possession_delta: !item.consumable && employeeForMove ? signed : 0,
      site_delta: isSiteCounterparty ? signed : 0,
      document: moveDocument,
      note,
    });
    if (!res.ok) {
      setError(res.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);

    // Com colaborador ou local há recibo: a janela fica aberta para imprimir.
    if ((employeeForMove || siteForMove) && res.movement_id) {
      setSavedMovementId(res.movement_id);
      setSavedEmployeeId(employeeForMove && !item.consumable ? employeeForMove : null);
      return;
    }
    setTimeout(() => {
      onComplete();
      onClose();
    }, 1500);
  };

  const finish = () => {
    onComplete();
    onClose();
  };

  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-300">
        <div className="p-6 border-b border-border flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${mode === 'IN' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
              {mode === 'IN' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-primary leading-tight">
                {mode === 'IN' ? 'Entrada' : 'Saída'} - {formatProductLabelDisplay(item.description)}
              </h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">UNIDADE: {item.unit}</p>
            </div>
          </div>
          <button onClick={success ? finish : onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleAction} className="p-6 space-y-6">
          {success ? (
            <div className="py-8 text-center space-y-4 animate-in zoom-in duration-300">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-500">
                <CheckCircle2 size={32} />
              </div>
              <h3 className="text-xl font-bold text-primary">Movimentação Concluída!</h3>
              <p className="text-slate-500">O estoque foi atualizado com sucesso.</p>
              {savedMovementId && savedEmployeeId && item ? (
                <MovementDocAttach
                  itemId={item.id}
                  employeeId={savedEmployeeId}
                  movementId={savedMovementId}
                  kind={mode === 'OUT' ? 'entrega' : 'devolucao'}
                />
              ) : null}
              {savedMovementId && (
                <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                  <button
                    type="button"
                    onClick={() =>
                      void openPrintable(`Recibo ${receiptNumber(savedMovementId)}`, () =>
                        buildReceiptHtml(supabase, { movementId: savedMovementId }, loadCompanyInfo())
                      )
                    }
                    className="px-5 py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2"
                  >
                    <Printer size={18} />
                    Imprimir recibo
                  </button>
                  <button
                    type="button"
                    onClick={finish}
                    className="px-5 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Fechar
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Mode Toggle */}
              <div className="flex p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setMode('OUT')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${
                    mode === 'OUT' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <ArrowUpRight size={16} />
                  Saída
                </button>
                <button
                  type="button"
                  onClick={() => setMode('IN')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${
                    mode === 'IN' ? 'bg-white text-green-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <ArrowDownLeft size={16} />
                  Entrada
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-400">Destino / origem</label>
                <div className="flex p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setCounterparty('employee')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${
                      counterparty === 'employee' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <User size={16} />
                    Colaborador
                  </button>
                  {workSites.length > 0 || counterparty === 'site' ? (
                  <button
                    type="button"
                    disabled={restrictUniqueReturnToPossessionHolders}
                    title={
                      restrictUniqueReturnToPossessionHolders
                        ? 'Equipamento único em posse: a entrada só pode ser registrada pelo colaborador que o tem.'
                        : undefined
                    }
                    onClick={() => setCounterparty('site')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${
                      counterparty === 'site' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    } disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:text-slate-500`}
                  >
                    <MapPin size={16} />
                    Canteiro / sede
                  </button>
                  ) : null}
                </div>
                {restrictUniqueReturnToPossessionHolders && possessionHolders.length > 0 && (
                  <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                    Equipamento único: só aparecem (e só podem devolver) os colaboradores com este item na carteira.
                  </p>
                )}
              </div>

              {counterparty === 'employee' && (needsEmployee || showEmployeeOptionalOnIn) && (
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-400 flex items-center gap-2">
                    <User size={14} className="text-secondary" />
                    {mode === 'IN'
                      ? (showEmployeeOptionalOnIn ? 'Devolução de colaborador (opcional)' : 'Quem está devolvendo?')
                      : 'Quem está retirando?'}
                  </label>
                  <select
                    required={needsEmployee}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/20 outline-none font-medium"
                    value={selectedEmployee}
                    onChange={(e) => setSelectedEmployee(e.target.value)}
                  >
                    <option value="">
                      {mode === 'IN'
                        ? (showEmployeeOptionalOnIn ? 'Entrada no estoque (sem colaborador)' : 'Selecione quem está devolvendo...')
                        : 'Selecione o colaborador...'}
                    </option>
                    {employeeOptionsForSelect.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name}
                      </option>
                    ))}
                  </select>
                  {showEmployeeOptionalOnIn && (
                    <div className="text-[10px] text-slate-400 font-bold">
                      Se você escolher um colaborador, a devolução ficará registrada no painel dele.
                    </div>
                  )}
                  {restrictUniqueReturnToPossessionHolders && possessionHolders.length === 0 && (
                    <div className="text-[10px] text-amber-800 font-bold bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                      Nenhum colaborador com este equipamento na carteira. Confira a posse no almoxarifado ou registre a
                      saída antes de devolver.
                    </div>
                  )}
                </div>
              )}

              {counterparty === 'site' && (needsSite || showSiteOptionalOnIn) && (
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-400 flex items-center gap-2">
                    <MapPin size={14} className="text-secondary" />
                    {mode === 'IN'
                      ? (showSiteOptionalOnIn ? 'Retorno do local (opcional)' : 'De qual local vem a devolução?')
                      : 'Enviar para qual local?'}
                  </label>
                  <select
                    required={needsSite}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/20 outline-none font-medium"
                    value={selectedSiteId}
                    onChange={(e) => setSelectedSiteId(e.target.value)}
                  >
                    <option value="">
                      {mode === 'IN'
                        ? (showSiteOptionalOnIn ? 'Somente almoxarifado (sem local)' : 'Selecione o canteiro ou sede...')
                        : 'Selecione o canteiro ou sede...'}
                    </option>
                    {workSites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.kind === 'sede' ? 'Sede' : 'Canteiro'}: {s.name}
                      </option>
                    ))}
                  </select>
                  {workSites.length === 0 && (
                    <div className="text-[10px] text-amber-700 font-bold">
                      Nenhum local ativo. Cadastre em Sedes e canteiros no menu.
                    </div>
                  )}
                  {showSiteOptionalOnIn && (
                    <div className="text-[10px] text-slate-400 font-bold">
                      Consumíveis podem entrar sem vínculo a local; itens de carteira no local exigem seleção.
                    </div>
                  )}
                  {mode === 'OUT' && (
                    <div className="text-[10px] text-amber-800 font-medium bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 leading-relaxed">
                      Sai do saldo do almoxarifado e passa a constar no local (devolução ao almoxarifado faz o inverso).
                    </div>
                  )}
                </div>
              )}

              {isUnique && (
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase flex items-center gap-2 text-secondary">
                    <Tag size={14} />
                    TAG cadastrada do item
                  </label>
                  <div className="w-full p-3 bg-slate-100 border border-slate-200 rounded-lg font-bold tracking-wide text-primary">
                    {registeredTag ? <TagPlate size="md">{registeredTag}</TagPlate> : 'Sem TAG cadastrada'}
                  </div>
                  <div className="text-[10px] text-slate-400 font-bold">
                    A TAG é definida somente no cadastro do item e será usada automaticamente no histórico da movimentação.
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-400">Quantidade</label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="any"
                    disabled={isUnique}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/20 outline-none font-bold text-center text-lg disabled:opacity-60"
                    value={effectiveQty}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setQuantity(Number.isFinite(next) ? next : 0);
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-400">Saldo Atual</label>
                  <div className="w-full p-3 bg-slate-100 border border-slate-200 rounded-lg text-center">
                    <span className="font-bold text-primary text-lg">{item.quantity_current}</span>
                    <span className="ml-1 text-xs text-slate-400">{item.unit}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-400">Documento</label>
                  <input
                    type="text"
                    maxLength={MOVEMENT_DOCUMENT_MAX}
                    placeholder={mode === 'IN' ? 'NF, requisição…' : 'Requisição, OS…'}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                    value={moveDocument}
                    onChange={(e) => setMoveDocument(e.target.value)}
                  />
                </div>
                <div className="space-y-1 sm:col-span-3">
                  <label className="text-xs font-bold uppercase text-slate-400">Observação</label>
                  <input
                    type="text"
                    maxLength={MOVEMENT_NOTE_MAX}
                    placeholder="Opcional"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-red-600 text-xs font-bold animate-in shake duration-300">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`w-full p-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg disabled:opacity-50 ${
                  mode === 'IN' 
                  ? 'bg-green-600 text-white shadow-green-100 hover:bg-green-700' 
                  : 'bg-red-600 text-white shadow-red-100 hover:bg-red-700'
                }`}
              >
                {loading ? <Loader2 className="animate-spin" /> : (
                  <>
                    Confirmar {mode === 'IN' ? 'Entrada' : 'Saída'}
                    <Package size={20} />
                  </>
                )}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
