'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRightLeft, Loader2, Plus, Ruler, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  COUNT_COLS,
  ENTRY_COLS,
  KIND_LABEL,
  fmtDay,
  fmtMoney,
  fmtNum,
  isStorage,
  parseNumBr,
  todayIso,
  type FuelTankCount,
  type FuelTankEntry,
} from '@/lib/fuel';
import { Field, Modal, ModalActions, btnGhost, btnPrimary, dbError, inputCls, thCls, type FuelData } from './FuelUi';
import { TankArt, TruckArt } from './FuelArt';

/*
  Saldo de cada tanque/melosa =
    + entradas (compras e transferências recebidas)
    − transferências enviadas
    − abastecimentos com origem nele (não cancelados)
    + acertos das medições marcadas como "acertar saldo" (medido − sistema)
*/
type Moves = { entries: FuelTankEntry[]; counts: FuelTankCount[]; used: Map<string, number> };

async function fetchMoves(ids: string[]): Promise<Moves | { error: string }> {
  const list = ids.join(',');
  const [e, l, c] = await Promise.all([
    supabase
      .from('fuel_tank_entries')
      .select(ENTRY_COLS)
      .or(`tank_id.in.(${list}),from_source_id.in.(${list})`)
      .order('entry_date', { ascending: false })
      .order('id')
      .limit(10000),
    supabase.from('fuel_logs').select('source_id, liters').in('source_id', ids).neq('status', 'cancelado').not('liters', 'is', null).limit(50000),
    supabase.from('fuel_tank_counts').select(COUNT_COLS).in('tank_id', ids).order('count_date', { ascending: false }).limit(5000),
  ]);
  const err = e.error || l.error || c.error;
  if (err) return { error: dbError(err) };
  const used = new Map<string, number>();
  for (const r of (l.data ?? []) as { source_id: string; liters: number }[]) used.set(r.source_id, (used.get(r.source_id) ?? 0) + Number(r.liters));
  return { entries: (e.data ?? []) as FuelTankEntry[], counts: (c.data ?? []) as FuelTankCount[], used };
}

type Bal = { inn: number; out: number; used: number; adj: number; saldo: number };

function balances(ids: string[], m: Moves): Map<string, Bal> {
  const b = new Map<string, Bal>(ids.map((id) => [id, { inn: 0, out: 0, used: m.used.get(id) ?? 0, adj: 0, saldo: 0 }]));
  for (const e of m.entries) {
    const to = b.get(e.tank_id);
    if (to) to.inn += Number(e.liters);
    const from = e.from_source_id ? b.get(e.from_source_id) : undefined;
    if (from) from.out += Number(e.liters);
  }
  for (const c of m.counts) {
    const t = b.get(c.tank_id);
    if (t && c.adjust) t.adj += Number(c.measured_liters) - Number(c.system_liters);
  }
  for (const t of b.values()) t.saldo = Math.round((t.inn - t.out - t.used + t.adj) * 100) / 100;
  return b;
}

const emptyEntry = (tankId: string) => ({
  tank_id: tankId,
  from_source_id: '',
  entry_date: todayIso(),
  liters: '',
  unit_price: '',
  supplier: '',
  invoice: '',
  notes: '',
});

const emptyCount = (tankId: string) => ({ tank_id: tankId, count_date: todayIso(), measured: '', adjust: true, notes: '' });

