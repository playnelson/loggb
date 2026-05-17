'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { formatProductLabelDisplay } from '@/lib/productDisplayText';
import { isLikelyMissingColumn } from '@/lib/tenantItems';
import { ArrowLeft, Building2, Loader2, ReceiptText, ShieldCheck, X } from 'lucide-react';

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
  quantity: number;
};

type SupplierOption = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
};

type RentalRow = {
  id: string;
  item_id: string;
  supplier: string;
  supplier_id: string | null;
  contract_ref: string | null;
  status: RentalStatus;
  employee_id: string | null;
  quantity: number;
  start_date: string;
  expected_return_date: string | null;
  monthly_cost: number | null;
  notes: string | null;
  items?: { id: string; description: string; unit: string } | { id: string; description: string; unit: string }[] | null;
  employees?: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
  rental_suppliers?: { id: string; name: string } | { id: string; name: string }[] | null;
};

type RentalDraftRow = {
  id: string;
  item_id: string;
  supplier: string;
  supplier_id: string | null;
  contract_ref: string | null;
  status: RentalStatus;
  employee_id: string | null;
  quantity: number;
  start_date: string;
  expected_return_date: string | null;
  monthly_cost: number | null;
  notes: string | null;
  items: { id: string; description: string; unit: string };
  employees: null;
  rental_suppliers: null;
  isDraft: true;
};

type RentalListRow = (RentalRow & { isDraft?: false }) | RentalDraftRow;

const emptyForm = () => ({
  item_id: '',
  supplier_id: '',
  contract_ref: '',
  status: 'ativo' as RentalStatus,
  quantity: 1,
  start_date: new Date().toISOString().slice(0, 10),
  expected_return_date: '',
  monthly_cost: '',
  notes: '',
});

const emptySupplierForm = () => ({
  name: '',
  contact_name: '',
  phone: '',
  notes: '',
});

function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function rowIsDraft(row: RentalListRow): row is RentalDraftRow {
  return Boolean((row as { isDraft?: boolean }).isDraft);
}

