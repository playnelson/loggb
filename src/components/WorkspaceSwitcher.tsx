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
      <div className="flex items-center gap-2 min-w-0 px-2 py-1.5 text-slate-400" aria-busy>
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
        className={`flex items-center gap-2 min-w-0 max-w-[46vw] sm:max-w-[240px] lg:max-w-[200px] xl:max-w-[260px] rounded-xl border px-2 py-1.5 transition-colors ${
          open ? 'border-secondary/50 bg-white' : 'border-slate-200/90 bg-white/70 hover:bg-white hover:border-slate-300'
        }`}
      >
        <OrgLogo src={currentOrganization?.logo_data} name={currentOrganization?.name ?? ''} size={28} />
        <span className="min-w-0 text-left leading-tight">
          <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400 truncate">
            {currentOrganization?.name ?? 'Workspace'}
          </span>
          <span className="block text-sm font-bold text-primary truncate">{label}</span>
        </span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div
          role="menu"
          className="fixed left-3 right-3 top-[4.25rem] sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:w-80 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl p-1.5 z-[70] animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {organizations.map((org) => {
            const list = workspaces.filter((w) => w.organization_id === org.id && !w.archived_at);
            return (
              <div key={org.id} className="pb-1">
                <div className="flex items-center gap-2 px-2.5 pt-2 pb-1">
                  <OrgLogo src={org.logo_data} name={org.name} size={20} />
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 truncate">{org.name}</span>
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
                        className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                          active ? 'bg-secondary/15' : 'hover:bg-slate-50'
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
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-primary hover:bg-slate-50"
            >
              <Layers size={16} className="text-slate-400" />
              Gerenciar workspaces
            </Link>
            <Link
              href="/workspaces?nova=1"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-primary hover:bg-slate-50"
            >
              <Plus size={16} className="text-slate-400" />
              Nova organização
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