export default function FuelTankTab({ data }: { data: FuelData }) {
  const tanks = useMemo(() => data.sources.filter((s) => isStorage(s.kind)), [data.sources]);
  const ids = useMemo(() => tanks.map((t) => t.id), [tanks]);
  const [moves, setMoves] = useState<Moves | null>(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<ReturnType<typeof emptyEntry> | null>(null);
  const [count, setCount] = useState<ReturnType<typeof emptyCount> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (ids.length === 0) return setMoves({ entries: [], counts: [], used: new Map() });
    const r = await fetchMoves(ids);
    if ('error' in r) return setLoadError(r.error);
    setLoadError('');
    setMoves(r);
  }, [ids]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const bal = useMemo(() => (moves ? balances(ids, moves) : null), [ids, moves]);
  const tankName = (id: string | null) => (id ? (tanks.find((t) => t.id === id)?.name ?? '—') : '—');
  const lastCount = (id: string) => moves?.counts.find((c) => c.tank_id === id);

  /* ---------- entrada / transferência */
  const liters = form ? parseNumBr(form.liters) : null;
  const price = form ? parseNumBr(form.unit_price) : null;
  const isTransfer = !!form?.from_source_id;
  const total = !isTransfer && liters != null && price != null ? Math.round(liters * price * 100) / 100 : null;

  const saveEntry = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!liters || liters <= 0) return setError('Informe os litros.');
    if (form.from_source_id === form.tank_id) return setError('A origem e o destino precisam ser diferentes.');
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('fuel_tank_entries').insert({
      tank_id: form.tank_id,
      from_source_id: form.from_source_id || null,
      entry_date: form.entry_date,
      liters,
      unit_price: isTransfer ? null : price,
      total,
      supplier: isTransfer ? null : form.supplier.trim().toUpperCase() || null,
      invoice: isTransfer ? null : form.invoice.trim() || null,
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (err) return setError(dbError(err));
    setForm(null);
    await load();
  };

  const removeEntry = async (en: FuelTankEntry) => {
    const what = en.from_source_id ? 'a transferência' : 'a entrada';
    if (!confirm(`Excluir ${what} de ${fmtNum(en.liters)} L de ${fmtDay(en.entry_date)}?`)) return;
    const { error: err } = await supabase.from('fuel_tank_entries').delete().eq('id', en.id);
    if (err) return alert(dbError(err));
    await load();
  };

  /* ---------- medição */
  const measured = count ? parseNumBr(count.measured) : null;
  const sysNow = count ? (bal?.get(count.tank_id)?.saldo ?? 0) : 0;
  const diff = measured != null ? Math.round((measured - sysNow) * 100) / 100 : null;

  const saveCount = async (e: FormEvent) => {
    e.preventDefault();
    if (!count) return;
    if (measured == null || measured < 0) return setError('Informe os litros medidos.');
    setSaving(true);
    setError('');
    // Recalcula o saldo na hora de salvar, para não gravar um número desatualizado.
    const fresh = await fetchMoves(ids);
    if ('error' in fresh) {
      setSaving(false);
      return setError(fresh.error);
    }
    const sys = balances(ids, fresh).get(count.tank_id)?.saldo ?? 0;
    const { error: err } = await supabase.from('fuel_tank_counts').insert({
      tank_id: count.tank_id,
      count_date: count.count_date,
      measured_liters: measured,
      system_liters: sys,
      adjust: count.adjust,
      notes: count.notes.trim() || null,
    });
    setSaving(false);
    if (err) return setError(dbError(err));
    setCount(null);
    await load();
  };

  const removeCount = async (c: FuelTankCount) => {
    if (!confirm(`Excluir a medição de ${fmtDay(c.count_date)} (${fmtNum(c.measured_liters)} L)?`)) return;
    const { error: err } = await supabase.from('fuel_tank_counts').delete().eq('id', c.id);
    if (err) return alert(dbError(err));
    await load();
  };

  if (tanks.length === 0) {
    return (
      <div className="p-10 bg-white rounded-xl border text-center text-slate-500 text-sm">
        Nenhum tanque ou melosa cadastrado. Cadastre em <b>Frota e postos › Novo posto, tanque ou melosa</b>.
      </div>
    );
  }

  const loading = !moves && !loadError;

  return (
    <div className="space-y-5">
      {loadError ? <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{loadError}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tanks.map((t) => {
          const b = bal?.get(t.id);
          const saldo = b?.saldo ?? 0;
          const pct = t.capacity ? (saldo / t.capacity) * 100 : null;
          const lc = lastCount(t.id);
          return (
            <div key={t.id} className={`bg-white rounded-xl border border-border p-4 shadow-sm ${t.active ? '' : 'opacity-60'}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 mr-auto">
                  <div className="text-[10px] font-bold uppercase text-slate-400">
                    {KIND_LABEL[t.kind]} · {t.fuel_type || 'sem combustível'}
                  </div>
                  <div className="font-bold text-primary truncate">{t.name}</div>
                </div>
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => {
                    setError('');
                    setCount(emptyCount(t.id));
                  }}
                  title="Registrar medição"
                >
                  <Ruler size={13} /> Medir
                </button>
              </div>
              <div className="my-2 px-4">{t.kind === 'comboio' ? <TruckArt pct={pct} id={t.id} /> : <TankArt pct={pct} id={t.id} />}</div>
              <div className={`text-2xl font-bold ${saldo < 0 ? 'text-red-600' : 'text-slate-800'}`}>{loading ? '…' : `${fmtNum(saldo, 0)} L`}</div>
              <div className="text-[11px] text-slate-500">
                {pct != null ? `${Math.max(0, pct).toFixed(0)}% de ${fmtNum(t.capacity, 0)} L` : 'Cadastre a capacidade para ver o nível.'}
              </div>
              {b ? (
                <div className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                  Entradas {fmtNum(b.inn, 0)} L · Abastecimentos {fmtNum(b.used, 0)} L
                  {b.out ? ` · Transferido ${fmtNum(b.out, 0)} L` : ''}
                  {b.adj ? ` · Acertos ${b.adj > 0 ? '+' : ''}${fmtNum(b.adj, 0)} L` : ''}
                </div>
              ) : null}
              {lc ? (
                <div className="text-[11px] mt-1">
                  Última medição {fmtDay(lc.count_date)}: {fmtNum(lc.measured_liters, 0)} L{' '}
                  <DiffTag v={Number(lc.measured_liters) - Number(lc.system_liters)} />
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 mt-1">Ainda sem medição.</div>
              )}
              {saldo < 0 && !loading ? <div className="text-[11px] text-red-600 mt-1">Saldo negativo: falta lançar alguma entrada.</div> : null}
            </div>
          );
        })}
      </div>

      {/* ---------- entradas e transferências */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-primary mr-auto">Entradas e transferências</h2>
        {tanks.length > 1 ? (
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              setError('');
              const dest = tanks.find((t) => t.kind === 'comboio') ?? tanks[1];
              const orig = tanks.find((t) => t.kind === 'tanque' && t.id !== dest.id) ?? tanks.find((t) => t.id !== dest.id)!;
              setForm({ ...emptyEntry(dest.id), from_source_id: orig.id });
            }}
          >
            <ArrowRightLeft size={14} /> Transferir
          </button>
        ) : null}
        <button
          type="button"
          className={btnPrimary}
          onClick={() => {
            setError('');
            setForm(emptyEntry(tanks[0].id));
          }}
        >
          <Plus size={16} /> Nova compra
        </button>
      </div>
      <p className="text-xs text-slate-500 -mt-3">
        Compra = combustível que chegou da distribuidora. Transferência = do tanque para a melosa (ou entre tanques). Os abastecimentos
        com origem no tanque ou na melosa saem do saldo sozinhos.
      </p>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-x-auto">
        {loading ? (
          <div className="p-10 flex justify-center text-slate-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : !moves || moves.entries.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">Nenhuma entrada lançada.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className={thCls}>Data</th>
                <th className={thCls}>Destino</th>
                <th className={thCls}>Origem</th>
                <th className={`${thCls} text-right`}>Litros</th>
                <th className={`${thCls} text-right`}>R$ / L</th>
                <th className={`${thCls} text-right`}>Total</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {moves.entries.map((en) => (
                <tr key={en.id}>
                  <td className="px-3 py-2">{fmtDay(en.entry_date)}</td>
                  <td className="px-3 py-2 font-medium">{tankName(en.tank_id)}</td>
                  <td className="px-3 py-2 text-xs">
                    {en.from_source_id ? (
                      <span className="inline-flex items-center gap-1 text-orange-700 font-bold">
                        <ArrowRightLeft size={12} /> {tankName(en.from_source_id)}
                      </span>
                    ) : (
                      <>
                        {en.supplier || 'Compra'}
                        {en.invoice ? <span className="text-slate-500"> · NF {en.invoice}</span> : null}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-bold">{fmtNum(en.liters)}</td>
                  <td className="px-3 py-2 text-right">{en.unit_price != null ? fmtNum(en.unit_price, 3) : '—'}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(en.total)}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className={btnGhost} onClick={() => removeEntry(en)} aria-label="Excluir">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---------- medições */}
      <h2 className="font-bold text-primary">Medições</h2>
      <p className="text-xs text-slate-500 -mt-3">
        Meça o tanque ou a melosa e lance os litros. O sistema compara com o saldo calculado e mostra a perda ou sobra. Marcando “acertar o
        saldo”, a diferença passa a valer.
      </p>
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-x-auto">
        {!moves || moves.counts.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Nenhuma medição lançada. Use o botão “Medir” no tanque.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className={thCls}>Data</th>
                <th className={thCls}>Tanque / melosa</th>
                <th className={`${thCls} text-right`}>Sistema</th>
                <th className={`${thCls} text-right`}>Medido</th>
                <th className={`${thCls} text-right`}>Diferença</th>
                <th className={thCls}>Saldo</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {moves.counts.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">{fmtDay(c.count_date)}</td>
                  <td className="px-3 py-2 font-medium">
                    {tankName(c.tank_id)}
                    {c.notes ? <div className="text-xs text-slate-500">{c.notes}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtNum(c.system_liters)}</td>
                  <td className="px-3 py-2 text-right font-bold">{fmtNum(c.measured_liters)}</td>
                  <td className="px-3 py-2 text-right">
                    <DiffTag v={Number(c.measured_liters) - Number(c.system_liters)} />
                  </td>
                  <td className="px-3 py-2 text-xs">{c.adjust ? 'Acertado' : 'Só conferido'}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className={btnGhost} onClick={() => removeCount(c)} aria-label="Excluir">
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
        <Modal title={isTransfer ? 'Transferência' : 'Compra de combustível'} onClose={() => setForm(null)}>
          <form onSubmit={saveEntry} className="space-y-3">
            {error ? <div className="text-sm text-red-600 font-medium">{error}</div> : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="De onde vem">
                <select className={inputCls} value={form.from_source_id} onChange={(e) => setForm({ ...form, from_source_id: e.target.value })}>
                  <option value="">Compra (distribuidora)</option>
                  {tanks
                    .filter((t) => t.id !== form.tank_id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        Transferência de {t.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Para onde vai">
                <select className={inputCls} value={form.tank_id} onChange={(e) => setForm({ ...form, tank_id: e.target.value })}>
                  {tanks
                    .filter((t) => t.id !== form.from_source_id)
                    .map((t) => (
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
              {!isTransfer ? (
                <>
                  <Field label="Preço por litro (R$)" hint={total != null ? `Total: ${fmtMoney(total)}` : undefined}>
                    <input className={inputCls} inputMode="decimal" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} />
                  </Field>
                  <Field label="Nota fiscal">
                    <input className={inputCls} value={form.invoice} onChange={(e) => setForm({ ...form, invoice: e.target.value })} />
                  </Field>
                  <div className="col-span-2">
                    <Field label="Fornecedor">
                      <input className={inputCls} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
                    </Field>
                  </div>
                </>
              ) : null}
            </div>
            {isTransfer && liters ? (
              <p className="text-xs text-slate-600">
                Sai {fmtNum(liters)} L de <b>{tankName(form.from_source_id)}</b> e entra em <b>{tankName(form.tank_id)}</b>.
              </p>
            ) : null}
            <Field label="Observação">
              <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <ModalActions onCancel={() => setForm(null)} saving={saving} />
          </form>
        </Modal>
      ) : null}

      {count ? (
        <Modal title="Medição" onClose={() => setCount(null)}>
          <form onSubmit={saveCount} className="space-y-3">
            {error ? <div className="text-sm text-red-600 font-medium">{error}</div> : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tanque / melosa">
                <select className={inputCls} value={count.tank_id} onChange={(e) => setCount({ ...count, tank_id: e.target.value })}>
                  {tanks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Data">
                <input type="date" className={inputCls} required value={count.count_date} onChange={(e) => setCount({ ...count, count_date: e.target.value })} />
              </Field>
              <Field label="Saldo no sistema">
                <div className="mt-1 p-2.5 bg-slate-100 rounded-lg text-sm font-bold text-slate-700">{fmtNum(sysNow)} L</div>
              </Field>
              <Field label="Litros medidos">
                <input className={inputCls} inputMode="decimal" required autoFocus value={count.measured} onChange={(e) => setCount({ ...count, measured: e.target.value })} />
              </Field>
            </div>
            {diff != null ? (
              <div className="p-3 rounded-lg bg-slate-50 border text-sm flex items-center justify-between">
                <span>Diferença</span>
                <DiffTag v={diff} big />
              </div>
            ) : null}
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={count.adjust} onChange={(e) => setCount({ ...count, adjust: e.target.checked })} />
              <span>
                Acertar o saldo para o medido
                <span className="block text-[11px] text-slate-500">Desmarque se for só uma conferência e o saldo do sistema deve continuar.</span>
              </span>
            </label>
            <Field label="Observação">
              <input className={inputCls} value={count.notes} onChange={(e) => setCount({ ...count, notes: e.target.value })} placeholder="Ex.: medido na régua às 7h" />
            </Field>
            <ModalActions onCancel={() => setCount(null)} saving={saving} />
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function DiffTag({ v, big }: { v: number; big?: boolean }) {
  const r = Math.round(v * 100) / 100;
  const cls = r === 0 ? 'text-green-700' : r < 0 ? 'text-red-600' : 'text-sky-700';
  const txt = r === 0 ? 'bateu' : `${r > 0 ? '+' : ''}${fmtNum(r)} L ${r < 0 ? '(falta)' : '(sobra)'}`;
  return <span className={`font-bold ${cls} ${big ? 'text-base' : 'text-[11px]'}`}>{txt}</span>;
}
