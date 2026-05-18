import { stripDiacritics } from '@/lib/productDisplayText';

const LOCALE = 'pt-BR';

export function normalizeEmployeeNameForSave(raw: string): string {
  const cleaned = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  return cleaned.toLocaleUpperCase(LOCALE);
}

export function formatEmployeeName(raw: string | null | undefined): string {
  if (raw == null) return '';
  return normalizeEmployeeNameForSave(String(raw));
}

export function normalizeSearchText(raw: string): string {
  return stripDiacritics(String(raw ?? '')).toLocaleLowerCase(LOCALE).trim();
}
