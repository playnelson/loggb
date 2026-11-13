/**
 * Internal stable code for DB; derived from description — not shown in the UI.
 * Item único com TAG: a TAG entra no código, para várias unidades com a mesma
 * descrição (ex.: Rádio RAD-001, RAD-002) não colidirem.
 */
export function itemCodeFromDescription(description: string, tag?: string | null): string {
  const trimmed = description.trim();
  if (!trimmed) return `REF-${Date.now()}`;
  const base = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '-').slice(0, 10) || 'ITEM';
  const tagKey = (tag ?? '').trim().toUpperCase();
  const source = tagKey ? `${trimmed}|${tagKey}` : trimmed;

  // Deterministic hash to avoid collisions (e.g., similar prefixes).
  let hash = 2166136261; // FNV-1a 32-bit offset basis
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36).toUpperCase().slice(0, 5);

  return `REF-${base}-${suffix}`;
}
