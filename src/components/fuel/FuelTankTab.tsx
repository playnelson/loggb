'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ENTRY_COLS, fmtDay, fmtMoney, fmtNum, parseNumBr, todayIso, type FuelTankEntry } from '@/lib/fuel';
import { Field, Modal, ModalActions, btnGhost, btnPrimary, dbError, inputCls, thCls, type FuelData } from './FuelUi';

const emptyEntry = (tankId: string) => ({
  tank_id: tankId,
  entry_date: todayIso(),
  liters: '',
  unit_price: '',
  supplier: '',
  invoice: '',
  notes: '',
});

export default function FuelTankTab({ data }: { data: FuelData }) {
  const tanks = useMemo(() => data.sources.filter((s) => s.kind === 'tanque'), [data.sources]);
  const [entries, setEntries] = useState<FuelTankEntry[]>([]);
  const [used, setUsed] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ReturnType<typeof emptyEntry> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const ids = tanks.map((t) => t.id);
    if (ids.length === 0) {
      setEntries([]);
      setUsed(new Map());
      setLoading(false);
      return;
    }
    const [e, l] = await Promise.all([
      supabase.from('fuel_tank_entries').select(ENTRY_COLS).in('tank_id', ids).order('entry_date', { ascending: false }).limit(5000),
      supabase.from('fuel_logs').select('source_id, liters').in('source_id', ids).neq('status', 'cancelado').not('liters', 'is', null).limit(20000),
    ]);
    setEntries((e.data ?? []) as FuelTankEntry[]);
    const m = new Map<string, number>();
    for (const r of (l.data ?? []) as { source_id: string; liters: number }[]) m.set(r.source_id, (m.get(r.source_id) ?? 0) + Number(r.liters));
    setUsed(m);
    setLoading(false);
  }, [tanks]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const entered = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.tank_id, (m.get(e.tank_id) ?? 0) + Number(e.liters));
    return m;
  }, [entries]);

  const tankName = (id: string) => tanks.find((t) => t.id === id)?.name ?? '—';

  const liters = form ? parseNumBr(form.liters) : null;
  const price = form ? parseNumBr(form.unit_price) : null;
  const total = liters != null && price != null ? Math.round(liters * price * 100) / 100 : null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!liters || liters <= 0) return setError('Informe os litros.');
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('fuel_tank_entries').insert({
      tank_id: form.tank_id,
      entry_date: form.entry_date,
      liters,
      unit_price: price,
      total,
      supplier: form.supplier.trim().toUpperCase() || null,
      invoice: form.invoice.trim() || null,
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (err) return setError(dbError(err));
    setForm(null);
    await load();
  };

  const remove = async (en: FuelTankEntry) => {
    if (!confirm(`Excluir a entrada de ${fmtNum(en.liters)} L de ${fmtDay(en.entry_date)}?`)) return;
    const { error: err } = await supabase.from('fuel_tank_entries').delete().eq('id', en.id);
    if (err) return alert(dbError(err));
    await load();
  };

  if (tanks.length === 0) {
    return (
      <div className="p-10 bg-white rounded-xl border text-center text-slate-500 text-sm">
        Nenhum tanque cadastrado. Cadastre em <b>Frota e postos › Novo posto ou tanque</b>, tipo “Tanque próprio”.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tanks.map((t) => {
          const saldo = (entered.get(t.id) ?? 0) - (used.get(t.id) ?? 0);
          const pct = t.capacity ? Math.max(0, Math.min(100, (saldo / t.capacity) * 100)) : null;
          return (
            <div key={t.id} className="bg-white rounded-xl border border-border p-4 shadow-sm">
              <div className="text-xs font-bold uppercase text-slate-400">{t.fuel_type || 'Tanque'}</div>
              <div className="font-bold text-primary">{t.name}</div>
              <div className={`text-2xl font-bold mt-1 ${saldo < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {loading ? '…' : `${fmtNum(saldo)} L`}
              </div>
              {pct != null ? (
                <div className="mt-2">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${pct < 15 ? 'bg-red-500' : 'bg-secondary'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {pct.toFixed(0)}% de {fmtNum(t.capacity, 0)} L
                  </div>
                </div>
              ) : null}
              <div className="text-[11px] text-slate-500 mt-2">
                Entradas {fmtNum(entered.get(t.id) ?? 0)} L · Saídas {fmtNum(used.get(t.id) ?? 0)} L
              </div>
              {saldo < 0 ? <div className="text-[11px] text-red-600 mt-1">Saldo negativo: falta lançar alguma entrada.</div> : null}
            </div>
          );
        })}
      </div>

      <div className="flex items-center">
        <h2 className="font-bold text-primary mr-auto">Entradas no tanque (compras)</h2>
        <button
          type="button"
          className={btnPrimary}
          onClick={() => {
            setError('');
            setForm(emptyEntry(tanks[0].id));
          }}
        >
          <Plus size={16} /> Nova entrada
        </button>
      </div>
      <p className="text-xs text-slate-500 -mt-2">
        As saídas do tanque são os abastecimentos lançados com origem no tanque, na aba Abastecimentos.
      </p>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-x-auto">
        {loading ? (
          <div className="p-10 flex justify-center text-slate-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">Nenhuma entrada lançada.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className={thCls}>Data</th>
                <th className={thCls}>Tanque</th>
                <th className={thCls}>Fornecedor / nota</th>
                <th className={`${thCls} text-right`}>Litros</th>
                <th className={`${thCls} text-right`}>R$ / L</th>
                <th className={`${thCls} text-right`}>Total</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((en) => (
                <tr key={en.id}>
                  <td className="px-3 py-2">{fmtDay(en.entry_date)}</td>
                  <td className="px-3 py-2 font-medium">{tankName(en.tank_id)}</td>
                  <td className="px-3 py-2 text-xs">
                    {en.supplier || '—'}
                    {en.invoice ? <span className="text-slate-500"> · NF {en.invoice}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right font-bold">{fmtNum(en.liters)}</td>
                  <td className="px-3 py-2 text-right">{en.unit_price != null ? fmtNum(en.unit_price, 3) : '—'}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(en.total)}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className={btnGhost} onClick={() => remove(en)} aria-label="Excluir">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form ? (
        <Modal title="Nova entrada no tanque" onClose={() => setForm(null)}>
          <form onSubmit={save} className="space-y-3">
            {error ? <div className="text-sm text-red-600 font-medium">{error}</div> : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tanque">
                <select className={inputCls} value={form.tank_id} onChange={(e) => setForm({ ...form, tank_id: e.target.value })}>
                  {tanks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Data">
                <input type="date" className={inputCls} required value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
              </Field>
              <Field label="Litros">
                <input className={inputCls} inputMode="decimal" required value={form.liters} onChange={(e) => setForm({ ...form, liters: e.target.value })} />
              </Field>
              <Field label="Preço por litro (R$)" hint={total != null ? `Total: ${fmtMoney(total)}` : undefined}>
                <input className={inputCls} inputMode="decimal" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} />
              </Field>
              <Field label="Fornecedor">
                <input className={inputCls} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
              </Field>
              <Field label="Nota fiscal">
                <input className={inputCls} value={form.invoice} onChange={(e) => setForm({ ...form, invoice: e.target.value })} />
              </Field>
            </div>
            <Field label="Observação">
              <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <ModalActions onCancel={() => setForm(null)} saving={saving} />
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
