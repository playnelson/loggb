'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { formatProductLabelDisplay } from '@/lib/productDisplayText';
import { isLikelyMissingColumn } from '@/lib/tenantItems';
import { ArrowLeft, Loader2, Plus, ReceiptText, ShieldCheck, X } from 'lucide-react';

type ResponsibilityType = 'employee' | 'site' | 'warehouse';
type RentalStatus = 'ativo' | 'encerrado';

type ItemOption = {
  id: string;
  description: string;
  unit: string;
  is_rented: boolean;
  quantity_current: number;
};

type EmployeeOption = {
  id: string;
  full_name: string;
};

type WorkSiteOption = {
  id: string;
  name: string;
  kind: string;
};

type RentalRow = {
  id: string;
  item_id: string;
  supplier: string;
  contract_ref: string | null;
  status: RentalStatus;
  responsibility_type: ResponsibilityType;
  employee_id: string | null;
  work_site_id: string | null;
  quantity: number;
  start_date: string;
  expected_return_date: string | null;
  monthly_cost: number | null;
  notes: string | null;
  items?: { id: string; description: string; unit: string } | { id: string; description: string; unit: string }[] | null;
  employees?: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
  work_sites?: { id: string; name: string; kind: string } | { id: string; name: string; kind: string }[] | null;
};

const emptyForm = () => ({
  item_id: '',
  supplier: '',
  contract_ref: '',
  status: 'ativo' as RentalStatus,
  responsibility_type: 'warehouse' as ResponsibilityType,
  employee_id: '',
  work_site_id: '',
  quantity: 1,
  start_date: new Date().toISOString().slice(0, 10),
  expected_return_date: '',
  monthly_cost: '',
  notes: '',
});

function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function responsibilityLabel(r: RentalRow): string {
  if (r.responsibility_type === 'employee') {
    return asSingle(r.employees)?.full_name || 'Colaborador não encontrado';
  }
  if (r.responsibility_type === 'site') {
    const s = asSingle(r.work_sites);
    if (!s) return 'Local não encontrado';
    return `${s.kind === 'sede' ? 'Sede' : 'Canteiro'}: ${s.name}`;
  }
  return 'Almoxarifado';
}

