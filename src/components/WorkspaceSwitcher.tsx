'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Layers, Loader2, Plus } from 'lucide-react';
import { useWorkspace, workspaceKindLabel } from '@/lib/workspace';
import { OrgLogo } from '@/components/OrganizationSetup';

/** Botão no topo com a organização + workspace atual; abre a lista para trocar. */
export default function WorkspaceSwitcher() {
  const { status, organizations, workspaces, currentWorkspace, currentOrganization, switchWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (status === 'unavailable') return null;

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 min-w-0 px-2 py-1.5 text-slate-300" aria-busy>
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  const go = async (id: string) => {
    if (id === currentWorkspace?.id) {
      setOpen(false);
      return;
    }
    setSwitching(id);
    setError(null);
    try {
      await switchWorkspace(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível trocar de workspace.');
      setSwitching(null);
    }
  };

  const label = currentWorkspace?.name ?? (status === 'onboarding' ? 'Criar organização' : 'Escolher workspace');

  return (
    <div ref={boxRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Trocar de workspace"
        className={`flex items-center gap-2 min-w-0 max-w-[46vw] sm:max-w-[240px] lg:max-w-[200px] xl:max-w-[260px] rounded border px-2 py-1 transition-colors ${
          open ? 'border-white/30 bg-white/15' : 'border-white/15 bg-white/5 hover:bg-white/10 hover:border-white/25'
        }`}
      >
        <OrgLogo src={currentOrganization?.logo_data} name={currentOrganization?.name ?? ''} size={26} />
        <span className="min-w-0 text-left leading-tight">
          <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 truncate">
            {currentOrganization?.name ?? 'Workspace'}
          </span>
          <span className="block text-[13px] font-semibold text-white truncate">{label}</span>
        </span>
        <ChevronDown size={15} className={`shrink-0 text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div
          role="menu"
          className="fixed left-2 right-2 top-[3.75rem] sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-1.5 sm:w-80 max-h-[70vh] overflow-y-auto rounded border border-slate-300 bg-white shadow-xl py-1 z-[70] text-primary"
        >
          {organizations.map((org) => {
            const list = workspaces.filter((w) => w.organization_id === org.id && !w.archived_at);
            return (
              <div key={org.id} className="pb-1">
                <div className="flex items-center gap-2 px-2.5 pt-2 pb-1">
                  <OrgLogo src={org.logo_data} name={org.name} size={20} />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">{org.name}</span>
                </div>
                {list.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400 italic">Nenhum workspace ativo.</p>
                ) : (
                  list.map((w) => {
                    const active = w.id === currentWorkspace?.id;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        role="menuitem"
                        disabled={switching !== null}
                        onClick={() => void go(w.id)}
                        className={`w-full flex items-center gap-2 border-l-[3px] px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                          active ? 'border-secondary bg-secondary/10' : 'border-transparent hover:bg-slate-100'
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-primary truncate">{w.name}</span>
                          <span className="block text-[11px] text-slate-500 truncate">
                            {workspaceKindLabel(w.kind)}
                            {w.city ? ` · ${w.city}` : ''}
                          </span>
                        </span>
                        {switching === w.id ? (
                          <Loader2 size={16} className="animate-spin text-secondary shrink-0" />
                        ) : active ? (
                          <Check size={16} className="text-secondary shrink-0" />
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            );
          })}

          {error ? <p className="px-3 py-2 text-xs font-bold text-red-600">{error}</p> : null}

          <div className="border-t border-slate-100 mt-1 pt-1">
            <Link
              href="/workspaces"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-primary hover:bg-slate-100"
            >
              <Layers size={16} className="text-slate-400" />
              Gerenciar workspaces
            </Link>
            <Link
              href="/workspaces"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-primary hover:bg-slate-100"
            >
              <Plus size={16} className="text-slate-400" />
              Novo workspace
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
