'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import { fetchMlSearchSuggestions, formatMlPrice, type MlSearchHit } from '@/lib/mlSearchClient';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function MlProductAutocomplete({
  label,
  value,
  onChange,
  required,
  placeholder = 'Digite para buscar no Mercado Livre…',
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MlSearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number } | null>(null);

  const debouncedQuery = useDebounced(value.trim(), 380);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (inputRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const updateMenuPosition = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuStyle({ top: r.bottom + 6, left: r.left, width: r.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onWin = () => updateMenuPosition();
    window.addEventListener('scroll', onWin, true);
    window.addEventListener('resize', onWin);
    return () => {
      window.removeEventListener('scroll', onWin, true);
      window.removeEventListener('resize', onWin);
    };
  }, [open, updateMenuPosition, value]);

  useEffect(() => {
    let cancelled = false;
    const q = debouncedQuery;

    if (q.length < 3) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    void (async () => {
      const res = await fetchMlSearchSuggestions(q);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setResults([]);
        setError(res.error ?? 'Erro na busca.');
        return;
      }
      setResults(res.results);
      setHighlight(0);
      if (res.results.length > 0) {
        setOpen(true);
        updateMenuPosition();
      } else {
        setOpen(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, updateMenuPosition]);

  const pick = useCallback(
    (hit: MlSearchHit) => {
      onChange(hit.title);
      setOpen(false);
      setResults([]);
      setError(null);
      inputRef.current?.blur();
    },
    [onChange]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = results[highlight];
      if (hit) {
        e.preventDefault();
        pick(hit);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="space-y-1 col-span-2">
      <label className="text-xs font-bold uppercase text-slate-400">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          required={required}
          type="text"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          placeholder={placeholder}
          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (e.target.value.trim().length >= 3) setOpen(true);
          }}
          onFocus={() => {
            if (results.length > 0) {
              setOpen(true);
              updateMenuPosition();
            }
          }}
          onKeyDown={onKeyDown}
        />
        {loading && (
          <Loader2
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-amber-600 pointer-events-none"
            size={18}
          />
        )}
      </div>
      <p className="text-[10px] text-slate-400 leading-relaxed">
        Sugestões em tempo real via API pública do Mercado Livre (Brasil). Selecione um anúncio para preencher a descrição
        com o título oficial do catálogo.
      </p>
      {error && <p className="text-xs text-amber-700 font-bold">{error}</p>}

      {open && results.length > 0 && menuStyle && (
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          className="fixed z-[100] max-h-72 overflow-y-auto rounded-xl border border-amber-200/80 bg-white shadow-2xl shadow-amber-900/10"
          style={{
            top: menuStyle.top,
            left: menuStyle.left,
            width: menuStyle.width,
          }}
        >
          {results.map((hit, idx) => (
            <button
              key={hit.id}
              type="button"
              role="option"
              aria-selected={idx === highlight}
              className={`flex w-full gap-3 p-3 text-left border-b border-slate-100 last:border-0 hover:bg-amber-50/80 ${
                idx === highlight ? 'bg-amber-50' : ''
              }`}
              onMouseEnter={() => setHighlight(idx)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(hit)}
            >
              {hit.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={hit.thumbnail}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-lg object-cover bg-slate-100"
                  width={56}
                  height={56}
                />
              ) : (
                <div className="h-14 w-14 shrink-0 rounded-lg bg-slate-100" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-primary leading-snug line-clamp-2">{hit.title}</p>
                {hit.subtitle ? (
                  <p className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">{hit.subtitle}</p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                  {hit.price != null && (
                    <span className="font-black text-amber-800">
                      {formatMlPrice(hit.price, hit.currency_id)}
                    </span>
                  )}
                  {hit.condition && <span className="uppercase">{hit.condition}</span>}
                  {hit.seller_nickname && <span>• {hit.seller_nickname}</span>}
                </div>
                {hit.permalink && (
                  <a
                    href={hit.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-bold text-secondary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Ver no ML <ExternalLink size={10} />
                  </a>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
