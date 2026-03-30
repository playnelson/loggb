/** Internal stable code for DB; always derived from description — not shown in the UI. */
export function itemCodeFromDescription(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return `REF-${Date.now()}`;
  const base = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '-').slice(0, 10);
  return `REF-${base || 'ITEM'}`;
}
