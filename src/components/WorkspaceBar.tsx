'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Layers, Loader2, Plus } from 'lucide-react';
import { useWorkspace, workspaceKindLabel } from '@/lib/workspace';

/**
 * Seletor de workspace dentro da página (ex.: Almoxarifado).
 * Mostra de qual workspace são os dados e troca para outro da mesma organização.
 */
export default function WorkspaceBar() {
  const { status, workspaces, currentWorkspace, currentOrganization, switchWorkspace, isAdm } = useWorkspace();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(
    () =>
      currentOrganization
        ? workspaces
            .filter((w) => w.organization_id === currentOrganization.id && !w.archived_at)
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        : [],
    [workspaces, currentOrganization]
  );

  if (status !== 'ready' || !currentWorkspace) return null;

  const change = async (id: string) => {
    if (id === currentWorkspace.id) return;
    setSwitching(true);
    setError(null);
    try {
      await switchWorkspace(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível trocar de workspace.');
    }
    setSwitching(false);
  };

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 shrink-0">
          <Layers size={14} className="text-secondary" />
          Workspace
        </span>
        {list.length > 1 ? (
          <select
            aria-label="Trocar de workspace"
            value={currentWorkspace.id}
            disabled={switching}
            onChange={(e) => void change(e.target.value)}
            className="min-w-0 max-w-full sm:max-w-xs px-2.5 py-1.5 bg-white border border-secondary/50 rounded text-sm font-bold text-primary disabled:opacity-60"
          >
            {list.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · {workspaceKindLabel(w.kind)}
                {w.city ? ` · ${w.city}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm font-bold text-primary truncate">
            {currentWorkspace.name}
            <span className="font-normal text-slate-500"> · {workspaceKindLabel(currentWorkspace.kind)}</span>
          </span>
        )}
        {switching ? <Loader2 size={16} className="animate-spin text-secondary" /> : null}
        {isAdm && list.length <= 1 ? (
          <Link
            href="/workspaces"
            className="inline-flex items-center gap-1 text-xs font-bold text-secondary hover:underline shrink-0"
          >
            <Plus size={13} />
            Criar outro workspace
          </Link>
        ) : null}
      </div>
      {error ? <p className="text-xs font-bold text-red-600">{error}</p> : null}
    </div>
  );
}
