'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Ban, Loader2, Plus, Printer, ReceiptText, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatEmployeeName } from '@/lib/employeeName';
import { buildFuelAuthorizationHtml, openPrintable, type FuelAuthorizationData } from '@/lib/printDocs';
import {
  LOG_COLS,
  METER_LABEL,
  METER_SHORT,
  fmtDay,
  fmtMoney,
  fmtNum,
  parseNumBr,
  todayIso,
  type FuelLog,
  type FuelSource,
  type FuelVehicle,
  type MeterType,
} from '@/lib/fuel';
import { FuelTypeInput } from './FuelFleetTab';
import { Field, Modal, btnGhost, btnPrimary, dbError, inputCls, thCls, type FuelData } from './FuelUi';

const AUTH_KEY = 'loggb_fuel_autorizador';

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

function shiftDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export default function FuelLogsTab({ data, workspaceName, orgId }: { data: FuelData; workspaceName: string; orgId: string }) {
  const { vehicles, sources, employees } = data;
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [billing, setBilling] = useState<FuelLog[] | 'open' | null>(null);
  const [openCount, setOpenCount] = useState(0);

  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = monthRange(month);
    // Busca um pouco antes do mês para calcular km/horas rodados do primeiro abastecimento.
    const [res, open] = await Promise.all([
      supabase.from('fuel_logs').select(LOG_COLS).gte('log_date', shiftDays(from, -120)).lte('log_date', to).order('control_no').limit(10000),
      supabase.from('fuel_logs').select('id', { count: 'exact', head: true }).eq('status', 'autorizado'),
    ]);
    setLogs((res.data ?? []) as FuelLog[]);
    setOpenCount(open.count ?? 0);
    setLoading(false);
  }, [month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** Leitura anterior do mesmo equipamento (para km/horas rodados). */
  const prevReading = useMemo(() => {
    const last = new Map<string, number>();
    const out = new Map<string, number>();
    for (const l of logs) {
      if (l.status === 'cancelado' || l.meter_reading == null || l.meter_type === 'nenhum') continue;
      const p = last.get(l.vehicle_id);
      if (p != null) out.set(l.id, p);
      last.set(l.vehicle_id, Number(l.meter_reading));
    }
    return out;
  }, [logs]);

  const { from, to } = monthRange(month);
  const shown = useMemo(() => {
    const t = q.trim().toUpperCase();
    return logs
      .filter((l) => l.log_date >= from && l.log_date <= to)
      .filter((l) => !sourceFilter || l.source_id === sourceFilter)
      .filter((l) => !statusFilter || l.status === statusFilter)
      .filter((l) => {
        if (!t) return true;
        const v = vehicleById.get(l.vehicle_id);
        return [String(l.control_no), v?.code, v?.description, v?.plate, l.requester_name, l.fuel_type].some((x) =>
          String(x ?? '').toUpperCase().includes(t)
        );
      })
      .sort((a, b) => b.control_no - a.control_no);
  }, [logs, from, to, sourceFilter, statusFilter, q, vehicleById]);

  const totals = useMemo(() => {
    const valid = shown.filter((l) => l.status !== 'cancelado');
    return {
      count: valid.length,
      liters: valid.reduce((a, l) => a + Number(l.liters ?? 0), 0),
      value: valid.reduce((a, l) => a + Number(l.total ?? 0), 0),
    };
  }, [shown]);

  const printData = (l: FuelLog): FuelAuthorizationData => {
    const v = vehicleById.get(l.vehicle_id);
    const s = sourceById.get(l.source_id);
    return {
        controlNo: l.control_no,
        date: l.log_date,
        sourceName: s?.name ?? '—',
        sourceKind: s?.kind ?? 'posto',
        workspaceName,
        requester: l.requester_name ?? '',
        vehicle: v?.description ?? '—',
        plate: v?.plate ?? '',
        code: v?.code ?? '',
        fuelType: l.fuel_type,
        meterType: l.meter_type,
        meterReading: l.meter_reading,
        liters: l.liters,
        authorizedBy: l.authorized_by ?? '',
        notes: l.notes ?? '',
    };
  };

  const printLog = (l: FuelLog) => {
    void openPrintable(`Autorização de abastecimento ${l.control_no}`, async () => buildFuelAuthorizationHtml(printData(l)));
  };

  const cancelLog = async (l: FuelLog) => {
    if (!confirm(`Cancelar a autorização nº ${l.control_no}? Ela continua na lista como cancelada.`)) return;
    const { error } = await supabase.from('fuel_logs').update({ status: 'cancelado' }).eq('id', l.id);
    if (error) return alert(dbError(error));
    await load();
  };

  const statusBadge = (l: FuelLog) => {
    const tank = sourceById.get(l.source_id)?.kind === 'tanque';
    const [txt, cls] =
      l.status === 'cancelado'
        ? ['Cancelado', 'bg-slate-200 text-slate-600']
        : l.status === 'faturado'
          ? [tank ? 'Abastecido' : 'Faturado', 'bg-green-100 text-green-700']
          : ['Autorizado', 'bg-amber-100 text-amber-800'];
    return <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full whitespace-nowrap ${cls}`}>{txt}</span>;
  };

  const noSetup = vehicles.length === 0 || sources.length === 0;

  return (
    <div className="space-y-4">
      {noSetup ? (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
          Antes de autorizar, cadastre a frota e pelo menos um posto ou tanque na aba <b>Frota e postos</b>.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnPrimary} disabled={noSetup} onClick={() => setCreating(true)}>
          <Plus size={16} /> Nova autorização
        </button>
        <button type="button" className={`${btnGhost} py-2`} disabled={openCount === 0} onClick={() => setBilling('open')}>
          <ReceiptText size={14} /> Lançar faturamento{openCount ? ` (${openCount} em aberto)` : ''}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold uppercase text-slate-400">
          Mês
          <input type="month" className={`${inputCls} !mt-0.5 !py-1.5`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
        <label className="text-xs font-bold uppercase text-slate-400">
          Posto / tanque
          <select className={`${inputCls} !mt-0.5 !py-1.5`} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="">Todos</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold uppercase text-slate-400">
          Situação
          <select className={`${inputCls} !mt-0.5 !py-1.5`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Todas</option>
            <option value="autorizado">Autorizado (sem faturar)</option>
            <option value="faturado">Faturado / abastecido</option>
            <option value="cancelado">Cancelado</option>
          </select>
        </label>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none"
            placeholder="Nº, equipamento, placa, solicitante…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-white border rounded-xl p-2">
          <div className="text-[10px] uppercase font-bold text-slate-400">Abastecimentos</div>
          <div className="text-lg font-bold text-primary">{totals.count}</div>
        </div>
        <div className="bg-white border rounded-xl p-2">
          <div className="text-[10px] uppercase font-bold text-slate-400">Litros lançados</div>
          <div className="text-lg font-bold text-primary">{fmtNum(totals.liters)}</div>
        </div>
        <div className="bg-white border rounded-xl p-2">
          <div className="text-[10px] uppercase font-bold text-slate-400">Valor faturado</div>
          <div className="text-lg font-bold text-primary">{fmtMoney(totals.value)}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-x-auto">
        {loading ? (
          <div className="p-10 flex justify-center text-slate-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">Nenhum abastecimento neste mês.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className={thCls}>Nº / data</th>
                <th className={thCls}>Equipamento</th>
                <th className={thCls}>Solicitante</th>
                <th className={thCls}>Origem / combustível</th>
                <th className={`${thCls} text-right`}>Leitura</th>
                <th className={`${thCls} text-right`}>Litros</th>
                <th className={`${thCls} text-right`}>Valor</th>
                <th className={thCls}>Situação</th>
                <th className={`${thCls} text-right`}>Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((l) => {
                const v = vehicleById.get(l.vehicle_id);
                const s = sourceById.get(l.source_id);
                const prev = prevReading.get(l.id);
                const run = prev != null && l.meter_reading != null ? Number(l.meter_reading) - prev : null;
                const kml =
                  run != null && run > 0 && l.liters
                    ? l.meter_type === 'km'
                      ? `${fmtNum(run / Number(l.liters))} km/L`
                      : `${fmtNum(Number(l.liters) / run)} L/h`
                    : null;
                return (
                  <tr key={l.id} className={l.status === 'cancelado' ? 'opacity-50' : ''}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="font-mono font-bold text-primary">{l.control_no}</div>
                      <div className="text-xs text-slate-500">{fmtDay(l.log_date)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-bold">{v?.description ?? '—'}</div>
                      <div className="text-xs text-slate-500">{[v?.code, v?.plate].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{l.requester_name || '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-medium">{s?.name ?? '—'}</div>
                      <div className="text-slate-500">{l.fuel_type}</div>
                    </td>
                    <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                      {l.meter_type === 'nenhum' || l.meter_reading == null ? (
                        '—'
                      ) : (
                        <>
                          <div className="font-medium">
                            {fmtNum(l.meter_reading, l.meter_type === 'km' ? 0 : 1)} {METER_SHORT[l.meter_type]}
                          </div>
                          {run != null ? (
                            <div className={run < 0 ? 'text-red-600' : 'text-slate-500'}>
                              +{fmtNum(run, l.meter_type === 'km' ? 0 : 1)} {METER_SHORT[l.meter_type]}
                              {kml ? ` · ${kml}` : ''}
                            </div>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-bold whitespace-nowrap">{l.liters != null ? fmtNum(l.liters) : '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {fmtMoney(l.total)}
                      {l.unit_price != null ? <div className="text-[11px] text-slate-500">{fmtNum(l.unit_price, 3)}/L</div> : null}
                    </td>
                    <td className="px-3 py-2">{statusBadge(l)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                      <button type="button" className={btnGhost} onClick={() => printLog(l)} title="Imprimir autorização">
                        <Printer size={13} />
                      </button>
                      {l.status !== 'cancelado' && s?.kind !== 'tanque' ? (
                        <button type="button" className={btnGhost} onClick={() => setBilling([l])} title="Lançar ou corrigir faturamento">
                          <ReceiptText size={13} /> {l.status === 'faturado' ? 'Corrigir' : 'Faturar'}
                        </button>
                      ) : null}
                      {l.status !== 'cancelado' ? (
                        <button type="button" className={btnGhost} onClick={() => cancelLog(l)} title="Cancelar">
                          <Ban size={13} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {creating ? (
        <NewAuthorization
          vehicles={vehicles.filter((v) => v.active)}
          sources={sources.filter((s) => s.active)}
          employees={employees}
          orgId={orgId}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
          printData={printData}
        />
      ) : null}

      {billing ? (
        <BillingModal
          initial={billing === 'open' ? null : billing}
          sources={sources.filter((s) => s.kind === 'posto')}
          vehicleById={vehicleById}
          onClose={() => setBilling(null)}
          onSaved={async () => {
            setBilling(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ nova autorização */

function NewAuthorization({
  vehicles,
  sources,
  employees,
  orgId,
  onClose,
  onSaved,
  printData,
}: {
  vehicles: FuelVehicle[];
  sources: FuelSource[];
  employees: FuelData['employees'];
  orgId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  printData: (l: FuelLog) => FuelAuthorizationData;
}) {
  const [f, setF] = useState({
    log_date: todayIso(),
    source_id: sources.find((s) => s.kind === 'posto')?.id ?? sources[0]?.id ?? '',
    vehicle_id: '',
    fuel_type: '',
    meter_type: 'km' as MeterType,
    meter_reading: '',
    requester_employee_id: '',
    authorized_by: '',
    liters: '',
    notes: '',
  });
  const [lastReading, setLastReading] = useState<{ value: number; date: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const source = sources.find((s) => s.id === f.source_id);
  const isTank = source?.kind === 'tanque';

  // Quem autoriza: o último usado neste aparelho ou o colaborador ligado ao usuário.
  useEffect(() => {
    let saved = '';
    try {
      saved = localStorage.getItem(AUTH_KEY) || '';
    } catch {}
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setF((x) => ({ ...x, authorized_by: saved }));
      return;
    }
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) return;
      let name = String(user.user_metadata?.full_name || user.user_metadata?.name || '');
      const { data: m } = await supabase
        .from('organization_members')
        .select('employee_id')
        .eq('user_id', user.id)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (m?.employee_id) {
        const { data: emp } = await supabase.from('employees').select('full_name, role').eq('id', m.employee_id).maybeSingle();
        if (emp?.full_name) name = `${formatEmployeeName(emp.full_name)}${emp.role ? ` – ${emp.role}` : ''}`;
      }
      if (name) setF((x) => (x.authorized_by ? x : { ...x, authorized_by: name.toUpperCase() }));
    })();
  }, [orgId]);

  const pickVehicle = async (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    setF((x) => ({
      ...x,
      vehicle_id: id,
      meter_type: v?.meter_type ?? 'km',
      fuel_type: isTank && source?.fuel_type ? source.fuel_type : v?.fuel_type || x.fuel_type,
    }));
    setLastReading(null);
    if (!id) return;
    const { data } = await supabase
      .from('fuel_logs')
      .select('meter_reading, log_date')
      .eq('vehicle_id', id)
      .neq('status', 'cancelado')
      .not('meter_reading', 'is', null)
      .order('control_no', { ascending: false })
      .limit(1);
    const r = (data ?? [])[0] as { meter_reading: number; log_date: string } | undefined;
    if (r) setLastReading({ value: Number(r.meter_reading), date: r.log_date });
  };

  const pickSource = (id: string) => {
    const s = sources.find((x) => x.id === id);
    setF((x) => ({ ...x, source_id: id, fuel_type: s?.kind === 'tanque' && s.fuel_type ? s.fuel_type : x.fuel_type }));
  };

  const grouped = useMemo(() => {
    const m = new Map<string, FuelVehicle[]>();
    for (const v of [...vehicles].sort((a, b) => String(a.code ?? a.description).localeCompare(String(b.code ?? b.description), 'pt-BR', { numeric: true }))) {
      const g = v.group_name || 'SEM GRUPO';
      m.set(g, [...(m.get(g) ?? []), v]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [vehicles]);

  const submit = async (e: FormEvent, andPrint: boolean) => {
    e.preventDefault();
    setError('');
    const reading = parseNumBr(f.meter_reading);
    const liters = parseNumBr(f.liters);
    if (!f.vehicle_id) return setError('Escolha o equipamento.');
    if (!f.fuel_type.trim()) return setError('Informe o combustível.');
    if (f.meter_type !== 'nenhum' && reading == null) return setError(`Informe ${f.meter_type === 'km' ? 'o km' : 'o horímetro'} atual.`);
    if (isTank && (!liters || liters <= 0)) return setError('Saída do tanque: informe os litros abastecidos.');
    if (lastReading && reading != null && reading < lastReading.value) {
      if (!confirm(`A leitura (${fmtNum(reading)}) é menor que a última (${fmtNum(lastReading.value)}). Salvar mesmo assim?`)) return;
    }
    const emp = employees.find((x) => x.id === f.requester_employee_id);
    const row = {
      log_date: f.log_date,
      source_id: f.source_id,
      vehicle_id: f.vehicle_id,
      requester_employee_id: emp?.id ?? null,
      requester_name: emp ? `${emp.full_name}${emp.role ? ` – ${emp.role.toUpperCase()}` : ''}` : null,
      authorized_by: f.authorized_by.trim().toUpperCase() || null,
      fuel_type: f.fuel_type.trim().toUpperCase(),
      meter_type: f.meter_type,
      meter_reading: f.meter_type === 'nenhum' ? null : reading,
      liters: liters && liters > 0 ? liters : null,
      status: isTank ? 'faturado' : 'autorizado',
      notes: f.notes.trim() || null,
    };
    setSaving(true);
    const insert = async (): Promise<FuelLog | { error: string }> => {
      const { data, error: err } = await supabase.from('fuel_logs').insert(row).select(LOG_COLS).single();
      if (err || !data) return { error: dbError(err) || 'Erro ao salvar.' };
      try {
        if (row.authorized_by) localStorage.setItem(AUTH_KEY, row.authorized_by);
      } catch {}
      return data as FuelLog;
    };
    let ok = false;
    let ran = false;
    if (andPrint) {
      // A aba de impressão abre no clique (senão o navegador bloqueia) e o documento sai depois de salvar.
      await openPrintable('Autorização de abastecimento', async () => {
        ran = true;
        const r = await insert();
        if ('error' in r) {
          setError(r.error);
          return r;
        }
        ok = true;
        return buildFuelAuthorizationHtml(printData(r));
      });
    }
    if (andPrint && !ran) {
      // Pop-up bloqueado: salva assim mesmo; dá para imprimir depois pelo botão da lista.
      const r = await insert();
      if ('error' in r) setError(r.error);
      else ok = true;
    } else if (!andPrint) {
      const r = await insert();
      if ('error' in r) setError(r.error);
      else ok = true;
    }
    setSaving(false);
    if (ok) await onSaved();
  };

  return (
    <Modal title="Nova autorização de abastecimento" onClose={onClose} wide>
      <form onSubmit={(e) => submit(e, true)} className="space-y-3">
        {error ? <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700 font-medium">{error}</div> : null}
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Data">
            <input type="date" className={inputCls} required value={f.log_date} onChange={(e) => setF({ ...f, log_date: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Onde abastece">
              <select className={inputCls} value={f.source_id} onChange={(e) => pickSource(e.target.value)}>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.kind === 'tanque' ? 'Tanque próprio: ' : 'Posto: '}
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <Field label="Equipamento / veículo">
          <select className={inputCls} value={f.vehicle_id} onChange={(e) => pickVehicle(e.target.value)} required>
            <option value="">Escolha…</option>
            {grouped.map(([g, list]) => (
              <optgroup key={g} label={g}>
                {list.map((v) => (
                  <option key={v.id} value={v.id}>
                    {[v.code, v.description, v.plate].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Combustível">
            <FuelTypeInput value={f.fuel_type} onChange={(v) => setF({ ...f, fuel_type: v })} />
          </Field>
          <Field label="Controle">
            <select className={inputCls} value={f.meter_type} onChange={(e) => setF({ ...f, meter_type: e.target.value as MeterType })}>
              {(Object.keys(METER_LABEL) as MeterType[]).map((k) => (
                <option key={k} value={k}>
                  {METER_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          {f.meter_type !== 'nenhum' ? (
            <Field
              label={f.meter_type === 'km' ? 'Km atual' : 'Horímetro atual'}
              hint={lastReading ? `Último: ${fmtNum(lastReading.value)} em ${fmtDay(lastReading.date)}` : undefined}
            >
              <input className={inputCls} inputMode="decimal" value={f.meter_reading} onChange={(e) => setF({ ...f, meter_reading: e.target.value })} />
            </Field>
          ) : null}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Solicitante">
            <select className={inputCls} value={f.requester_employee_id} onChange={(e) => setF({ ...f, requester_employee_id: e.target.value })}>
              <option value="">—</option>
              {employees.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.full_name}
                  {x.role ? ` – ${x.role}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Autorizado por">
            <input
              className={inputCls}
              value={f.authorized_by}
              onChange={(e) => setF({ ...f, authorized_by: e.target.value })}
              placeholder="NOME – CARGO"
            />
          </Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label={isTank ? 'Litros abastecidos' : 'Litros (opcional)'} hint={isTank ? undefined : 'No posto, os litros entram no faturamento.'}>
            <input className={inputCls} inputMode="decimal" value={f.liters} onChange={(e) => setF({ ...f, liters: e.target.value })} required={isTank} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Observação">
              <input className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </Field>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-slate-200 rounded-xl font-bold text-slate-500">
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={(e) => submit(e as unknown as FormEvent, false)}
            className="flex-1 py-2.5 border border-primary text-primary rounded-xl font-bold disabled:opacity-50"
          >
            Só salvar
          </button>
          <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-primary text-white rounded-xl font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2">
            <Printer size={16} /> {saving ? 'Salvando…' : 'Salvar e imprimir'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ faturamento */

function BillingModal({
  initial,
  sources,
  vehicleById,
  onClose,
  onSaved,
}: {
  initial: FuelLog[] | null;
  sources: FuelSource[];
  vehicleById: Map<string, FuelVehicle>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [rows, setRows] = useState<FuelLog[]>(initial ?? []);
  const [loading, setLoading] = useState(!initial);
  const [sourceId, setSourceId] = useState(initial?.[0]?.source_id ?? '');
  const [invoice, setInvoice] = useState(initial?.[0]?.invoice ?? '');
  const [liters, setLiters] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial ?? []).map((l) => [l.id, l.liters != null ? fmtNum(l.liters) : '']))
  );
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial ?? []).filter((l) => l.unit_price != null).map((l) => [l.fuel_type, fmtNum(l.unit_price, 3)]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initial) return;
    void (async () => {
      const { data } = await supabase.from('fuel_logs').select(LOG_COLS).eq('status', 'autorizado').order('control_no').limit(2000);
      const list = ((data ?? []) as FuelLog[]).filter((l) => sources.some((s) => s.id === l.source_id));
      setRows(list);
      setSourceId((cur) => cur || list[0]?.source_id || '');
      setLoading(false);
    })();
  }, [initial, sources]);

  const visible = initial ? rows : rows.filter((l) => l.source_id === sourceId);
  const fuels = [...new Set(visible.map((l) => l.fuel_type))];
  const totalOf = (l: FuelLog) => {
    const li = parseNumBr(liters[l.id]);
    const p = parseNumBr(prices[l.fuel_type]);
    return li != null && p != null ? Math.round(li * p * 100) / 100 : null;
  };
  const filled = visible.filter((l) => (parseNumBr(liters[l.id]) ?? 0) > 0);
  const sum = filled.reduce((a, l) => a + (totalOf(l) ?? 0), 0);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (filled.length === 0) return setError('Informe os litros de pelo menos um abastecimento.');
    setSaving(true);
    setError('');
    const now = new Date().toISOString();
    for (const l of filled) {
      const { error: err } = await supabase
        .from('fuel_logs')
        .update({
          liters: parseNumBr(liters[l.id]),
          unit_price: parseNumBr(prices[l.fuel_type]),
          total: totalOf(l),
          invoice: invoice.trim() || null,
          status: 'faturado',
          billed_at: now,
        })
        .eq('id', l.id);
      if (err) {
        setSaving(false);
        return setError(`Nº ${l.control_no}: ${dbError(err)}`);
      }
    }
    setSaving(false);
    await onSaved();
  };

  return (
    <Modal title="Lançar faturamento" onClose={onClose} wide>
      <form onSubmit={save} className="space-y-3">
        {error ? <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700 font-medium">{error}</div> : null}
        {loading ? (
          <div className="p-8 flex justify-center text-slate-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              {initial ? null : (
                <Field label="Posto">
                  <select className={inputCls} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                    {sources
                      .filter((s) => rows.some((l) => l.source_id === s.id))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({rows.filter((l) => l.source_id === s.id).length})
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <Field label="Nota fiscal / cupom">
                <input className={inputCls} value={invoice} onChange={(e) => setInvoice(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-3">
              {fuels.map((fu) => (
                <label key={fu} className="text-xs font-bold uppercase text-slate-400">
                  R$ por litro — {fu}
                  <input
                    className={`${inputCls} !w-36`}
                    inputMode="decimal"
                    value={prices[fu] ?? ''}
                    onChange={(e) => setPrices({ ...prices, [fu]: e.target.value })}
                    placeholder="0,000"
                  />
                </label>
              ))}
            </div>
            {visible.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-sm">Nada em aberto para faturar.</div>
            ) : (
              <div className="border rounded-lg overflow-auto max-h-[45vh]">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className={thCls}>Nº / data</th>
                      <th className={thCls}>Equipamento</th>
                      <th className={thCls}>Combustível</th>
                      <th className={`${thCls} text-right`}>Litros</th>
                      <th className={`${thCls} text-right`}>Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {visible.map((l) => {
                      const v = vehicleById.get(l.vehicle_id);
                      return (
                        <tr key={l.id}>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            <b className="font-mono">{l.control_no}</b> <span className="text-xs text-slate-500">{fmtDay(l.log_date)}</span>
                          </td>
                          <td className="px-3 py-1.5 text-xs">
                            <b>{v?.description ?? '—'}</b> {v?.plate ? <span className="text-slate-500">· {v.plate}</span> : null}
                          </td>
                          <td className="px-3 py-1.5 text-xs">{l.fuel_type}</td>
                          <td className="px-3 py-1.5 text-right">
                            <input
                              className="w-24 p-1.5 text-right bg-slate-50 border border-slate-200 rounded"
                              inputMode="decimal"
                              value={liters[l.id] ?? ''}
                              onChange={(e) => setLiters({ ...liters, [l.id]: e.target.value })}
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{fmtMoney(totalOf(l))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="text-right text-sm">
              {filled.length} de {visible.length} com litros · Total <b>{fmtMoney(sum)}</b>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-slate-200 rounded-xl font-bold text-slate-500">
                Cancelar
              </button>
              <button type="submit" disabled={saving || filled.length === 0} className="flex-1 py-2.5 bg-primary text-white rounded-xl font-bold disabled:opacity-50">
                {saving ? 'Salvando…' : `Faturar ${filled.length || ''}`}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
