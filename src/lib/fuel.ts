import * as XLSXStyle from 'xlsx-js-style';
import * as XLSX from 'xlsx';
import type { SupabaseClient } from '@supabase/supabase-js';

/* Módulo de Abastecimentos: tipos, formatação e planilha modelo da frota. */

export type MeterType = 'km' | 'horas' | 'nenhum';
export type FuelStatus = 'autorizado' | 'faturado' | 'cancelado';
export type SourceKind = 'posto' | 'tanque' | 'comboio';

export type FuelVehicle = {
  id: string;
  code: string | null;
  description: string;
  plate: string | null;
  brand: string | null;
  group_name: string | null;
  meter_type: MeterType;
  fuel_type: string | null;
  photo_path: string | null;
  active: boolean;
};

export type FuelSource = {
  id: string;
  name: string;
  kind: SourceKind;
  fuel_type: string | null;
  capacity: number | null;
  location: string | null;
  active: boolean;
};

export type FuelLog = {
  id: string;
  control_no: number;
  log_date: string;
  source_id: string;
  vehicle_id: string;
  requester_employee_id: string | null;
  requester_name: string | null;
  authorized_by: string | null;
  fuel_type: string;
  meter_type: MeterType;
  meter_reading: number | null;
  liters: number | null;
  unit_price: number | null;
  total: number | null;
  status: FuelStatus;
  invoice: string | null;
  notes: string | null;
};

export type FuelTankEntry = {
  id: string;
  tank_id: string;
  /** Preenchido = transferência de outro tanque/melosa; vazio = compra. */
  from_source_id: string | null;
  entry_date: string;
  liters: number;
  unit_price: number | null;
  total: number | null;
  supplier: string | null;
  invoice: string | null;
  notes: string | null;
};

export type FuelTankCount = {
  id: string;
  tank_id: string;
  count_date: string;
  measured_liters: number;
  system_liters: number;
  adjust: boolean;
  notes: string | null;
};

export const KIND_LABEL: Record<SourceKind, string> = { posto: 'Posto', tanque: 'Tanque próprio', comboio: 'Melosa (comboio)' };

/** Tanque e melosa guardam saldo; posto não. */
export const isStorage = (k: SourceKind | undefined) => k === 'tanque' || k === 'comboio';

export const FUEL_TYPES = ['DIESEL S10', 'DIESEL S500', 'GASOLINA COMUM', 'GASOLINA ADITIVADA', 'ETANOL', 'ARLA 32'];

export const METER_LABEL: Record<MeterType, string> = {
  km: 'KM (quilômetros)',
  horas: 'Horas (horímetro)',
  nenhum: 'Sem controle',
};

export const METER_SHORT: Record<MeterType, string> = { km: 'km', horas: 'h', nenhum: '' };

export const VEHICLE_COLS =
  'id, code, description, plate, brand, group_name, meter_type, fuel_type, photo_path, active';
export const SOURCE_COLS = 'id, name, kind, fuel_type, capacity, location, active';
export const LOG_COLS =
  'id, control_no, log_date, source_id, vehicle_id, requester_employee_id, requester_name, authorized_by, fuel_type, meter_type, meter_reading, liters, unit_price, total, status, invoice, notes';
export const ENTRY_COLS = 'id, tank_id, from_source_id, entry_date, liters, unit_price, total, supplier, invoice, notes';

export function asMeterType(v: unknown): MeterType {
  const s = String(v ?? '').trim().toLowerCase();
  if (s.startsWith('h')) return 'horas';
  if (s.startsWith('n') || s.startsWith('s')) return 'nenhum';
  return 'km';
}

