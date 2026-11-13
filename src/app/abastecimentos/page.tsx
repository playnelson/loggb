'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import { Fuel, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/lib/workspace';
import { formatEmployeeName } from '@/lib/employeeName';
import { SOURCE_COLS, VEHICLE_COLS, type FuelSource, type FuelVehicle } from '@/lib/fuel';
import type { FuelData } from '@/components/fuel/FuelUi';
import FuelLogsTab from '@/components/fuel/FuelLogsTab';
import FuelTankTab from '@/components/fuel/FuelTankTab';
import FuelFleetTab from '@/components/fuel/FuelFleetTab';

type Tab = 'lancamentos' | 'tanque' | 'frota';
const TABS: { id: Tab; label: string }[] = [
  { id: 'lancamentos', label: 'Abastecimentos' },
  { id: 'tanque', label: 'Tanque' },
  { id: 'frota', label: 'Frota e postos' },
];

export default function AbastecimentosPage() {
  const { isAdm, status, currentWorkspace, currentOrganization } = useWorkspace();
  const [tab, setTab] = useState<Tab>('lancamentos');
  const [data, setData] = useState<Omit<FuelData, 'reload'> | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [v, s, e] = await Promise.all([
      supabase.from('fuel_vehicles').select(VEHICLE_COLS).order('description').limit(5000),
      supabase.from('fuel_sources').select(SOURCE_COLS).order('name'),
      supabase.from('employees').select('id, full_name, role, status').order('full_name').limit(5000),
    ]);
    const err = v.error || s.error;
    if (err) {
      setError(
        err.code === '42P01' || err.code === 'PGRST205'
          ? 'O banco ainda não tem o módulo de abastecimentos (etapa 18).'
          : err.message
      );
      return;
    }
    setError('');
    setData({
      vehicles: (v.data ?? []) as FuelVehicle[],
      sources: (s.data ?? []) as FuelSource[],
      employees: ((e.data ?? []) as { id: string; full_name: string; role: string | null; status?: string }[])
        .filter((x) => !x.status || x.status === 'Ativo')
        .map((x) => ({ id: x.id, full_name: formatEmployeeName(x.full_name), role: x.role })),
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (status === 'ready' && isAdm) void load();
  }, [status, isAdm, load, currentWorkspace?.id]);

  if (status !== 'ready') {
    return (
      <div className="p-12 flex justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (!isAdm) {
    return <div className="p-8 text-center text-slate-500">O módulo de abastecimentos está em teste e, por enquanto, só o ADM tem acesso.</div>;
  }

  const fuelData: FuelData | null = data ? { ...data, reload: load } : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl sm:text-[22px] font-bold tracking-tight text-primary flex items-center gap-2">
          <Fuel className="text-secondary" />
          Abastecimentos
          <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Em teste · só ADM</span>
        </h1>
        <p className="text-slate-500 text-sm">
          Autorize o abastecimento, imprima a folha para o posto e lance litros e valores quando chegar o faturamento.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px ${
              tab === t.id ? 'border-secondary text-primary' : 'border-transparent text-slate-500 hover:text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm font-medium">{error}</div>
      ) : !fuelData ? (
        <div className="p-12 flex justify-center text-slate-400">
          <Loader2 className="animate-spin" />
        </div>
      ) : tab === 'lancamentos' ? (
        <FuelLogsTab
          key={currentWorkspace?.id}
          data={fuelData}
          workspaceName={currentWorkspace?.name ?? ''}
          orgId={currentOrganization?.id ?? ''}
        />
      ) : tab === 'tanque' ? (
        <FuelTankTab key={currentWorkspace?.id} data={fuelData} />
      ) : (
        <FuelFleetTab data={fuelData} />
      )}
    </div>
  );
}