export default function RentalsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [employeesByItem, setEmployeesByItem] = useState<Record<string, EmployeeOption[]>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [editing, setEditing] = useState<RentalRow | null>(null);
  const [draftItemId, setDraftItemId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setRentals([]);
      setItems([]);
      setSuppliers([]);
      setEmployeesByItem({});
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
            data: legacy.data.map((it: Record<string, unknown>) => ({ ...it, is_rented: false })),
          };
        }
        return legacy;
      }
      return res;
    };

    const [itemsRes, employeesRes, suppliersRes, rentalsRes] = await Promise.all([
      getItems(),
      supabase
        .from('employees')
        .select('id, full_name, status, possession(item_id, quantity)')
        .eq('user_id', user.id)
        .order('full_name', { ascending: true }),
      supabase
        .from('rental_suppliers')
        .select('id, name, contact_name, phone')
        .eq('user_id', user.id)
        .order('name', { ascending: true }),
      supabase
        .from('equipment_rentals')
        .select(
          'id, item_id, supplier, supplier_id, contract_ref, status, employee_id, quantity, start_date, expected_return_date, monthly_cost, notes, items(id, description, unit), employees(id, full_name), rental_suppliers(id, name)'
        )
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
      setEmployeesByItem({});
    } else {
      const tenantEmployees = (employeesRes.data || []) as Array<{
        id: string;
        full_name: string;
        status?: string;
        possession?: { item_id: string; quantity: number }[] | null;
      }>;
      const grouped = new Map<string, Map<string, EmployeeOption>>();
      for (const employee of tenantEmployees) {
        for (const pos of employee.possession || []) {
          const qty = Number(pos.quantity || 0);
          if (qty <= 0) continue;
          if (!grouped.has(pos.item_id)) grouped.set(pos.item_id, new Map<string, EmployeeOption>());
          const current = grouped.get(pos.item_id)?.get(employee.id);
          grouped.get(pos.item_id)?.set(employee.id, {
            id: employee.id,
            full_name: employee.full_name,
            quantity: qty + Number(current?.quantity || 0),
          });
        }
      }
      const out: Record<string, EmployeeOption[]> = {};
      for (const [itemId, m] of grouped) {
        out[itemId] = Array.from(m.values()).sort(
          (a, b) => b.quantity - a.quantity || a.full_name.localeCompare(b.full_name, 'pt-BR')
        );
      }
      setEmployeesByItem(out);
    }

    if (suppliersRes.error) {
      const msg = String(suppliersRes.error.message || '').toLowerCase();
      if (!msg.includes('does not exist') && suppliersRes.error.code !== '42P01') {
        setError(suppliersRes.error.message);
      }
      setSuppliers([]);
    } else {
      setSuppliers(
        (suppliersRes.data || []).map((s: Record<string, unknown>) => ({
          id: String(s.id),
          name: String(s.name ?? ''),
          contact_name: s.contact_name ? String(s.contact_name) : null,
          phone: s.phone ? String(s.phone) : null,
        }))
      );
    }

    if (rentalsRes.error) {
      const msg = String(rentalsRes.error.message || '');
      if (msg.toLowerCase().includes('equipment_rentals') || rentalsRes.error.code === '42P01') {
        setError('Estrutura de aluguéis desatualizada. Execute novamente o arquivo supabase/rentals_management.sql no Supabase.');
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

  const totalQtyByItem = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const it of items) {
      const inWallet = (employeesByItem[it.id] || []).reduce((sum, holder) => sum + Number(holder.quantity || 0), 0);
      out[it.id] = Number(it.quantity_current || 0) + inWallet;
    }
    return out;
  }, [items, employeesByItem]);

  const rentalsList = useMemo<RentalListRow[]>(() => {
    const list: RentalListRow[] = rentals.map((r) => ({ ...r, isDraft: false }));
    const existingItemIds = new Set(rentals.map((r) => r.item_id));
    const drafts = items
      .filter((it) => it.is_rented && !existingItemIds.has(it.id))
      .map<RentalDraftRow>((it) => ({
        id: `draft:${it.id}`,
        item_id: it.id,
        supplier: 'Pendente de cadastro',
        supplier_id: null,
        contract_ref: null,
        status: 'ativo',
        employee_id: null,
        quantity: totalQtyByItem[it.id] ?? Number(it.quantity_current || 0),
        start_date: new Date().toISOString().slice(0, 10),
        expected_return_date: null,
        monthly_cost: null,
        notes: null,
        items: { id: it.id, description: it.description, unit: it.unit },
        employees: null,
        rental_suppliers: null,
        isDraft: true,
      }));
    return [...drafts, ...list];
  }, [items, rentals, totalQtyByItem]);

  const activeCount = rentals.filter((r) => r.status === 'ativo').length;
  const monthlyTotal = rentals
    .filter((r) => r.status === 'ativo')
    .reduce((sum, r) => sum + Number(r.monthly_cost || 0), 0);

  const itemOptions = useMemo(() => items.filter((i) => i.is_rented), [items]);

  const eligibleEmployees = useMemo(() => {
    if (!form.item_id) return [];
    return employeesByItem[form.item_id] || [];
  }, [employeesByItem, form.item_id]);

  const openFromDraft = (itemId: string) => {
    const item = items.find((it) => it.id === itemId);
    setEditing(null);
    setDraftItemId(itemId);
    setForm({
      ...emptyForm(),
      item_id: itemId,
      quantity: 1,
      notes: item ? `Item marcado como alugado no almoxarifado: ${item.description}.` : '',
    });
    setModalOpen(true);
  };

  const openEdit = (row: RentalRow) => {
    setEditing(row);
    setDraftItemId(null);
    setForm({
      item_id: row.item_id,
      supplier_id: row.supplier_id || '',
      contract_ref: row.contract_ref || '',
      status: row.status,
      quantity: Number(row.quantity || 1),
      start_date: row.start_date,
      expected_return_date: row.expected_return_date || '',
      monthly_cost: row.monthly_cost == null ? '' : String(row.monthly_cost),
      notes: row.notes || '',
    });
    setModalOpen(true);
  };

  const saveSupplier = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!supplierForm.name.trim()) {
      alert('Informe o nome da locadora.');
      return;
    }
    setSupplierSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSupplierSaving(false);
      return;
    }
    const { error: err } = await supabase.from('rental_suppliers').insert([
      {
        user_id: user.id,
        name: supplierForm.name.trim(),
        contact_name: supplierForm.contact_name.trim() || null,
        phone: supplierForm.phone.trim() || null,
        notes: supplierForm.notes.trim() || null,
      },
    ]);
    if (err) {
      alert(err.message || 'Falha ao cadastrar locadora.');
      setSupplierSaving(false);
      return;
    }
    setSupplierSaving(false);
    setSupplierModalOpen(false);
    setSupplierForm(emptySupplierForm());
    await load();
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.item_id) {
      alert('Selecione o equipamento do almoxarifado.');
      return;
    }
    if (!form.supplier_id) {
      alert('Selecione a locadora cadastrada.');
      return;
    }

    const itemEmployees = employeesByItem[form.item_id] || [];
    // Sem seleção manual: quando houver carteira, usa o portador principal.
    const responsibleEmployeeId = itemEmployees[0]?.id || null;

    const supplier = suppliers.find((s) => s.id === form.supplier_id);
    if (!supplier) {
      alert('Locadora inválida.');
      return;
    }

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const payload = {
      user_id: user.id,
      item_id: form.item_id,
      supplier: supplier.name,
      supplier_id: form.supplier_id,
      contract_ref: form.contract_ref.trim() || null,
      status: form.status,
      responsibility_type: responsibleEmployeeId ? 'employee' : 'warehouse',
      employee_id: responsibleEmployeeId,
      work_site_id: null,
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

    await supabase.from('items').update({ is_rented: true }).eq('id', form.item_id).eq('user_id', user.id);

    setSaving(false);
    setModalOpen(false);
    setDraftItemId(null);
    await load();
  };

  const closeRental = async (row: RentalRow) => {
    if (!confirm('Encerrar este aluguel?')) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
              Itens marcados como aluguel aparecem aqui automaticamente. O responsável é o colaborador com o item em carteira.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSupplierModalOpen(true)}
            className="flex items-center gap-2 border border-slate-200 text-slate-700 bg-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-50"
          >
            <Building2 size={16} />
            Locadoras
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
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Locadoras cadastradas</p>
          <p className="text-2xl font-black text-primary mt-1 tabular-nums">{suppliers.length}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <Loader2 className="animate-spin inline mr-2" size={20} />
            Carregando aluguéis...
          </div>
        ) : rentalsList.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            Nenhum item alugado encontrado. Marque o equipamento como alugado no almoxarifado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Equipamento</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Locadora</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Responsável</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Período</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rentalsList.map((r) => {
                  const it = asSingle(r.items);
                  const emp = asSingle(r.employees);
                  const sup = asSingle(r.rental_suppliers);
                  const shownQty = totalQtyByItem[r.item_id] ?? Number(r.quantity || 0);
                  const inferredHolders = employeesByItem[r.item_id] || [];
                  const holdersLabel = inferredHolders.length
                    ? inferredHolders.map((h) => `${h.full_name} (${h.quantity})`).join(', ')
                    : null;
                  const inferredLabel =
                    inferredHolders.length === 1
                      ? inferredHolders[0].full_name
                      : inferredHolders.length > 1
                        ? `${inferredHolders[0].full_name} (auto entre ${inferredHolders.length})`
                        : null;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <div className="font-bold text-primary">{formatProductLabelDisplay(it?.description || '—')}</div>
                        <div className="text-xs text-slate-500">
                          {shownQty} {it?.unit || 'un'} ·{' '}
                          {rowIsDraft(r) ? (
                            <span className="text-amber-700 font-bold">Pendente de cadastro</span>
                          ) : r.status === 'ativo' ? (
                            <span className="text-emerald-700 font-bold">Ativo</span>
                          ) : (
                            <span className="text-slate-500 font-bold">Encerrado</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <div className="font-bold">{sup?.name || r.supplier}</div>
                        {r.contract_ref ? <div className="text-xs text-slate-500">Contrato: {r.contract_ref}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {holdersLabel || emp?.full_name || inferredLabel || 'Sem carteira vinculada'}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {rowIsDraft(r) ? (
                          <span className="text-slate-500">Defina na configuração</span>
                        ) : (
                          <>
                            <div>{new Date(r.start_date).toLocaleDateString('pt-BR')}</div>
                            <div className="text-xs text-slate-500">
                              Prev. devolução:{' '}
                              {r.expected_return_date ? new Date(r.expected_return_date).toLocaleDateString('pt-BR') : '—'}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          {rowIsDraft(r) ? (
                            <button
                              type="button"
                              onClick={() => openFromDraft(r.item_id)}
                              className="px-3 py-1.5 text-xs font-black text-amber-700 border border-amber-200 bg-amber-50 rounded-lg hover:bg-amber-100"
                              title={
                                inferredHolders.length === 0
                                  ? 'Configurar aluguel (sem carteira vinculada no momento)'
                                  : inferredHolders.length > 1
                                    ? 'Vai configurar usando automaticamente o portador principal da carteira'
                                    : 'Configurar aluguel'
                              }
                            >
                              Configurar
                            </button>
                          ) : (
                            <>
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
                            </>
                          )}
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
              <h2 className="text-xl font-bold text-primary">{editing || draftItemId ? 'Configurar aluguel' : 'Novo aluguel'}</h2>
              <button type="button" onClick={() => setModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={save} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-400">Equipamento alugado</label>
                  <select
                    required
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                    value={form.item_id}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        item_id: e.target.value,
                      }))
                    }
                  >
                    <option value="">Selecione...</option>
                    {itemOptions.map((it) => (
                      <option key={it.id} value={it.id}>
                        {formatProductLabelDisplay(it.description)} ({it.unit})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 font-medium">
                    Aqui entram apenas itens já marcados como alugados no almoxarifado.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Empresa locadora</label>
                  <div className="flex gap-2">
                    <select
                      required
                      className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                      value={form.supplier_id}
                      onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}
                    >
                      <option value="">Selecione...</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setSupplierModalOpen(true)}
                      className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 font-black text-xs hover:bg-slate-50"
                    >
                      + Locadora
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Carteira (informativo)</label>
                  <div className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-primary min-h-[48px] flex items-center">
                    {!form.item_id
                      ? 'Escolha o item primeiro'
                      : eligibleEmployees.length === 1
                        ? eligibleEmployees[0].full_name
                        : eligibleEmployees.length > 1
                          ? `${eligibleEmployees[0].full_name} (auto pelo maior saldo entre ${eligibleEmployees.length})`
                          : 'Nenhum colaborador com este item na carteira'}
                  </div>
                  {form.item_id && eligibleEmployees.length === 0 ? (
                    <p className="text-[11px] font-bold text-slate-500">
                      Sem vínculo de carteira no momento. Você ainda pode configurar o aluguel.
                    </p>
                  ) : null}
                  {form.item_id && eligibleEmployees.length > 1 ? (
                    <p className="text-[11px] font-bold text-amber-700">
                      Há mais de um portador em carteira; o módulo vai salvar com o colaborador de maior saldo.
                    </p>
                  ) : null}
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
                  Regra do módulo: o responsável do aluguel deve ser o colaborador que está com o material na carteira.
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
                  {saving ? 'Salvando...' : editing ? 'Salvar edição' : 'Salvar aluguel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {supplierModalOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b bg-slate-50 flex items-center justify-between">
              <h2 className="text-xl font-bold text-primary">Empresas locadoras</h2>
              <button type="button" onClick={() => setSupplierModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              <form onSubmit={saveSupplier} className="space-y-3 border border-slate-200 rounded-xl p-4 bg-slate-50/70">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Nome da locadora</label>
                  <input
                    required
                    type="text"
                    className="w-full p-3 bg-white border border-slate-200 rounded-lg outline-none"
                    value={supplierForm.name}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase text-slate-400">Contato</label>
                    <input
                      type="text"
                      className="w-full p-3 bg-white border border-slate-200 rounded-lg outline-none"
                      value={supplierForm.contact_name}
                      onChange={(e) => setSupplierForm((f) => ({ ...f, contact_name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase text-slate-400">Telefone</label>
                    <input
                      type="text"
                      className="w-full p-3 bg-white border border-slate-200 rounded-lg outline-none"
                      value={supplierForm.phone}
                      onChange={(e) => setSupplierForm((f) => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Observações</label>
                  <textarea
                    className="w-full p-3 bg-white border border-slate-200 rounded-lg outline-none text-sm min-h-[72px]"
                    value={supplierForm.notes}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
                <button
                  type="submit"
                  disabled={supplierSaving}
                  className="w-full p-3 bg-primary text-white rounded-xl font-bold hover:bg-slate-800 disabled:opacity-50"
                >
                  {supplierSaving ? 'Salvando...' : 'Cadastrar locadora'}
                </button>
              </form>

              <div className="space-y-2">
                {suppliers.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">Nenhuma locadora cadastrada.</p>
                ) : (
                  suppliers.map((s) => (
                    <div key={s.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                      <div className="font-bold text-primary">{s.name}</div>
                      <div className="text-xs text-slate-500">
                        {s.contact_name || 'Sem contato'} {s.phone ? `· ${s.phone}` : ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
