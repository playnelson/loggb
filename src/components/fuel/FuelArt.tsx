/* Ilustrações do nível: tanque da obra e caminhão melosa. pct = null quando não há capacidade cadastrada. */

const LIQ = '#f59e0b';
const LIQ_LOW = '#ef4444';
const LINE = '#94a3b8';
const DARK = '#64748b';

export function TankArt({ pct, id }: { pct: number | null; id: string }) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const top = 16 + 68 * (1 - p / 100);
  const color = p < 15 ? LIQ_LOW : LIQ;
  return (
    <svg viewBox="0 0 200 110" className="w-full h-auto" aria-hidden="true">
      <clipPath id={`tk-${id}`}>
        <rect x="21" y="16" width="158" height="68" rx="34" />
      </clipPath>
      <rect x="21" y="16" width="158" height="68" rx="34" fill="#f8fafc" />
      {pct != null && p > 0 ? (
        <g clipPath={`url(#tk-${id})`}>
          <rect x="0" y={top} width="200" height="100" fill={color} opacity="0.85" />
          <line x1="0" y1={top} x2="200" y2={top} stroke={color} strokeWidth="2" />
        </g>
      ) : null}
      <rect x="20" y="15" width="160" height="70" rx="35" fill="none" stroke={LINE} strokeWidth="2.5" />
      <line x1="60" y1="15" x2="60" y2="85" stroke={LINE} strokeWidth="1" opacity="0.6" />
      <line x1="140" y1="15" x2="140" y2="85" stroke={LINE} strokeWidth="1" opacity="0.6" />
      <rect x="92" y="5" width="16" height="11" rx="2" fill={DARK} />
      <rect x="45" y="85" width="10" height="17" fill={DARK} />
      <rect x="145" y="85" width="10" height="17" fill={DARK} />
      <rect x="36" y="100" width="128" height="4" rx="2" fill={LINE} />
    </svg>
  );
}

export function TruckArt({ pct, id }: { pct: number | null; id: string }) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const top = 31 + 48 * (1 - p / 100);
  const color = p < 15 ? LIQ_LOW : LIQ;
  return (
    <svg viewBox="0 0 200 110" className="w-full h-auto" aria-hidden="true">
      <clipPath id={`tr-${id}`}>
        <rect x="11" y="31" width="118" height="48" rx="21" />
      </clipPath>
      <rect x="11" y="31" width="118" height="48" rx="21" fill="#f8fafc" />
      {pct != null && p > 0 ? (
        <g clipPath={`url(#tr-${id})`}>
          <rect x="0" y={top} width="140" height="80" fill={color} opacity="0.85" />
          <line x1="0" y1={top} x2="140" y2={top} stroke={color} strokeWidth="2" />
        </g>
      ) : null}
      <rect x="10" y="30" width="120" height="50" rx="22" fill="none" stroke={LINE} strokeWidth="2.5" />
      <rect x="62" y="23" width="14" height="8" rx="2" fill={DARK} />
      <path d="M136 80 V42 H164 L184 62 V80 Z" fill="#e2e8f0" stroke={DARK} strokeWidth="2" strokeLinejoin="round" />
      <path d="M145 48 H162 L175 61 H145 Z" fill="#bae6fd" stroke={DARK} strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="4" y="80" width="186" height="6" rx="2" fill={DARK} />
      {[35, 100, 165].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="92" r="11" fill="#334155" />
          <circle cx={cx} cy="92" r="4" fill="#cbd5e1" />
        </g>
      ))}
    </svg>
  );
}
