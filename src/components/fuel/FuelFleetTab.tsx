'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Camera, Download, MapPin, Pencil, Plus, Search, Trash2, Truck, Upload, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  FUEL_PHOTOS_BUCKET,
  FUEL_TYPES,
  KIND_LABEL,
  METER_LABEL,
  isStorage,
  mapsUrl,
  uploadVehiclePhoto,
  downloadFleetTemplate,
  parseFleetFile,
  parseNumBr,
  VEHICLE_COLS,
  type FleetImportRow,
  type FuelSource,
  type FuelVehicle,
  type MeterType,
  type SourceKind,
} from '@/lib/fuel';
import { Field, Modal, ModalActions, btnGhost, btnPrimary, dbError, inputCls, thCls, type FuelData } from './FuelUi';

const emptyVehicle = () => ({
  code: '',
  description: '',
  plate: '',
  brand: '',
  group_name: '',
  meter_type: 'km' as MeterType,
  fuel_type: '',
  active: true,
});

const up = (s: string) => s.trim().toUpperCase() || null;

export default function FuelFleetTab({ data }: { data: FuelData }) {
  const { vehicles, sources, photos, workspaceId, reload } = data;
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<FuelVehicle | 'new' | null>(null);
  const [form, setForm] = useState(emptyVehicle());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<{ rows: FleetImportRow[]; skipped: number } | null>(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const t = q.trim().toUpperCase();
    return vehicles.filter(
      (v) =>
        (showInactive || v.active) &&
        (!t || [v.code, v.description, v.plate, v.brand, v.group_name].some((x) => String(x ?? '').toUpperCase().includes(t)))
    );
  }, [vehicles, q, showInactive]);

  const openVehicle = (v: FuelVehicle | 'new') => {
    setError('');
    setPhotoFile(null);
    setDropPhoto(false);
    setEditing(v);
    setForm(
      v === 'new'
        ? emptyVehicle()
        : {
            code: v.code ?? '',
            description: v.description,
            plate: v.plate ?? '',
            brand: v.brand ?? '',
            group_name: v.group_name ?? '',
            meter_type: v.meter_type,
            fuel_type: v.fuel_type ?? '',
            active: v.active,
          }
    );
  };

  const saveVehicle = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const row = {
      code: form.code.trim() || null,
      description: form.description.trim().toUpperCase(),
      plate: up(form.plate),
      brand: up(form.brand),
      group_name: up(form.group_name),
      meter_type: form.meter_type,
      fuel_type: up(form.fuel_type),
      active: form.active,
    };
    const res =
      editing === 'new'
        ? await supabase.from('fuel_vehicles').insert(row).select(VEHICLE_COLS).single()
        : await supabase.from('fuel_vehicles').update(row).eq('id', (editing as FuelVehicle).id).select(VEHICLE_COLS).single();
    if (res.error) {
      setSaving(false);
      return setError(dbError(res.error));
    }
    const saved = res.data as FuelVehicle;
    if (photoFile || dropPhoto) {
      let newPath: string | null = null;
      if (photoFile) {
        const upl = await uploadVehiclePhoto(supabase, workspaceId, saved.id, photoFile);
        if ('error' in upl) {
          // O cadastro ficou salvo; continua no formulário (já como edição) para tentar a foto de novo.
          setSaving(false);
          setEditing(saved);
          await reload();
          return setError(`${upl.error} O cadastro foi salvo sem a foto nova.`);
        }
        newPath = upl.path;
      }
      const { error: pe } = await supabase.from('fuel_vehicles').update({ photo_path: newPath }).eq('id', saved.id);
      if (pe) {
        if (newPath) await supabase.storage.from(FUEL_PHOTOS_BUCKET).remove([newPath]);
        setSaving(false);
        return setError(dbError(pe));
      }
      if (saved.photo_path) await supabase.storage.from(FUEL_PHOTOS_BUCKET).remove([saved.photo_path]);
    }
    setSaving(false);
    setEditing(null);
    await reload();
  };

  const removeVehicle = async (v: FuelVehicle) => {
    if (!confirm(`Excluir ${v.description}?`)) return;
    const { error: err } = await supabase.from('fuel_vehicles').delete().eq('id', v.id);
    if (err) return alert(dbError(err));
    if (v.photo_path) await supabase.storage.from(FUEL_PHOTOS_BUCKET).remove([v.photo_path]);
    await reload();
  };

  const onFile = async (f: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    const r = await parseFleetFile(f);
    if ('error' in r) return alert(r.error);
    if (r.rows.length === 0) return alert('Nenhuma linha com DESCRIÇÃO na planilha.');
    setImportRows(r);
  };

  const byCode = useMemo(() => {
    const m = new Map<string, FuelVehicle>();
    for (const v of vehicles) if (v.code?.trim()) m.set(v.code.trim().toUpperCase(), v);
    return m;
  }, [vehicles]);

  const runImport = async () => {
    if (!importRows) return;
    setSaving(true);
    const inserts: FleetImportRow[] = [];
    let updated = 0;
    const seen = new Set<string>();
    for (const r of importRows.rows) {
      const key = r.code?.trim().toUpperCase();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      const ex = key ? byCode.get(key) : undefined;
      if (ex) {
        const { error: err } = await supabase.from('fuel_vehicles').update(r).eq('id', ex.id);
        if (err) {
          setSaving(false);
          return alert(dbError(err));
        }
        updated++;
      } else inserts.push(r);
    }
    if (inserts.length) {
      const { error: err } = await supabase.from('fuel_vehicles').insert(inserts);
      if (err) {
        setSaving(false);
        return alert(dbError(err));
      }
    }
    setSaving(false);
    setImportRows(null);
    setMsg(`Importação concluída: ${inserts.length} novo(s), ${updated} atualizado(s).`);
    await reload();
  };

  // Foto que já está salva (some da tela se a pessoa mandou remover ou escolheu outra).
  const currentPhoto = editing && editing !== 'new' && !dropPhoto && !photoFile ? editing.photo_path : null;

  const importPreview = importRows
    ? importRows.rows.reduce(
        (a, r) => (r.code && byCode.has(r.code.trim().toUpperCase()) ? { ...a, upd: a.upd + 1 } : { ...a, add: a.add + 1 }),
        { add: 0, upd: 0 }
      )
    : null;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold text-primary mr-auto">Frota ({vehicles.filter((v) => v.active).length} ativos)</h2>
          <button type="button" className={btnGhost} onClick={downloadFleetTemplate}>
            <Download size={14} /> Planilha modelo
          </button>
          <button type="button" className={btnGhost} onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Importar planilha
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" className={btnPrimary} onClick={() => openVehicle('new')}>
            <Plus size={16} /> Novo equipamento
          </button>
        </div>
        {msg ? <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">{msg}</div> : null}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none"
              placeholder="Buscar por código, descrição, placa, grupo…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Mostrar inativos
          </label>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-x-auto">
          {list.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm">
              Nenhum equipamento. Baixe a planilha modelo, preencha e importe — ou cadastre um a um.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-border">
                <tr>
                  <th className={thCls} />
                  <th className={thCls}>Código</th>
                  <th className={thCls}>Descrição</th>
                  <th className={thCls}>Placa / patrimônio</th>
                  <th className={thCls}>Grupo</th>
                  <th className={thCls}>Controle</th>
                  <th className={thCls}>Combustível</th>
                  <th className={`${thCls} text-right`}>Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((v) => (
                  <tr key={v.id} className={v.active ? '' : 'opacity-50'}>
                    <td className="pl-3 py-1.5 w-12">
                      <VehiclePhoto url={v.photo_path ? photos[v.photo_path] : undefined} size={40} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{v.code || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="font-bold text-primary">{v.description}</div>
                      {v.brand ? <div className="text-xs text-slate-500">{v.brand}</div> : null}
                    </td>
                    <td className="px-3 py-2">{v.plate || '—'}</td>
                    <td className="px-3 py-2 text-xs">{v.group_name || '—'}</td>
                    <td className="px-3 py-2 text-xs">{METER_LABEL[v.meter_type]}</td>
                    <td className="px-3 py-2 text-xs">{v.fuel_type || '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                      <button type="button" className={btnGhost} onClick={() => openVehicle(v)}>
                        <Pencil size={13} /> Editar
                      </button>
                      <button type="button" className={btnGhost} onClick={() => removeVehicle(v)} aria-label="Excluir">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <SourcesSection sources={sources} reload={reload} />

      {editing ? (
        <Modal title={editing === 'new' ? 'Novo equipamento' : 'Editar equipamento'} onClose={() => setEditing(null)}>
          <form onSubmit={saveVehicle} className="space-y-3">
            {error ? <div className="text-sm text-red-600 font-medium">{error}</div> : null}
            <div className="grid grid-cols-3 gap-3">
              <Field label="Código">
                <input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </Field>
              <div className="col-span-2">
                <Field label="Descrição">
                  <input
                    className={inputCls}
                    required
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Ex.: FIAT STRADA"
                  />
                </Field>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Placa / patrimônio">
                <input className={inputCls} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
              </Field>
              <Field label="Marca">
                <input className={inputCls} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
              </Field>
              <Field label="Grupo">
                <input
                  className={inputCls}
                  value={form.group_name}
                  onChange={(e) => setForm({ ...form, group_name: e.target.value })}
                  placeholder="Ex.: VEÍCULOS LEVES"
                />
              </Field>
              <Field label="Controle">
                <select
                  className={inputCls}
                  value={form.meter_type}
                  onChange={(e) => setForm({ ...form, meter_type: e.target.value as MeterType })}
                >
                  {(Object.keys(METER_LABEL) as MeterType[]).map((k) => (
                    <option key={k} value={k}>
                      {METER_LABEL[k]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Combustível padrão">
              <FuelTypeInput value={form.fuel_type} onChange={(v) => setForm({ ...form, fuel_type: v })} />
            </Field>
            <Field label="Foto">
              <div className="mt-1 flex items-center gap-3">
                <VehiclePhoto url={currentPhoto ? photos[currentPhoto] : undefined} file={photoFile} size={64} />
                <button type="button" className={btnGhost} onClick={() => photoRef.current?.click()}>
                  <Camera size={14} /> {photoFile || currentPhoto ? 'Trocar foto' : 'Tirar ou escolher foto'}
                </button>
                {photoFile || currentPhoto ? (
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => {
                      setPhotoFile(null);
                      setDropPhoto(true);
                    }}
                    aria-label="Remover a foto"
                  >
                    <X size={14} />
                  </button>
                ) : null}
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    setPhotoFile(f);
                    setDropPhoto(false);
                  }}
                />
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Ativo (aparece nas autorizações)
            </label>
            <ModalActions onCancel={() => setEditing(null)} saving={saving} />
          </form>
        </Modal>
      ) : null}

      {importRows && importPreview ? (
        <Modal title="Importar frota" onClose={() => setImportRows(null)} wide>
          <p className="text-sm text-slate-600 mb-3">
            <b>{importPreview.add}</b> novo(s) e <b>{importPreview.upd}</b> atualizado(s) pelo código.
            {importRows.skipped ? ` ${importRows.skipped} linha(s) sem descrição serão ignoradas.` : ''}
          </p>
          <div className="max-h-72 overflow-auto border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className={thCls}>Código</th>
                  <th className={thCls}>Descrição</th>
                  <th className={thCls}>Placa</th>
                  <th className={thCls}>Grupo</th>
                  <th className={thCls}>Controle</th>
                  <th className={thCls}>Combustível</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {importRows.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1">{r.code || '—'}</td>
                    <td className="px-3 py-1">{r.description}</td>
                    <td className="px-3 py-1">{r.plate || '—'}</td>
                    <td className="px-3 py-1">{r.group_name || '—'}</td>
                    <td className="px-3 py-1">{METER_LABEL[r.meter_type]}</td>
                    <td className="px-3 py-1">{r.fuel_type || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 pt-3">
            <button type="button" onClick={() => setImportRows(null)} className="flex-1 py-2.5 border rounded-xl font-bold text-slate-500">
              Cancelar
            </button>
            <button type="button" disabled={saving} onClick={runImport} className="flex-1 py-2.5 bg-primary text-white rounded-xl font-bold disabled:opacity-50">
              {saving ? 'Importando…' : 'Importar'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/** Miniatura da foto do veículo (ou um ícone quando não tem). Clicar abre a foto grande. */
export function VehiclePhoto({ url, file, size }: { url?: string; file?: File | null; size: number }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(u);
    return () => {
      URL.revokeObjectURL(u);
      setLocal(null);
    };
  }, [file]);
  const src = file ? local : url;
  const box = { width: size, height: size };
  if (!src) {
    return (
      <div style={box} className="rounded-lg bg-slate-100 text-slate-300 flex items-center justify-center shrink-0">
        <Truck size={Math.round(size / 2.4)} />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={src} alt="" style={box} className="rounded-lg object-cover border border-border shrink-0" />;
  if (file) return img;
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Abrir foto">
      {img}
    </a>
  );
}

export function FuelTypeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input className={inputCls} list="fuel-types" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Ex.: DIESEL S10" />
      <datalist id="fuel-types">
        {FUEL_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </>
  );
}

const emptySource = () => ({ name: '', kind: 'posto' as SourceKind, fuel_type: 'DIESEL S10', capacity: '', location: '', active: true });

function SourcesSection({ sources, reload }: { sources: FuelSource[]; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<FuelSource | 'new' | null>(null);
  const [form, setForm] = useState(emptySource());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const open = (s: FuelSource | 'new') => {
    setError('');
    setEditing(s);
    setForm(
      s === 'new'
        ? emptySource()
        : {
            name: s.name,
            kind: s.kind,
            fuel_type: s.fuel_type ?? '',
            capacity: s.capacity ? String(s.capacity) : '',
            location: s.location ?? '',
            active: s.active,
          }
    );
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const cap = parseNumBr(form.capacity) ?? 0;
    const row = {
      name: form.name.trim().toUpperCase(),
      kind: form.kind,
      fuel_type: isStorage(form.kind) ? up(form.fuel_type) : null,
      capacity: isStorage(form.kind) && cap > 0 ? cap : null,
      location: form.kind === 'posto' ? form.location.trim() || null : null,
      active: form.active,
    };
    const res =
      editing === 'new'
        ? await supabase.from('fuel_sources').insert(row)
        : await supabase.from('fuel_sources').update(row).eq('id', (editing as FuelSource).id);
    setSaving(false);
    if (res.error) return setError(dbError(res.error));
    setEditing(null);
    await reload();
  };

  const remove = async (s: FuelSource) => {
    if (!confirm(`Excluir ${s.name}?`)) return;
    const { error: err } = await supabase.from('fuel_sources').delete().eq('id', s.id);
    if (err) return alert(dbError(err));
    await reload();
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-bold text-primary mr-auto">Postos, tanques e melosas</h2>
        <button type="button" className={btnPrimary} onClick={() => open('new')}>
          <Plus size={16} /> Novo posto, tanque ou melosa
        </button>
      </div>
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-x-auto">
        {sources.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Cadastre o posto onde a obra abastece e, se tiver, o tanque próprio.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className={thCls}>Nome</th>
                <th className={thCls}>Tipo</th>
                <th className={thCls}>Combustível / local</th>
                <th className={`${thCls} text-right`}>Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sources.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'opacity-50'}>
                  <td className="px-3 py-2 font-bold text-primary">{s.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                        s.kind === 'tanque'
                          ? 'bg-amber-100 text-amber-800'
                          : s.kind === 'comboio'
                            ? 'bg-orange-100 text-orange-800'
                            : 'bg-sky-100 text-sky-800'
                      }`}
                    >
                      {KIND_LABEL[s.kind]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {isStorage(s.kind) ? (
                      `${s.fuel_type || '—'}${s.capacity ? ` · ${s.capacity.toLocaleString('pt-BR')} L` : ''}`
                    ) : mapsUrl(s.location) ? (
                      <a
                        href={mapsUrl(s.location)!}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-secondary font-bold hover:underline"
                      >
                        <MapPin size={13} /> Ver no mapa
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                    <button type="button" className={btnGhost} onClick={() => open(s)}>
                      <Pencil size={13} /> Editar
                    </button>
                    <button type="button" className={btnGhost} onClick={() => remove(s)} aria-label="Excluir">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing ? (
        <Modal title={editing === 'new' ? 'Novo posto, tanque ou melosa' : 'Editar'} onClose={() => setEditing(null)}>
          <form onSubmit={save} className="space-y-3">
            {error ? <div className="text-sm text-red-600 font-medium">{error}</div> : null}
            <Field label="Tipo">
              <select className={inputCls} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as SourceKind })}>
                <option value="posto">Posto (fornecedor)</option>
                <option value="tanque">Tanque próprio</option>
                <option value="comboio">Melosa (caminhão comboio)</option>
              </select>
            </Field>
            <Field label="Nome">
              <input
                className={inputCls}
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={form.kind === 'tanque' ? 'Ex.: TANQUE CANTEIRO' : form.kind === 'comboio' ? 'Ex.: MELOSA ABC1D23' : 'Ex.: POSTO ITAJAÓ'}
              />
            </Field>
            {form.kind === 'posto' ? (
              <Field label="Localização" hint="Endereço ou link do Google Maps. Vira o botão “Ver no mapa”.">
                <div className="flex gap-2">
                  <input
                    className={inputCls}
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    placeholder="Ex.: BR-381, km 450, Itajubá - MG"
                  />
                  {mapsUrl(form.location) ? (
                    <a
                      href={mapsUrl(form.location)!}
                      target="_blank"
                      rel="noreferrer"
                      className={`${btnGhost} mt-1 shrink-0`}
                      aria-label="Testar no mapa"
                    >
                      <MapPin size={14} />
                    </a>
                  ) : null}
                </div>
              </Field>
            ) : null}
            {isStorage(form.kind) ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Combustível">
                  <FuelTypeInput value={form.fuel_type} onChange={(v) => setForm({ ...form, fuel_type: v })} />
                </Field>
                <Field label="Capacidade (litros)">
                  <input className={inputCls} inputMode="decimal" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
                </Field>
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Ativo
            </label>
            <ModalActions onCancel={() => setEditing(null)} saving={saving} />
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
