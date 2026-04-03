export type WorkSiteKind = 'canteiro' | 'sede';

export type WorkSiteRow = {
  id: string;
  user_id: string;
  name: string;
  kind: WorkSiteKind;
  responsible_employee_id: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export function isWorkSiteKind(v: string): v is WorkSiteKind {
  return v === 'canteiro' || v === 'sede';
}