export default function RentalsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [workSites, setWorkSites] = useState<WorkSiteOption[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RentalRow | null>(null);
  const [form, setForm] = useState(emptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setRentals([]);
      setItems([]);
      setEmployees([]);
      setWorkSites([]);
      return;
    }

    const getItems = async () => {
      let res = await supabase
        .from('items')
        .select('id, description, unit, is_rented, quantity_current')
        .eq('user_id', user.id)
        .order('description', { ascending: true });
      if (res.error?.message && isLikelyMissingColumn(res.error.message, 'is_rented')) {
        const legacy = await supabase
          .from('items')
          .select('id, description, unit, quantity_current')
          .eq('user_id', user.id)
          .order('description', { ascending: true });
        if (!legacy.error && legacy.data) {
          return {
            ...legacy,
            data: legacy.data.map((it) => ({ ...it, is_rented: false })),
          };
        }
        return legacy;
      }
      return res;
    };

    const [itemsRes, employeesRes, sitesRes, rentalsRes] = await Promise.all([
      getItems(),
      supabase
        .from('employees')
        .select('id, full_name, status')
        .eq('user_id', user.id)
        .order('full_name', { ascending: true }),
      supabase
        .from('work_sites')
        .select('id, name, kind, active')
        .eq('user_id', user.id)
        .eq('active', true)
        .order('name', { ascending: true }),
      supabase
        .from('equipment_rentals')
        .select('id, item_id, supplier, contract_ref, status, responsibility_type, employee_id, work_site_id, quantity, start_date, expected_return_date, monthly_cost, notes, items(id, description, unit), employees(id, full_name), work_sites(id, name, kind)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
    ]);

    if (itemsRes.error) {
      setError(itemsRes.error.message);
      setItems([]);
    } else {
      setItems(
        (itemsRes.data || []).map((i: Record<string, unknown>) => ({
          id: String(i.id),
          description: String(i.description ?? ''),
          unit: String(i.unit ?? 'un'),
          is_rented: Boolean(i.is_rented),
          quantity_current: Number(i.quantity_current ?? 0),
        }))
      );
    }

    if (employeesRes.error) {
      setEmployees([]);
    } else {
      const list = (employeesRes.data || [])
        .filter((e: { status?: string }) => !e.status || e.status === 'Ativo')
        .map((e: { id: string; full_name: string }) => ({ id: e.id, full_name: e.full_name }));
      setEmployees(list);
    }

    if (sitesRes.error) {
      setWorkSites([]);
    } else {
      setWorkSites(
        (sitesRes.data || []).map((s: Record<string, unknown>) => ({
          id: String(s.id),
          name: String(s.name ?? ''),
          kind: String(s.kind ?? 'canteiro'),
        }))
      );
    }

    if (rentalsRes.error) {
      const msg = String(rentalsRes.error.message || '');
      if (msg.toLowerCase().includes('equipment_rentals') || rentalsRes.error.code === '42P01') {
        setError('Tabela de aluguéis não encontrada. Execute o arquivo supabase/rentals_management.sql no Supabase.');
      } else {
        setError(msg);
      }
      setRentals([]);
    } else {
      setRentals((rentalsRes.data || []) as unknown as RentalRow[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (row: RentalRow) => {
    setEditing(row);
    setForm({
      item_id: row.item_id,
      supplier: row.supplier,
      contract_ref: row.contract_ref || '',
      status: row.status,
      responsibility_type: row.responsibility_type,
      employee_id: row.employee_id || '',
      work_site_id: row.work_site_id || '',
      quantity: Number(row.quantity || 1),
      start_date: row.start_date,
      expected_return_date: row.expected_return_date || '',
      monthly_cost: row.monthly_cost == null ? '' : String(row.monthly_cost),
      notes: row.notes || '',
    });
    setModalOpen(true);
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.item_id) {
      alert('Selecione o equipamento do almoxarifado.');
      return;
    }
    if (!form.supplier.trim()) {
      alert('Informe o fornecedor.');
      return;
    }
    if (form.responsibility_type === 'employee' && !form.employee_id) {
      alert('Selecione o colaborador responsável.');
      return;
    }
    if (form.responsibility_type === 'site' && !form.work_site_id) {
      alert('Selecione o canteiro/sede responsável.');
      return;
    }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const payload = {
      user_id: user.id,
      item_id: form.item_id,
      supplier: form.supplier.trim(),
      contract_ref: form.contract_ref.trim() || null,
      status: form.status,
      responsibility_type: form.responsibility_type,
      employee_id: form.responsibility_type === 'employee' ? form.employee_id : null,
      work_site_id: form.responsibility_type === 'site' ? form.work_site_id : null,
      quantity: Math.max(1, Number(form.quantity || 1)),
      start_date: form.start_date,
      expected_return_date: form.expected_return_date || null,
      monthly_cost: form.monthly_cost === '' ? null : Number(form.monthly_cost),
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let upErr: { message?: string } | null = null;
    if (editing) {
      const { error: err } = await supabase
        .from('equipment_rentals')
        .update(payload)
        .eq('id', editing.id)
        .eq('user_id', user.id);
      upErr = err;
    } else {
      const { error: err } = await supabase.from('equipment_rentals').insert([payload]);
      upErr = err;
    }

    if (upErr) {
      alert(upErr.message || 'Falha ao salvar aluguel.');
      setSaving(false);
      return;
    }

    // Mantém o item marcado como alugado no almoxarifado.
    await supabase.from('items').update({ is_rented: true }).eq('id', form.item_id).eq('user_id', user.id);

    setSaving(false);
    setModalOpen(false);
    await load();
  };

  const closeRental = async (row: RentalRow) => {
    if (!confirm('Encerrar este aluguel?')) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error: err } = await supabase
      .from('equipment_rentals')
      .update({ status: 'encerrado', updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('user_id', user.id);
    if (err) {
      alert(err.message || 'Falha ao encerrar aluguel.');
      return;
    }
    await load();
  };

  const activeCount = rentals.filter((r) => r.status === 'ativo').length;
  const monthlyTotal = rentals
    .filter((r) => r.status === 'ativo')
    .reduce((sum, r) => sum + Number(r.monthly_cost || 0), 0);

  const itemOptions = useMemo(() => items.filter((i) => i.is_rented || i.quantity_current > 0), [items]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            href="/inventory"
            className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-primary mt-0.5"
            aria-label="Voltar ao almoxarifado"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-primary">Gestão de Aluguéis</h1>
            <p className="text-slate-500 text-sm">
              Controle de equipamentos alugados e responsabilidade por colaborador, local ou almoxarifado.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href="/inventory"
            className="px-4 py-2 border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50 text-sm"
          >
            Abrir almoxarifado
          </Link>
          <button
            type="button"
            onClick={openNew}
            className="flex items-center gap-2 bg-secondary text-white px-4 py-2 rounded-lg font-bold text-sm hover:opacity-95"
          >
            <Plus size={16} />
            Novo aluguel
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm font-medium">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Aluguéis ativos</p>
          <p className="text-2xl font-black text-primary mt-1 tabular-nums">{activeCount}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Custo mensal ativo</p>
          <p className="text-2xl font-black text-primary mt-1 tabular-nums">
            {monthlyTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Itens marcados alugados</p>
          <p className="text-2xl font-black text-primary mt-1 tabular-nums">{items.filter((i) => i.is_rented).length}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <Loader2 className="animate-spin inline mr-2" size={20} />
            Carregando aluguéis...
          </div>
        ) : rentals.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">Nenhum aluguel cadastrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Equipamento</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fornecedor</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Responsável</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Período</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rentals.map((r) => {
                  const it = asSingle(r.items);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <div className="font-bold text-primary">{formatProductLabelDisplay(it?.description || '—')}</div>
                        <div className="text-xs text-slate-500">
                          {r.quantity} {it?.unit || 'un'} ·{' '}
                          {r.status === 'ativo' ? (
                            <span className="text-emerald-700 font-bold">Ativo</span>
                          ) : (
                            <span className="text-slate-500 font-bold">Encerrado</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <div className="font-bold">{r.supplier}</div>
                        {r.contract_ref ? <div className="text-xs text-slate-500">Contrato: {r.contract_ref}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{responsibilityLabel(r)}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <div>{new Date(r.start_date).toLocaleDateString('pt-BR')}</div>
                        <div className="text-xs text-slate-500">
                          Prev. devolução:{' '}
                          {r.expected_return_date ? new Date(r.expected_return_date).toLocaleDateString('pt-BR') : '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(r)}
                            className="px-3 py-1.5 text-xs font-black text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                          >
                            Editar
                          </button>
                          {r.status === 'ativo' ? (
                            <button
                              type="button"
                              onClick={() => void closeRental(r)}
                              className="px-3 py-1.5 text-xs font-black text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-lg hover:bg-emerald-100"
                            >
                              Encerrar
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b bg-slate-50 flex items-center justify-between">
              <h2 className="text-xl font-bold text-primary">{editing ? 'Editar aluguel' : 'Novo aluguel'}</h2>
              <button type="button" onClick={() => setModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={save} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-400">Equipamento (almoxarifado)</label>
                  <select
                    required
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                    value={form.item_id}
                    onChange={(e) => setForm((f) => ({ ...f, item_id: e.target.value }))}
                  >
                    <option value="">Selecione...</option>
                    {itemOptions.map((it) => (
                      <option key={it.id} value={it.id}>
                        {formatProductLabelDisplay(it.description)} ({it.unit})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 font-medium">
                    O item selecionado será marcado como alugado no cadastro do almoxarifado.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Fornecedor</label>
                  <input
                    required
                    type="text"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                    value={form.supplier}
                    onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Contrato / referência</label>
                  <input
                    type="text"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                    value={form.contract_ref}
                    onChange={(e) => setForm((f) => ({ ...f, contract_ref: e.target.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Data início</label>
                  <input
                    required
                    type="date"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                    value={form.start_date}
                    onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Previsão de devolução</label>
                  <input
                    type="date"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                    value={form.expected_return_date}
                    onChange={(e) => setForm((f) => ({ ...f, expected_return_date: e.target.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Quantidade</label>
                  <input
                    required
                    min={1}
                    type="number"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold"
                    value={form.quantity}
                    onChange={(e) => setForm((f) => ({ ...f, quantity: Math.max(1, Number(e.target.value || 1)) }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Custo mensal (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold"
                    value={form.monthly_cost}
                    onChange={(e) => setForm((f) => ({ ...f, monthly_cost: e.target.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Status</label>
                  <select
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as RentalStatus }))}
                  >
                    <option value="ativo">Ativo</option>
                    <option value="encerrado">Encerrado</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Responsabilidade</label>
                  <select
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                    value={form.responsibility_type}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        responsibility_type: e.target.value as ResponsibilityType,
                        employee_id: e.target.value === 'employee' ? f.employee_id : '',
                        work_site_id: e.target.value === 'site' ? f.work_site_id : '',
                      }))
                    }
                  >
                    <option value="warehouse">Almoxarifado</option>
                    <option value="employee">Colaborador</option>
                    <option value="site">Canteiro / sede</option>
                  </select>
                </div>

                {form.responsibility_type === 'employee' && (
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-bold uppercase text-slate-400">Colaborador responsável</label>
                    <select
                      required
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                      value={form.employee_id}
                      onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
                    >
                      <option value="">Selecione...</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {form.responsibility_type === 'site' && (
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-bold uppercase text-slate-400">Local responsável</label>
                    <select
                      required
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                      value={form.work_site_id}
                      onChange={(e) => setForm((f) => ({ ...f, work_site_id: e.target.value }))}
                    >
                      <option value="">Selecione...</option>
                      {workSites.map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.kind === 'sede' ? 'Sede' : 'Canteiro'}: {site.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-400">Observações</label>
                  <textarea
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm min-h-[96px]"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-start gap-3 text-xs text-slate-600">
                <ReceiptText size={16} className="mt-0.5 text-secondary shrink-0" />
                <div>
                  Este módulo fica interligado ao almoxarifado: o equipamento selecionado vem da base de itens e continua com
                  rastreabilidade de posse/responsabilidade.
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 p-3 bg-primary text-white rounded-xl font-bold hover:bg-slate-800 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                  {saving ? 'Salvando...' : editing ? 'Salvar edição' : 'Cadastrar aluguel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
