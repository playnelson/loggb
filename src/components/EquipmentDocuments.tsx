'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Download, ExternalLink, FileText, Image as ImageIcon, Loader2, Paperclip, Printer, Trash2, Upload, X } from 'lucide-react';
import { openPrintable, buildReceiptHtml, loadCompanyInfo } from '@/lib/printDocs';
import { supabase } from '@/lib/supabase';
import { formatDateTimeBR, useWorkspace } from '@/lib/workspace';
import { useCanApproveDeletion } from '@/lib/deletion';
import DeletionDialog from '@/components/DeletionDialog';
import {
  EQUIPMENT_DOC_ACCEPT,
  EQUIPMENT_DOC_COLUMNS,
  EQUIPMENT_DOC_KIND_LABEL,
  checkEquipmentDocFile,
  equipmentDocItemLabel,
  formatFileSize,
  openEquipmentDoc,
  uploadEquipmentDoc,
  type EquipmentDoc,
  type EquipmentDocKind,
} from '@/lib/equipmentDocs';

const KIND_CHIP: Record<EquipmentDocKind, string> = {
  entrega: 'bg-blue-50 text-blue-800 border-blue-200',
  devolucao: 'bg-green-50 text-green-800 border-green-200',
  outro: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function EquipmentDocKindChip({ kind }: { kind: EquipmentDocKind }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide ${KIND_CHIP[kind]}`}>
      {EQUIPMENT_DOC_KIND_LABEL[kind]}
    </span>
  );
}

/** Linha de um documento: tipo, nome, item, data e botões Abrir / Baixar / Apagar. */
export function EquipmentDocRow({
  doc,
  showItem,
  canDelete,
  onDeleted,
}: {
  doc: EquipmentDoc;
  showItem: boolean;
  canDelete: boolean;
  onDeleted?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const approver = useCanApproveDeletion();
  const isPdf = doc.mime_type === 'application/pdf';
  const Icon = isPdf ? FileText : ImageIcon;
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    if (err) alert(err);
  };
  return (
    <li className="py-2 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
      <span className="flex items-start gap-2 min-w-0 flex-1">
        <Icon size={18} className="text-slate-400 shrink-0 mt-0.5" />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <EquipmentDocKindChip kind={doc.kind} />
            <span className="text-sm font-semibold text-primary truncate max-w-[260px]" title={doc.file_name}>
              {doc.file_name}
            </span>
          </span>
          <span className="block text-[11px] text-slate-500">
            {showItem ? `${equipmentDocItemLabel(doc)} · ` : ''}
            {formatDateTimeBR(doc.created_at)} · {formatFileSize(doc.size_bytes)}
          </span>
          {doc.note ? <span className="block text-[11px] text-slate-600 italic">{doc.note}</span> : null}
        </span>
      </span>
      <span className="flex gap-1.5 shrink-0">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => openEquipmentDoc(supabase, doc))}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-primary border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-60"
        >
          <ExternalLink size={13} />
          Abrir
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => openEquipmentDoc(supabase, doc, true))}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-secondary rounded hover:brightness-110 disabled:opacity-60"
        >
          <Download size={13} />
          Baixar
        </button>
        {canDelete ? (
          <button
            type="button"
            disabled={busy}
            title={approver ? 'Apagar documento' : 'Pedir exclusão do documento'}
            aria-label={approver ? 'Apagar documento' : 'Pedir exclusão do documento'}
            onClick={() => setConfirming(true)}
            className="inline-flex items-center px-2 py-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </button>
        ) : null}
      </span>
      {confirming ? (
        <DeletionDialog
          entity="documento"
          id={doc.id}
          label={doc.file_name}
          note="O arquivo some para todos do workspace."
          onClose={() => setConfirming(false)}
          onDone={(outcome) => {
            setConfirming(false);
            if (outcome.kind === 'done') onDeleted?.();
          }}
        />
      ) : null}
    </li>
  );
}

/** Campo opcional de arquivo (usado nas janelas de entrega e devolução). */
export function DocFileField({
  label,
  hint,
  file,
  onChange,
}: {
  label: string;
  hint?: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <span className="text-xs font-bold uppercase text-slate-400 block">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-primary border border-dashed border-slate-400 rounded hover:bg-slate-50 hover:border-secondary"
        >
          <Paperclip size={14} />
          {file ? 'Trocar arquivo' : 'Escolher arquivo'}
        </button>
        {file ? (
          <span className="min-w-0 flex items-center gap-1 text-xs text-primary">
            <span className="truncate max-w-[160px]" title={file.name}>
              {file.name}
            </span>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                if (ref.current) ref.current.value = '';
              }}
              className="text-slate-400 hover:text-red-600"
              aria-label="Tirar arquivo"
            >
              <X size={14} />
            </button>
          </span>
        ) : (
          <span className="text-[11px] text-slate-400">PDF ou foto, até 15 MB</span>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept={EQUIPMENT_DOC_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (!f) return;
          const problem = checkEquipmentDocFile(f);
          setError(problem);
          onChange(problem ? null : f);
          if (problem) e.target.value = '';
        }}
      />
      {error ? <p className="text-[11px] font-semibold text-red-600">{error}</p> : null}
      {hint && !error ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export type PossessionOption = { item_id: string; description: string };

/**
 * Janela de documentos de um colaborador (todos os itens) ou de um item que está com ele.
 * Todos do workspace veem e baixam; só quem edita anexa e apaga.
 */
export function EquipmentDocsModal({
  employeeId,
  employeeName,
  itemId,
  itemLabel,
  possessionItems,
  onClose,
  onChanged,
}: {
  employeeId: string;
  employeeName: string;
  itemId?: string | null;
  itemLabel?: string | null;
  possessionItems?: PossessionOption[];
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { currentWorkspace, readOnly } = useWorkspace();
  const [docs, setDocs] = useState<EquipmentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadItem, setUploadItem] = useState<string>(itemId ?? possessionItems?.[0]?.item_id ?? '');
  const [kind, setKind] = useState<EquipmentDocKind>('entrega');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    let q = supabase
      .from('equipment_documents')
      .select(EQUIPMENT_DOC_COLUMNS)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });
    if (itemId) q = q.eq('item_id', itemId);
    const { data, error: qErr } = await q;
    if (qErr) setError(/equipment_documents/i.test(qErr.message) ? 'Os documentos ainda não foram ativados no banco (etapa 8).' : qErr.message);
    else {
      setError(null);
      setDocs((data ?? []) as unknown as EquipmentDoc[]);
    }
    setLoading(false);
  }, [employeeId, itemId]);

  useEffect(() => {
    // Carregamento inicial dos dados do servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Sem cautela anexada: gera o termo da última entrega deste item para assinar. */
  const hasEntregaDoc = docs.some((d) => d.kind === 'entrega');
  const printTermo = async () => {
    if (!itemId) return;
    const { data, error: mErr } = await supabase
      .from('movements')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('item_id', itemId)
      .eq('type', 'OUT')
      .order('created_at', { ascending: false })
      .limit(1);
    const id = (data as { id: string }[] | null)?.[0]?.id;
    if (mErr || !id) {
      setError(mErr?.message || 'Não achei a entrega deste item para gerar o termo.');
      return;
    }
    void openPrintable(`Termo - ${employeeName}`, () => buildReceiptHtml(supabase, { movementId: id }, loadCompanyInfo()));
  };

  const itemOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of possessionItems ?? []) map.set(p.item_id, p.description);
    // Itens que já têm documento (ex.: já devolvidos) também aparecem para anexar mais.
    for (const d of docs) if (!map.has(d.item_id)) map.set(d.item_id, equipmentDocItemLabel(d));
    return Array.from(map, ([id, description]) => ({ id, description }));
  }, [possessionItems, docs]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const target = itemId ?? uploadItem;
    if (!target) {
      setError('Escolha o item do documento.');
      return;
    }
    if (!file) {
      setError('Escolha o arquivo.');
      return;
    }
    if (!currentWorkspace) return;
    setSaving(true);
    setError(null);
    const res = await uploadEquipmentDoc(supabase, {
      workspaceId: currentWorkspace.id,
      file,
      itemId: target,
      employeeId,
      kind,
      note,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setFile(null);
    setNote('');
    await load();
    onChanged?.();
  };

  return (
    <div className="fixed inset-0 bg-primary/40 z-[90] flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div role="dialog" aria-modal="true" aria-label="Documentos" className="bg-white border-t-[3px] border-t-secondary shadow-2xl w-full max-w-2xl my-4">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-primary flex items-center gap-2">
              <Paperclip size={18} className="text-secondary" />
              Documentos
            </h2>
            <p className="text-xs text-slate-500 truncate">
              {employeeName}
              {itemLabel ? ` · ${itemLabel}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-slate-200" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error ? <div className="text-sm font-semibold text-red-700 bg-red-50 border border-red-200 p-3">{error}</div> : null}

          {itemId && !loading && !hasEntregaDoc ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <span>Sem cautela assinada anexada. Imprima o termo, colha a assinatura e anexe abaixo.</span>
              <button
                type="button"
                onClick={() => void printTermo()}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white font-bold text-xs rounded"
              >
                <Printer size={14} />
                Imprimir termo
              </button>
            </div>
          ) : null}

          {loading ? (
            <div className="py-8 flex justify-center text-slate-400">
              <Loader2 className="animate-spin" size={24} />
            </div>
          ) : docs.length === 0 ? (
            <p className="text-sm text-slate-500 py-2">
              Nenhum documento anexado{itemLabel ? ' a este item' : ''} ainda.
              {!readOnly ? ' Anexe o termo assinado abaixo.' : ''}
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 border-y border-slate-200">
              {docs.map((d) => (
                <EquipmentDocRow
                  key={d.id}
                  doc={d}
                  showItem={!itemId}
                  canDelete={!readOnly}
                  onDeleted={() => {
                    void load();
                    onChanged?.();
                  }}
                />
              ))}
            </ul>
          )}

          {!readOnly ? (
            <form onSubmit={submit} className="border border-slate-200 bg-slate-50 p-4 space-y-3">
              <p className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1.5">
                <Upload size={14} />
                Anexar documento
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {!itemId ? (
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-semibold text-slate-600 block">Item</span>
                    <select
                      value={uploadItem}
                      onChange={(e) => setUploadItem(e.target.value)}
                      className="w-full px-3 py-2 text-sm"
                    >
                      {itemOptions.length === 0 ? <option value="">Nenhum item com este colaborador</option> : null}
                      {itemOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.description}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-slate-600 block">Tipo</span>
                  <select value={kind} onChange={(e) => setKind(e.target.value as EquipmentDocKind)} className="w-full px-3 py-2 text-sm">
                    {(Object.keys(EQUIPMENT_DOC_KIND_LABEL) as EquipmentDocKind[]).map((k) => (
                      <option key={k} value={k}>
                        {EQUIPMENT_DOC_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-slate-600 block">Observação (opcional)</span>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={300}
                    placeholder="Ex.: rádio nº série 12345"
                    className="w-full px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <DocFileField label="Arquivo" file={file} onChange={setFile} />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving || !file}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-secondary rounded hover:brightness-110 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  Anexar
                </button>
              </div>
            </form>
          ) : (
            <p className="text-[11px] text-slate-500">Acesso somente leitura: você pode abrir e baixar os documentos.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Contagem de documentos por colaborador e por colaborador+item, para mostrar nos botões. */
export function useEquipmentDocCounts(enabled = true) {
  const [counts, setCounts] = useState<{ byEmployee: Map<string, number>; byPair: Map<string, number> }>({
    byEmployee: new Map(),
    byPair: new Map(),
  });
  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('equipment_documents').select('employee_id, item_id').limit(10000);
    if (error || !data) return;
    const byEmployee = new Map<string, number>();
    const byPair = new Map<string, number>();
    for (const r of data as { employee_id: string | null; item_id: string }[]) {
      if (!r.employee_id) continue;
      byEmployee.set(r.employee_id, (byEmployee.get(r.employee_id) ?? 0) + 1);
      const k = `${r.employee_id}:${r.item_id}`;
      byPair.set(k, (byPair.get(k) ?? 0) + 1);
    }
    setCounts({ byEmployee, byPair });
  }, []);
  useEffect(() => {
    if (!enabled) return;
    // Carregamento inicial dos dados do servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [enabled, reload]);
  return { ...counts, reload };
}

/**
 * Anexar o termo assinado logo depois de registrar a entrega ou a devolução
 * (sem <form>, porque fica dentro do formulário da movimentação).
 */
export function MovementDocAttach({
  itemId,
  employeeId,
  movementId,
  kind,
}: {
  itemId: string;
  employeeId: string;
  movementId: string | null;
  kind: EquipmentDocKind;
}) {
  const { currentWorkspace, readOnly } = useWorkspace();
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (readOnly) return null;

  const send = async () => {
    if (!file || !currentWorkspace) return;
    setSaving(true);
    setError(null);
    const res = await uploadEquipmentDoc(supabase, {
      workspaceId: currentWorkspace.id,
      file,
      itemId,
      employeeId,
      movementId,
      kind,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setDone(res.doc.file_name);
    setFile(null);
  };

  return (
    <div className="text-left border border-slate-200 bg-slate-50 p-3 space-y-2">
      <p className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1.5">
        <Paperclip size={14} />
        {EQUIPMENT_DOC_KIND_LABEL[kind]} assinado (opcional)
      </p>
      {done ? (
        <p className="text-sm text-green-700 font-semibold">Anexado: {done}. Fica nos documentos do colaborador.</p>
      ) : (
        <>
          <DocFileField label="Arquivo" file={file} onChange={setFile} />
          {error ? <p className="text-[11px] font-semibold text-red-600">{error}</p> : null}
          <button
            type="button"
            disabled={!file || saving}
            onClick={() => void send()}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-secondary rounded hover:brightness-110 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Anexar
          </button>
        </>
      )}
    </div>
  );
}
