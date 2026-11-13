'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  Building2,
  Check,
  Folder,
  HardHat,
  Layers,
  Loader2,
  LogIn,
  MapPin,
  Pencil,
  Plus,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  ORG_ROLE_LABEL,
  WORKSPACE_KINDS,
  useWorkspace,
  workspaceKindLabel,
  type Organization,
  type Workspace,
  type WorkspaceKind,
} from '@/lib/workspace';
import { LogoPicker, OrgLogo, OrganizationSetupForm } from '@/components/OrganizationSetup';

const inputClass = 'mt-1 w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-secondary';
const labelClass = 'text-xs font-bold uppercase text-slate-400';

function KindIcon({ kind, size = 18 }: { kind: WorkspaceKind; size?: number }) {
  if (kind === 'canteiro') return <HardHat size={size} />;
  if (kind === 'cidade') return <MapPin size={size} />;
  if (kind === 'sede') return <Building2 size={size} />;
  return <Folder size={size} />;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-[80] flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-4 overflow-hidden">
        <div className="p-5 border-b bg-slate-50 flex items-center justify-between">
          <h2 className="text-lg font-bold text-primary">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Criar ou editar um workspace (canteiro, cidade, sede). */
function WorkspaceForm({
  organizationId,
  editing,
  onDone,
  onCancel,
}: {
  organizationId: string;
  editing: Workspace | null;
  onDone: (createdId: string | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [kind, setKind] = useState<WorkspaceKind>(editing?.kind ?? 'canteiro');
  const [city, setCity] = useState(editing?.city ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Informe o nome do workspace.');
      return;
    }
    setSaving(true);
    setError(null);
    const row = { name: name.trim(), kind, city: city.trim() || null, notes: notes.trim() || null };
    if (editing) {
      const { error: upErr } = await supabase.from('workspaces').update(row).eq('id', editing.id);
      if (upErr) {
        setError(upErr.message);
        setSaving(false);
        return;
      }
      onDone(null);
    } else {
      const { data, error: insErr } = await supabase
        .from('workspaces')
        .insert([{ ...row, organization_id: organizationId }])
        .select('id')
        .single();
      if (insErr || !data) {
        setError(insErr?.message || 'Não foi possível criar o workspace.');
        setSaving(false);
        return;
      }
      onDone(String(data.id));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <div className="text-sm font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">{error}</div> : null}
      <div>
        <label className={labelClass} htmlFor="wsf-name">Nome</label>
        <input
          id="wsf-name"
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Obra 234 – Montes Claros"
          maxLength={120}
          required
          autoFocus
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="wsf-kind">Tipo</label>
          <select
            id="wsf-kind"
            className={`${inputClass} font-medium`}
            value={kind}
            onChange={(e) => setKind(e.target.value as WorkspaceKind)}
          >
            {WORKSPACE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="wsf-city">Cidade / UF</label>
          <input
            id="wsf-city"
            className={inputClass}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Ex.: Montes Claros/MG"
            maxLength={120}
          />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="wsf-notes">Observações</label>
        <textarea
          id="wsf-notes"
          className={`${inputClass} text-sm min-h-[72px]`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Opcional"
          maxLength={500}
        />
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-lg font-bold text-slate-600 hover:bg-slate-100">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 bg-secondary text-white px-5 py-2.5 rounded-lg font-bold hover:opacity-95 disabled:opacity-60"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          {editing ? 'Salvar' : 'Criar workspace'}
        </button>
      </div>
    </form>
  );
}

/** Editar nome e logo da organização. */
function OrganizationEditForm({
  org,
  onDone,
  onCancel,
}: {
  org: Organization;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(org.name);
  const [logo, setLogo] = useState<string | null>(org.logo_data);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Informe o nome da organização.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: upErr } = await supabase
      .from('organizations')
      .update({ name: name.trim(), logo_data: logo, updated_at: new Date().toISOString() })
      .eq('id', org.id);
    if (upErr) {
      setError(upErr.message);
      setSaving(false);
      return;
    }
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <div className="text-sm font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">{error}</div> : null}
      <div>
        <label className={labelClass} htmlFor="orgf-name">Nome da empresa ou organização</label>
        <input
          id="orgf-name"
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
          autoFocus
        />
      </div>
      <div>
        <span className={labelClass}>Logo</span>
        <div className="mt-2">
          <LogoPicker value={logo} name={name} onChange={setLogo} />
        </div>
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-lg font-bold text-slate-600 hover:bg-slate-100">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 bg-secondary text-white px-5 py-2.5 rounded-lg font-bold hover:opacity-95 disabled:opacity-60"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          Salvar
        </button>
      </div>
    </form>
  );
}

type ModalState =
  | { type: 'new-org' }
  | { type: 'edit-org'; org: Organization }
  | { type: 'new-ws'; organizationId: string }
  | { type: 'edit-ws'; organizationId: string; ws: Workspace }
  | null;

function WorkspacesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, organizations, workspaces, currentWorkspace, reload, switchWorkspace, isOrgAdmin } = useWorkspace();
  const [modal, setModal] = useState<ModalState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Link "Nova organização" do menu abre o formulário direto.
  useEffect(() => {
    if (searchParams.get('nova') === '1') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModal({ type: 'new-org' });
      router.replace('/workspaces');
    }
  }, [searchParams, router]);

  const enter = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await switchWorkspace(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível entrar no workspace.');
      setBusyId(null);
    }
  };

  const setArchived = async (ws: Workspace, archive: boolean) => {
    if (archive) {
      if (ws.id === currentWorkspace?.id) {
        setError('Você está neste workspace. Entre em outro antes de arquivá-lo.');
        return;
      }
      if (!window.confirm(`Arquivar "${ws.name}"? Os dados ficam guardados e você pode reativar depois.`)) return;
    }
    setBusyId(ws.id);
    setError(null);
    const { error: upErr } = await supabase
      .from('workspaces')
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq('id', ws.id);
    setBusyId(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    await reload();
  };

  if (status === 'unavailable') {
    return (
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm font-medium">
        Os workspaces ainda não estão disponíveis. Aplique supabase/etapa5_organizacoes_workspaces.sql no Supabase.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Layers className="text-secondary" />
            Workspaces
          </h1>
          <p className="text-slate-500 text-sm">
            Cada workspace é um canteiro, cidade ou sede, com estoque, equipe e histórico próprios.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ type: 'new-org' })}
          className="flex items-center justify-center gap-2 border border-slate-200 bg-white text-primary px-4 py-2 rounded-lg font-bold hover:bg-slate-50"
        >
          <Plus size={18} />
          Nova organização
        </button>
      </div>

      {error ? (
        <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm font-bold">{error}</div>
      ) : null}

      {organizations.map((org) => {
        const admin = isOrgAdmin(org.id);
        const orgWs = workspaces.filter((w) => w.organization_id === org.id);
        const active = orgWs.filter((w) => !w.archived_at);
        const archived = orgWs.filter((w) => w.archived_at);
        return (
          <section key={org.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <OrgLogo src={org.logo_data} name={org.name} size={52} />
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-primary truncate">{org.name}</h2>
                  <p className="text-xs text-slate-500">
                    Seu papel: <span className="font-bold">{ORG_ROLE_LABEL[org.role]}</span> · {active.length}{' '}
                    {active.length === 1 ? 'workspace ativo' : 'workspaces ativos'}
                  </p>
                </div>
              </div>
              {admin ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setModal({ type: 'edit-org', org })}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-primary border border-slate-200 bg-white rounded-lg hover:bg-slate-50"
                  >
                    <Pencil size={14} />
                    Nome e logo
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal({ type: 'new-ws', organizationId: org.id })}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-secondary rounded-lg hover:opacity-95"
                  >
                    <Plus size={14} />
                    Novo workspace
                  </button>
                </div>
              ) : null}
            </div>

            <div className="p-4 sm:p-5">
              {active.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">
                  Nenhum workspace ativo nesta organização.
                  {admin ? ' Use "Novo workspace" para criar um.' : ''}
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {active.map((w) => {
                    const isCurrent = w.id === currentWorkspace?.id;
                    return (
                      <div
                        key={w.id}
                        className={`rounded-xl border p-4 flex flex-col gap-3 ${
                          isCurrent ? 'border-secondary/60 bg-secondary/5 ring-1 ring-secondary/30' : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="w-10 h-10 rounded-lg bg-primary/5 text-primary flex items-center justify-center shrink-0">
                            <KindIcon kind={w.kind} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-primary truncate">{w.name}</h3>
                              {isCurrent ? (
                                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-secondary text-white shrink-0">
                                  Atual
                                </span>
                              ) : null}
                            </div>
                            <p className="text-xs text-slate-500 truncate">
                              {workspaceKindLabel(w.kind)}
                              {w.city ? ` · ${w.city}` : ''}
                            </p>
                            {w.notes ? <p className="text-xs text-slate-400 mt-1 line-clamp-2">{w.notes}</p> : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-auto">
                          {!isCurrent ? (
                            <button
                              type="button"
                              disabled={busyId !== null}
                              onClick={() => void enter(w.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-primary rounded-lg hover:opacity-90 disabled:opacity-60"
                            >
                              {busyId === w.id ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
                              Entrar
                            </button>
                          ) : null}
                          {admin ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setModal({ type: 'edit-ws', organizationId: org.id, ws: w })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary border border-slate-200 rounded-lg hover:bg-slate-50"
                              >
                                <Pencil size={14} />
                                Editar
                              </button>
                              {!isCurrent ? (
                                <button
                                  type="button"
                                  disabled={busyId !== null}
                                  onClick={() => void setArchived(w, true)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60"
                                >
                                  <Archive size={14} />
                                  Arquivar
                                </button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {archived.length > 0 ? (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowArchived((v) => !v)}
                    className="text-xs font-bold text-slate-500 hover:text-primary"
                  >
                    {showArchived ? 'Ocultar' : 'Mostrar'} arquivados ({archived.length})
                  </button>
                  {showArchived ? (
                    <ul className="mt-2 divide-y divide-slate-100">
                      {archived.map((w) => (
                        <li key={w.id} className="flex items-center justify-between gap-3 py-2">
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-slate-500 truncate">{w.name}</span>
                            <span className="block text-[11px] text-slate-400">
                              {workspaceKindLabel(w.kind)}
                              {w.city ? ` · ${w.city}` : ''}
                            </span>
                          </span>
                          {admin ? (
                            <button
                              type="button"
                              disabled={busyId !== null}
                              onClick={() => void setArchived(w, false)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60 shrink-0"
                            >
                              {busyId === w.id ? <Loader2 size={14} className="animate-spin" /> : <ArchiveRestore size={14} />}
                              Reativar
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        );
      })}

      {modal?.type === 'new-org' ? (
        <Modal title="Nova organização" onClose={() => setModal(null)}>
          <OrganizationSetupForm onCreated={() => window.location.assign('/workspaces')} onCancel={() => setModal(null)} />
        </Modal>
      ) : null}

      {modal?.type === 'edit-org' ? (
        <Modal title="Nome e logo da organização" onClose={() => setModal(null)}>
          <OrganizationEditForm
            org={modal.org}
            onCancel={() => setModal(null)}
            onDone={() => {
              setModal(null);
              void reload();
            }}
          />
        </Modal>
      ) : null}

      {modal?.type === 'new-ws' || modal?.type === 'edit-ws' ? (
        <Modal title={modal.type === 'new-ws' ? 'Novo workspace' : 'Editar workspace'} onClose={() => setModal(null)}>
          <WorkspaceForm
            organizationId={modal.organizationId}
            editing={modal.type === 'edit-ws' ? modal.ws : null}
            onCancel={() => setModal(null)}
            onDone={() => {
              setModal(null);
              void reload();
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}

export default function WorkspacesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 flex justify-center text-slate-400">
          <Loader2 className="animate-spin" size={28} />
        </div>
      }
    >
      <WorkspacesContent />
    </Suspense>
  );
}
