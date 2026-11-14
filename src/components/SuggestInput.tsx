'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

const STOPWORDS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'COM', 'PARA', 'P', 'C', 'EM']);

/** Palavras sem acento/caixa/pontuação e sem "de", "para"… ("Luva vaqueta" = "LUVA DE VAQUETA"). */
export function nameTokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Mesmas palavras, sem ligar para ordem, acento ou caixa. */
export const sameWords = (a: string, b: string) => [...nameTokens(a)].sort().join(' ') === [...nameTokens(b)].sort().join(' ');

/**
 * Campo de texto com sugestões do que já existe no cadastro (só dados internos).
 * Avisa quando o texto é o mesmo de um já cadastrado escrito de outro jeito.
 */
export function SuggestInput({
  label,
  value,
  onChange,
  options,
  required,
  placeholder,
  groupLabel = 'Já cadastrados',
  exactWarning,
  showAllOnFocus = false,
  className = 'space-y-1 col-span-2',
  labelClassName = 'text-xs font-bold uppercase text-slate-400',
  inputClassName = 'w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400',
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: string[];
  required?: boolean;
  placeholder?: string;
  groupLabel?: string;
  /** Mensagem quando o texto é igual a um já cadastrado (ex.: item repetido). Sem ela, não avisa. */
  exactWarning?: string;
  /** Mostra a lista inteira ao clicar no campo vazio (bom para listas curtas, como profissões). */
  showAllOnFocus?: boolean;
  className?: string;
  labelClassName?: string;
  inputClassName?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number } | null>(null);

  const index = useMemo(() => options.map((name) => ({ name, tokens: nameTokens(name) })), [options]);
  const queryTokens = useMemo(() => nameTokens(value), [value]);

  const matches = useMemo(() => {
    if (queryTokens.length === 0) return showAllOnFocus ? index.slice(0, 50).map((e) => e.name) : [];
    if (!showAllOnFocus && value.trim().length < 2) return [];
    return index
      .filter((e) => queryTokens.every((q) => e.tokens.some((t) => t.startsWith(q))))
      .slice(0, 12)
      .map((e) => e.name);
  }, [index, queryTokens, value, showAllOnFocus]);

  const sameAs = useMemo(() => {
    if (queryTokens.length === 0) return null;
    const key = [...queryTokens].sort().join(' ');
    const typed = value.trim().toUpperCase();
    const hit = index.find((e) => [...e.tokens].sort().join(' ') === key);
    return hit && hit.name.trim().toUpperCase() !== typed ? hit.name : null;
  }, [index, queryTokens, value]);

  const exactExists = useMemo(
    () => value.trim() !== '' && options.some((n) => n.trim().toUpperCase() === value.trim().toUpperCase()),
    [options, value]
  );

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

  const pick = (title: string) => {
    onChange(title);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = matches[highlight];
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
    <div className={className}>
      <label className={labelClassName}>{label}</label>
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
        className={inputClassName}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlight(0);
          setOpen(true);
          updateMenuPosition();
        }}
        onFocus={() => {
          setOpen(true);
          updateMenuPosition();
        }}
        onKeyDown={onKeyDown}
      />
      {exactWarning && exactExists ? (
        <p className="text-xs text-amber-800 font-bold">{exactWarning}</p>
      ) : sameAs ? (
        <p className="text-xs text-amber-800">
          Parece o mesmo que <span className="font-bold">{sameAs}</span>.{' '}
          <button type="button" className="font-bold text-secondary hover:underline" onClick={() => onChange(sameAs)}>
            Usar esse nome
          </button>
        </p>
      ) : null}

      {open && matches.length > 0 && menuStyle && !(matches.length === 1 && matches[0] === value) ? (
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          className="fixed z-[100] max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl"
          style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width }}
        >
          <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-slate-400">{groupLabel}</div>
          {matches.map((title, idx) => (
            <button
              key={title}
              type="button"
              role="option"
              aria-selected={idx === highlight}
              className={`block w-full px-3 py-2 text-left text-sm font-bold text-primary border-b border-slate-100 last:border-0 hover:bg-teal-50/70 ${
                idx === highlight ? 'bg-teal-50' : ''
              }`}
              onMouseEnter={() => setHighlight(idx)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(title)}
            >
              {title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
