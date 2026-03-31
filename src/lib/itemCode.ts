/** Internal stable code for DB; always derived from description — not shown in the UI. */
export function itemCodeFromDescription(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return `REF-${Date.now()}`;
  const base = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '-').slice(0, 10) || 'ITEM';

  // Deterministic hash to avoid collisions (e.g., similar prefixes).
  let hash = 2166136261; // FNV-1a 32-bit offset basis
  for (let i = 0; i < trimmed.length; i++) {
    hash ^= trimmed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36).toUpperCase().slice(0, 5);

  return `REF-${base}-${suffix}`;
}
