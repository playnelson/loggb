'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, ClipboardPaste, ImageIcon, Search, X, type LucideIcon } from 'lucide-react';

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
  const img = <img src={src} alt="" style={box} className="rounded-lg object-cover border border-border shrink-0 max-w-none" />;
  if (file) return img;
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Abrir foto" className="shrink-0" onClick={(e) => e.stopPropagation()}>
      {img}
    </a>
  );
}

/** Primeira imagem de uma lista de arquivos (colar ou arrastar). */
function imageFrom(files: FileList | File[] | null | undefined): File | null {
  for (const f of Array.from(files ?? [])) if (f.type.startsWith('image/')) return f;
  return null;
}

/**
 * Campo de foto do cadastro: mostra a atual, deixa tirar/escolher outra, colar (Ctrl+V),
 * arrastar uma imagem ou remover. Com `searchQuery`, mostra o botão que abre o Google Imagens.
 */
export function PhotoField({
  currentUrl,
  file,
  onPick,
  onRemove,
  icon,
  searchQuery,
}: {
  /** Foto já salva (link temporário), se houver e não tiver sido removida. */
  currentUrl?: string;
  file: File | null;
  onPick: (f: File) => void;
  onRemove: () => void;
  icon?: LucideIcon;
  /** Nome do item, para buscar a foto no Google Imagens. */
  searchQuery?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [dragging, setDragging] = useState(false);
  const has = !!file || !!currentUrl;
  const btn =
    'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50';

  // Ctrl+V em qualquer lugar do formulário: se houver uma imagem copiada, vira a foto do item.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const img = imageFrom(e.clipboardData?.files);
      if (!img) return;
      e.preventDefault();
      setMsg('');
      onPick(img);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onPick]);

  // Botão "Colar foto" (celular ou quem não usa teclado): lê a imagem copiada.
  const pasteFromClipboard = async () => {
    setMsg('');
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const blob = await it.getType(type);
        onPick(new File([blob], `foto.${type.split('/')[1] || 'png'}`, { type }));
        return;
      }
      setMsg('Não há imagem copiada. No Google, clique com o botão direito na foto e escolha “Copiar imagem”.');
    } catch {
      setMsg('O navegador não deixou ler a imagem copiada. Use Ctrl+V aqui no formulário.');
    }
  };

  const query = searchQuery?.trim();

  return (
    <div className="space-y-2">
      <div
        className={`flex flex-wrap items-center gap-2 sm:gap-3 rounded-lg ${dragging ? 'ring-2 ring-secondary ring-offset-2' : ''}`}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.items).some((i) => i.type.startsWith('image/'))) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          setDragging(false);
          const img = imageFrom(e.dataTransfer.files);
          if (!img) return;
          e.preventDefault();
          onPick(img);
        }}
      >
      <PhotoThumb url={file ? undefined : currentUrl} file={file} size={64} icon={icon} />
      <button type="button" className={btn} onClick={() => ref.current?.click()}>
        <Camera size={14} /> {has ? 'Trocar foto' : 'Tirar ou escolher foto'}
      </button>
      {query ? (
        <a
          className={btn}
          href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`}
          target="_blank"
          rel="noreferrer"
          title="Abre o Google Imagens com o nome do item"
        >
          <Search size={14} /> Buscar foto no Google
        </a>
      ) : null}
      <button type="button" className={btn} onClick={() => void pasteFromClipboard()} title="Cola a imagem copiada">
        <ClipboardPaste size={14} /> Colar foto
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
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onPick(f);
        }}
      />
      </div>
      {msg ? (
        <p className="text-xs text-amber-800 font-medium">{msg}</p>
      ) : query ? (
        <p className="text-[11px] text-slate-500">
          No Google, clique com o botão direito na foto, escolha <b>Copiar imagem</b> e volte aqui: aperte <b>Ctrl+V</b> ou
          “Colar foto”. Também dá para arrastar a imagem para cá.
        </p>
      ) : null}
    </div>
  );
}