/** Lê número no formato brasileiro ("23.323,50") ou com ponto ("23323.5"). */
export function parseNumBr(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (!s) return null;
  // "23.323,50" ou "23.323" (ponto = milhar); "23.5" continua decimal.
  if (s.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** "2026-11-13" -> "13/11/2026" (sem mexer em fuso). */
export function fmtDay(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, dd] = d.slice(0, 10).split('-');
  return y && m && dd ? `${dd}/${m}/${y}` : d;
}

export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const COUNT_COLS = 'id, tank_id, count_date, measured_liters, system_liters, adjust, notes';

/** Link do mapa: usa o link colado ou procura o endereço no Google Maps. */
export function mapsUrl(location: string | null | undefined): string | null {
  const s = String(location ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s)}`;
}

/* ------------------------------------------------------------ fotos */

export const FUEL_PHOTOS_BUCKET = 'fuel-photos';

/** Diminui a foto do celular (máx. 1280 px, JPEG) antes de enviar. */
async function shrinkPhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error('decode'));
      i.src = url;
    });
    const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.82));
    if (!blob) throw new Error('encode');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Envia a foto do veículo e devolve o caminho salvo (ou a mensagem de erro). */
export async function uploadVehiclePhoto(
  client: SupabaseClient,
  workspaceId: string,
  vehicleId: string,
  file: File
): Promise<{ path: string } | { error: string }> {
  let blob: Blob;
  try {
    blob = await shrinkPhoto(file);
  } catch {
    return { error: 'Não consegui abrir essa foto. Use JPG ou PNG.' };
  }
  const path = `${workspaceId}/veiculos/${vehicleId}-${Date.now()}.jpg`;
  const up = await client.storage.from(FUEL_PHOTOS_BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (up.error) return { error: `Não consegui enviar a foto: ${up.error.message}` };
  return { path };
}

/** Links temporários (1 h) para mostrar as fotos. */
export async function photoUrls(client: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (paths.length === 0) return out;
  const { data } = await client.storage.from(FUEL_PHOTOS_BUCKET).createSignedUrls(paths, 3600);
  for (const r of data ?? []) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
  return out;
}

export function vehicleLabel(v: Pick<FuelVehicle, 'code' | 'description' | 'plate'> | null | undefined): string {
  if (!v) return '—';
  return [v.code, v.description, v.plate].filter((x) => x && String(x).trim()).join(' · ');
}

/* ------------------------------------------------------------ planilha da frota */

const FLEET_HEADERS = ['CÓDIGO', 'DESCRIÇÃO', 'PLACA / PATRIMÔNIO', 'MARCA', 'GRUPO', 'CONTROLE', 'COMBUSTÍVEL'];

export function downloadFleetTemplate(): void {
  const head = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
    fill: { patternType: 'solid', fgColor: { rgb: '0F766E' } },
    alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
  } as const;
  const ex = {
    font: { sz: 11, color: { rgb: '334155' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'F8FAFC' } },
  } as const;
  const examples = [
    ['2340001', 'ESCAVADEIRA HIDRÁULICA 320', 'PAT-0451', 'CATERPILLAR', 'ESCAVADEIRAS', 'HORAS', 'DIESEL S10'],
    ['2340002', 'FIAT STRADA', 'ABC1D23', 'FIAT', 'VEÍCULOS LEVES', 'KM', 'GASOLINA COMUM'],
    ['2340003', 'GERADOR 55 KVA', '', 'STEMAC', 'EQUIPAMENTOS', 'NENHUM', 'DIESEL S10'],
  ];
  const aoa = [
    ['LoggB — frota para abastecimentos'],
    ['Apague os exemplos e preencha. CONTROLE: KM, HORAS ou NENHUM. Se o CÓDIGO já existir, o cadastro é atualizado.'],
    [],
    FLEET_HEADERS,
    ...examples,
  ];
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: FLEET_HEADERS.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: FLEET_HEADERS.length - 1 } },
  ];
  ws['!cols'] = [{ wch: 12 }, { wch: 38 }, { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 20 }];
  ws['A1'].s = { font: { bold: true, sz: 16, color: { rgb: '263238' } } };
  ws['A2'].s = { font: { italic: true, sz: 11, color: { rgb: '475569' } }, alignment: { wrapText: true } };
  for (let c = 0; c < FLEET_HEADERS.length; c++) {
    const h = ws[XLSXStyle.utils.encode_cell({ r: 3, c })];
    if (h) h.s = head;
    for (let r = 0; r < examples.length; r++) {
      const cell = ws[XLSXStyle.utils.encode_cell({ r: 4 + r, c })];
      if (cell) cell.s = ex;
    }
  }
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, 'Frota');
  XLSXStyle.writeFile(wb, 'LoggB_modelo_frota.xlsx');
}

export type FleetImportRow = Omit<FuelVehicle, 'id' | 'active' | 'photo_path'>;

const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();

/** Lê a planilha da frota (primeira aba). Acha o cabeçalho pela coluna DESCRIÇÃO. */
export async function parseFleetFile(file: File): Promise<{ rows: FleetImportRow[]; skipped: number } | { error: string }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { error: 'Planilha vazia.' };
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
  const hi = raw.findIndex((r) => r.some((c) => norm(c) === 'DESCRICAO'));
  if (hi < 0) return { error: 'Não achei a coluna DESCRIÇÃO. Use a planilha modelo.' };
  const header = raw[hi].map(norm);
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.startsWith(n)));
  const ci = {
    code: col('CODIGO'),
    description: col('DESCRICAO'),
    plate: col('PLACA', 'PATRIMONIO'),
    brand: col('MARCA'),
    group: col('GRUPO'),
    meter: col('CONTROLE'),
    fuel: col('COMBUSTIVEL'),
  };
  const cell = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const rows: FleetImportRow[] = [];
  let skipped = 0;
  for (const r of raw.slice(hi + 1)) {
    const description = cell(r, ci.description).toUpperCase();
    if (!description) {
      if (r.some((c) => String(c ?? '').trim())) skipped++;
      continue;
    }
    rows.push({
      code: cell(r, ci.code) || null,
      description,
      plate: cell(r, ci.plate).toUpperCase() || null,
      brand: cell(r, ci.brand).toUpperCase() || null,
      group_name: cell(r, ci.group).toUpperCase() || null,
      meter_type: asMeterType(cell(r, ci.meter)),
      fuel_type: cell(r, ci.fuel).toUpperCase() || null,
    });
  }
  return { rows, skipped };
}
