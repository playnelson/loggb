'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Settings2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/lib/workspace';
import { normCategory, type AccessArea } from '@/lib/permissions';

/** "todos" = tudo que a pessoa vê; "outros" = itens de categorias sem almoxarifado. */
export type AlmoxSelection = string;

const STORAGE_KEY = 'loggb.almoxarifado';

/**
 * Almoxarifados da organização (Organização › Almoxarifados) que a pessoa enxerga.
 * ADM, "todos os almoxarifados" e quem só consulta veem todos; os demais, só os seus.
 */
export function useAlmoxarifados() {
  const { status, currentOrganization, access, isAdm } = useWorkspace();
  const [all, setAll] = useState<AccessArea[]>([]);
  const orgId = currentOrganization?.id ?? null;

  const load = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase
      .from('stock_areas')
      .select('id, name, categories')
      .eq('organization_id', orgId)
      .order('name', { ascending: true });
    if (!error) setAll((data ?? []) as AccessArea[]);
  }, [orgId]);

  useEffect(() => {
    if (status !== 'ready') return;
    // Lista de almoxarifados vem do servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [status, load]);

  return useMemo(() => {
    const seesAll = isAdm || !access || access.all_areas || access.areas.length === 0;
    const mine = seesAll ? all : all.filter((a) => access?.areas.some((x) => x.id === a.id));
    return { list: mine, seesAll };
  }, [all, access, isAdm]);
}

/** O item é deste almoxarifado (pela categoria)? */
export function itemInAlmox(
  category: string | null | undefined,
  selection: AlmoxSelection,
  list: AccessArea[]
): boolean {
  if (selection === 'todos') return true;
  const k = normCategory(category);
  if (selection === 'outros') return !list.some((a) => a.categories.some((c) => normCategory(c) === k));
  const area = list.find((a) => a.id === selection);
  if (!area) return true;
  return area.categories.some((c) => normCategory(c) === k);
}

/** Lembra o almoxarifado escolhido neste navegador. */
export function useAlmoxSelection(list: AccessArea[]): [AlmoxSelection, (v: AlmoxSelection) => void] {
  const [value, setValue] = useState<AlmoxSelection>('todos');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      // Preferência guardada no navegador (só existe no cliente).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setValue(saved);
    } catch {
      /* navegador sem armazenamento */
    }
  }, []);
  const set = useCallback((v: AlmoxSelection) => {
    setValue(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* navegador sem armazenamento: só não lembra */
    }
  }, []);
  // Almoxarifado removido (ou de outra organização): volta para "todos".
  const valid = value === 'todos' || value === 'outros' || list.length === 0 || list.some((a) => a.id === value);
  return [valid ? value : 'todos', set];
}

/** Abas de almoxarifado no topo da página Almoxarifado. */
export default function AlmoxarifadoTabs({
  list,
  seesAll,
  value,
  onChange,
  counts,
}: {
  list: AccessArea[];
  seesAll: boolean;
  value: AlmoxSelection;
  onChange: (v: AlmoxSelection) => void;
  /** Itens ativos por aba (id do almoxarifado, "todos" e "outros"). */
  counts: Record<string, number>;
}) {
  const { isAdm } = useWorkspace();
  if (list.length === 0) {
    return isAdm ? (
      <p className="text-xs text-slate-500">
        <Boxes size={13} className="inline -mt-0.5 mr-1 text-secondary" />
        Divida o estoque em almoxarifados (EPIs, Ferramentas…) e escolha os responsáveis em{' '}
        <Link href="/organizacao" className="font-bold text-secondary hover:underline">
          Organização › Almoxarifados
        </Link>
        .
      </p>
    ) : null;
  }

  const tabs: { key: string; label: string }[] = [
    ...(list.length > 1 || seesAll ? [{ key: 'todos', label: seesAll ? 'Todos' : 'Todos os meus' }] : []),
    ...list.map((a) => ({ key: a.id, label: a.name })),
    ...(seesAll && (counts.outros ?? 0) > 0 ? [{ key: 'outros', label: 'Sem almoxarifado' }] : []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Almoxarifados">
      {tabs.map((t) => {
        const on = tabs.length === 1 || value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold border transition-colors ${
              on
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-primary border-slate-300 hover:border-secondary hover:text-secondary'
            }`}
          >
            {t.label}
            <span className={`text-[11px] font-semibold ${on ? 'text-white/70' : 'text-slate-400'}`}>
              {counts[t.key] ?? 0}
            </span>
          </button>
        );
      })}
      {isAdm ? (
        <Link
          href="/organizacao"
          title="Criar almoxarifados e escolher os responsáveis"
          className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-bold text-slate-500 hover:text-secondary"
        >
          <Settings2 size={14} />
          Gerenciar
        </Link>
      ) : null}
    </div>
  );
}
