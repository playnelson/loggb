'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Building2, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { logoFileToDataUrl } from '@/lib/logoImage';
import { WORKSPACE_KINDS, type WorkspaceKind } from '@/lib/workspace';

/** Logo da organização, ou um ícone quando ela não tem logo. */
export function OrgLogo({ src, name, size = 32 }: { src: string | null | undefined; name: string; size?: number }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data URL guardada no banco
      <img
        src={src}
        alt={`Logo de ${name}`}
        width={size}
        height={size}
        className="rounded-lg object-contain bg-white border border-slate-200 shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-lg bg-slate-100 border border-slate-300 text-slate-500 flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Building2 size={Math.round(size * 0.55)} />
    </span>
  );
}

/** Escolher, trocar ou remover a logo. Devolve o data URL já reduzido. */
export function LogoPicker({
  value,
  name,
  onChange,
}: {
  value: string | null;
  name: string;
  onChange: (dataUrl: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await logoFileToDataUrl(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar a imagem.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <OrgLogo src={value} name={name || 'organização'} size={64} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-primary border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            {value ? 'Trocar logo' : 'Enviar logo'}
          </button>
          {value ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-red-600 border border-red-100 rounded-lg hover:bg-red-50"
            >
              <Trash2 size={14} />
              Remover
            </button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <p className="text-[11px] text-slate-400 mt-2">PNG, JPG, WEBP ou SVG. A imagem é reduzida automaticamente.</p>
      {error ? <p className="text-xs font-bold text-red-600 mt-1">{error}</p> : null}
    </div>
  );
}

const inputClass = 'mt-1 w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-secondary';
const labelClass = 'text-xs font-bold uppercase text-slate-400';

/**
 * Cria uma organização (nome + logo) já com o primeiro workspace.
 * Quem cria vira ADM e entra no workspace novo.
 */
export function OrganizationSetupForm({
  onCreated,
  onCancel,
}: {
  onCreated: (workspaceId: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [wsName, setWsName] = useState('');
  const [wsKind, setWsKind] = useState<WorkspaceKind>('canteiro');
  const [wsCity, setWsCity] = useState('');
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
    const { data, error: rpcError } = await supabase.rpc('create_organization', {
      p_name: name.trim(),
      p_logo_data: logo,
      p_workspace_name: wsName.trim() || null,
      p_workspace_kind: wsKind,
      p_workspace_city: wsCity.trim() || null,
    });
    if (rpcError || !data) {
      setError(rpcError?.message || 'Não foi possível criar a organização.');
      setSaving(false);
      return;
    }
    onCreated(String(data));
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error ? <div className="text-sm font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">{error}</div> : null}

      <fieldset className="space-y-4">
        <legend className="text-sm font-bold text-primary mb-2">Organização</legend>
        <div>
          <label className={labelClass} htmlFor="org-name">Nome da empresa ou organização</label>
          <input
            id="org-name"
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Construtora Exemplo Ltda"
            maxLength={120}
            required
            autoFocus
          />
        </div>
        <div>
          <span className={labelClass}>Logo (opcional)</span>
          <div className="mt-2">
            <LogoPicker value={logo} name={name} onChange={setLogo} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4 border-t border-slate-100 pt-5">
        <legend className="text-sm font-bold text-primary mb-2">Primeiro workspace</legend>
        <p className="text-xs text-slate-500 -mt-1">
          Um workspace é um canteiro, cidade ou sede, com estoque, equipe e histórico próprios. Depois você pode criar outros.
        </p>
        <div>
          <label className={labelClass} htmlFor="ws-name">Nome</label>
          <input
            id="ws-name"
            className={inputClass}
            value={wsName}
            onChange={(e) => setWsName(e.target.value)}
            placeholder="Ex.: Obra 234 – Montes Claros"
            maxLength={120}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="ws-kind">Tipo</label>
            <select
              id="ws-kind"
              className={`${inputClass} font-medium`}
              value={wsKind}
              onChange={(e) => setWsKind(e.target.value as WorkspaceKind)}
            >
              {WORKSPACE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="ws-city">Cidade / UF</label>
            <input
              id="ws-city"
              className={inputClass}
              value={wsCity}
              onChange={(e) => setWsCity(e.target.value)}
              placeholder="Ex.: Montes Claros/MG"
              maxLength={120}
            />
          </div>
        </div>
      </fieldset>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-lg font-bold text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
        ) : null}
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 bg-secondary text-white px-5 py-2.5 rounded-lg font-bold hover:opacity-95 disabled:opacity-60"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Building2 size={18} />}
          Criar organização
        </button>
      </div>
    </form>
  );
}
