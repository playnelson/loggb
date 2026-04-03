'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { WorkSiteKind, WorkSiteRow } from '@/lib/workSites';
import { isWorkSiteKind } from '@/lib/workSites';
import { ArrowLeft, Building2, HardHat, Loader2, MapPin, Pencil, Plus, X } from 'lucide-react';

type EmployeeOpt = { id: string; full_name: string };

function mapSiteRow(r: Record<string, unknown>): WorkSiteRow {
  const kindRaw = String(r.kind ?? '');
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    name: String(r.name ?? ''),
    kind: isWorkSiteKind(kindRaw) ? kindRaw : 'canteiro',
    responsible_employee_id: r.responsible_employee_id ? String(r.responsible_employee_id) : null,
    notes: r.notes != null ? String(r.notes) : null,
    active: Boolean(r.active),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

const emptyForm = () => ({
  name: '',
  kind: 'canteiro' as WorkSiteKind,
  responsible_employee_id: '',
  notes: '',
  active: true,
});

export default function SitesPage() {
  const [sites, setSites] = useState<WorkSiteRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkSiteRow | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSites([]);
      setEmployees([]);
      setLoading(false);
      return;
    }

    const { data: siteData, error: siteErr } = await supabase
      .from('work_sites')
      .select('id, user_id, name, kind, responsible_employee_id, notes, active, created_at, updated_at')
      .eq('user_id', user.id)
      .order('name', { ascending: true });

    if (siteErr) {
      console.error(siteErr);
      setSites([]);
      setError(
        siteErr.message?.includes('work_sites') || siteErr.code === '42P01'
          ? 'Tabela work_sites não encontrada. Execute supabase/work_sites.sql no Supabase.'
          : siteErr.message
      );
    } else {
      setError(null);
      setSites((siteData || []).map((r: unknown) => mapSiteRow(r as Record<string, unknown>)));
    }

    const { data: empData, error: empErr } = await supabase
      .from('employees')
      .select('id, full_name, status')
      .eq('user_id', user.id)
      .order('full_name', { ascending: true });
    if (empErr) {
      console.error(empErr);
      setEmployees([]);
    } else {
      setEmployees(
        (empData || [])
          .filter((e: { status?: string }) => !e.status || e.status === 'Ativo')
          .map((e: { id: string; full_name: string }) => ({ id: e.id, full_name: e.full_name }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nameByEmpId = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) m.set(e.id, e.full_name);
    return m;
  }, [employees]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (s: WorkSiteRow) => {
    setEditing(s);
    setForm({
      name: s.name,
      kind: s.kind,
      responsible_employee_id: s.responsible_employee_id || '',
      notes: s.notes || '',
      active: s.active,
    });
    setError(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (name.length < 2) {
      setError('Informe um nome com pelo menos 2 caracteres.');
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Usuário não autenticado.');
      return;
    }
    setSaving(true);
    setError(null);
    const row = {
      name,
      kind: form.kind,
      responsible_employee_id: form.responsible_employee_id || null,
      notes: form.notes.trim() || null,
      active: form.active,
      updated_at: new Date().toISOString(),
    };
    if (editing) {
      const { error: upErr } = await supabase.from('work_sites').update(row).eq('id', editing.id).eq('user_id', user.id);
      if (upErr) {
        setError(upErr.message);
        setSaving(false);
        return;
      }
    } else {
      const { error: inErr } = await supabase.from('work_sites').insert([
        { ...row, user_id: user.id, created_at: new Date().toISOString() },
      ]);
      if (inErr) {
        setError(inErr.message);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setModalOpen(false);
    await load();
  };

  const kindLabel = (k: WorkSiteKind) => (k === 'sede' ? 'Sede' : 'Canteiro');

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
            <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
              <MapPin className="text-secondary" />
              Sedes e canteiros
            </h1>
            <p className="text-slate-500 text-sm">
              Cadastre locais para enviar ou receber materiais; cada um pode ter um responsável entre os funcionários.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="flex items-center justify-center gap-2 bg-secondary text-white px-4 py-2 rounded-lg font-medium hover:opacity-95"
        >
          <Plus size={18} />
          Novo local
        </button>
      </div>

      {error && !modalOpen && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm font-medium">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center text-slate-400">
            <Loader2 className="animate-spin" size={28} />
          </div>
        ) : sites.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            Nenhum local cadastrado. Use &quot;Novo local&quot; ou confira se o script SQL foi aplicado no Supabase.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nome</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tipo</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Responsável</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sites.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <div className="font-bold text-primary">{s.name}</div>
                      {s.notes && <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{s.notes}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-lg">
                        {s.kind === 'sede' ? <Building2 size={14} /> : <HardHat size={14} />}
                        {kindLabel(s.kind)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {s.responsible_employee_id
                        ? nameByEmpId.get(s.responsible_employee_id) || '—'
                        : <span className="text-slate-400 italic">Não definido</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${
                          s.active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {s.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(s)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-primary border border-slate-200 rounded-lg hover:bg-slate-50"
                      >
                        <Pencil size={14} />
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b bg-slate-50 flex items-center justify-between">
              <h2 className="text-lg font-bold text-primary">{editing ? 'Editar local' : 'Novo local'}</h2>
              <button type="button" onClick={() => setModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              {error && <div className="text-sm text-red-600 font-medium">{error}</div>}
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Nome</label>
                <input
                  className="mt-1 w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ex.: Canteiro Obra Norte"
                  required
                  minLength={2}
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Tipo</label>
                <select
                  className="mt-1 w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                  value={form.kind}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, kind: (e.target.value === 'sede' ? 'sede' : 'canteiro') as WorkSiteKind }))
                  }
                >
                  <option value="canteiro">Canteiro</option>
                  <option value="sede">Sede de trabalho</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Responsável (funcionário)</label>
                <select
                  className="mt-1 w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                  value={form.responsible_employee_id}
                  onChange={(e) => setForm((f) => ({ ...f, responsible_employee_id: e.target.value }))}
                >
                  <option value="">Nenhum</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Observações</label>
                <textarea
                  className="mt-1 w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm min-h-[72px]"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Opcional"
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                Local ativo (aparece nas retiradas e entradas)
              </label>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-500"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-bold disabled:opacity-50"
                >
                  {saving ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
