'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, ImageIcon, X, type LucideIcon } from 'lucide-react';

/** Miniatura de uma foto (ou um ícone quando não tem). Clicar abre a foto grande. */
export function PhotoThumb({
  url,
  file,
  size,
  icon: Icon = ImageIcon,
}: {
  url?: string;
  file?: File | null;
  size: number;
  icon?: LucideIcon;
}) {
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
        <Icon size={Math.round(size / 2.4)} />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={src} alt="" style={box} className="rounded-lg object-cover border border-border shrink-0" />;
  if (file) return img;
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Abrir foto" onClick={(e) => e.stopPropagation()}>
      {img}
    </a>
  );
}

/** Campo de foto do cadastro: mostra a atual, deixa tirar/escolher outra ou remover. */
export function PhotoField({
  currentUrl,
  file,
  onPick,
  onRemove,
  icon,
}: {
  /** Foto já salva (link temporário), se houver e não tiver sido removida. */
  currentUrl?: string;
  file: File | null;
  onPick: (f: File) => void;
  onRemove: () => void;
  icon?: LucideIcon;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const has = !!file || !!currentUrl;
  const btn =
    'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50';
  return (
    <div className="flex items-center gap-3">
      <PhotoThumb url={file ? undefined : currentUrl} file={file} size={64} icon={icon} />
      <button type="button" className={btn} onClick={() => ref.current?.click()}>
        <Camera size={14} /> {has ? 'Trocar foto' : 'Tirar ou escolher foto'}
      </button>
      {has ? (
        <button type="button" className={btn} onClick={onRemove} aria-label="Remover a foto">
          <X size={14} />
        </button>
      ) : null}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onPick(f);
        }}
      />
    </div>
  );
}
