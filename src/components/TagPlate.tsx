/** Plaquinha dourada para a TAG (ou o tamanho) do item, igual em todo o site. */
export function TagPlate({
  children,
  size = 'sm',
  className = '',
  title,
}: {
  children: React.ReactNode;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  title?: string;
}) {
  const pad = size === 'xs' ? 'px-1.5 py-[1px] text-[9px] gap-1' : size === 'md' ? 'px-3 py-1 text-sm gap-2' : 'px-2 py-0.5 text-[11px] gap-1.5';
  const dot = size === 'md' ? 'w-1.5 h-1.5' : 'w-1 h-1';
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-[4px] border border-amber-600/70 font-mono font-extrabold uppercase tracking-wider text-amber-950 whitespace-nowrap align-middle ${pad} ${className}`}
      style={{
        background: 'linear-gradient(135deg, #fff3b0 0%, #f6d365 35%, #e0ac2b 65%, #f8e08e 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 1.5px rgba(120,80,0,0.35)',
        textShadow: '0 1px 0 rgba(255,255,255,0.45)',
      }}
    >
      <span className={`${dot} rounded-full bg-amber-800/60 shrink-0`} aria-hidden />
      {children}
      <span className={`${dot} rounded-full bg-amber-800/60 shrink-0`} aria-hidden />
    </span>
  );
}
