import type { SupabaseClient } from '@supabase/supabase-js';

/** Pasta privada do Storage (ver supabase/etapa8_documentos_equipamentos.sql). */
export const EQUIPMENT_DOCS_BUCKET = 'equipment-docs';
export const EQUIPMENT_DOC_MAX_BYTES = 15 * 1024 * 1024;
export const EQUIPMENT_DOC_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif';

export type EquipmentDocKind = 'entrega' | 'devolucao' | 'outro';

export const EQUIPMENT_DOC_KIND_LABEL: Record<EquipmentDocKind, string> = {
  entrega: 'Termo de entrega',
  devolucao: 'Termo de devolução',
  outro: 'Outro documento',
};

export type EquipmentDoc = {
  id: string;
  item_id: string;
  employee_id: string | null;
  movement_id: string | null;
  kind: EquipmentDocKind;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  note: string | null;
  created_at: string;
  items?: { description: string; tag?: string | null } | { description: string; tag?: string | null }[] | null;
};

export const EQUIPMENT_DOC_COLUMNS =
  'id, item_id, employee_id, movement_id, kind, file_name, storage_path, mime_type, size_bytes, note, created_at, items ( description, tag )';

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

function extOf(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** Tipo do arquivo (alguns celulares mandam vazio). */
export function equipmentDocMime(file: File): string | null {
  if (file.type && Object.values(MIME_BY_EXT).includes(file.type)) return file.type;
  return MIME_BY_EXT[extOf(file.name)] ?? null;
}

/** Confere tipo e tamanho antes de enviar. Devolve a mensagem de erro, ou null se estiver ok. */
export function checkEquipmentDocFile(file: File): string | null {
  if (!equipmentDocMime(file)) return 'Envie um PDF ou uma foto (JPG, PNG, WEBP ou HEIC).';
  if (file.size > EQUIPMENT_DOC_MAX_BYTES) return 'O arquivo passa de 15 MB. Diminua a foto ou o PDF e tente de novo.';
  if (file.size === 0) return 'O arquivo está vazio.';
  return null;
}

export function formatFileSize(bytes: number | null | undefined): string {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type UploadEquipmentDocInput = {
  workspaceId: string;
  file: File;
  itemId: string;
  employeeId?: string | null;
  movementId?: string | null;
  kind: EquipmentDocKind;
  note?: string | null;
};

/** Envia o arquivo para a pasta do workspace e registra o documento. Se o registro falhar, apaga o arquivo. */
export async function uploadEquipmentDoc(
  supabase: SupabaseClient,
  input: UploadEquipmentDocInput
): Promise<{ ok: true; doc: EquipmentDoc } | { ok: false; message: string }> {
  const problem = checkEquipmentDocFile(input.file);
  if (problem) return { ok: false, message: problem };
  const mime = equipmentDocMime(input.file);
  const ext = extOf(input.file.name) || (mime === 'application/pdf' ? 'pdf' : 'jpg');
  const path = `${input.workspaceId}/${input.employeeId ?? 'geral'}/${newId()}.${ext}`;

  const up = await supabase.storage.from(EQUIPMENT_DOCS_BUCKET).upload(path, input.file, {
    contentType: mime ?? undefined,
    upsert: false,
  });
  if (up.error) {
    const msg = up.error.message || '';
    if (/bucket not found/i.test(msg)) {
      return { ok: false, message: 'A pasta de documentos ainda não existe no banco. Aplique a etapa 8 no Supabase.' };
    }
    return { ok: false, message: msg || 'Não foi possível enviar o arquivo.' };
  }

  const { data, error } = await supabase
    .from('equipment_documents')
    .insert([
      {
        item_id: input.itemId,
        employee_id: input.employeeId ?? null,
        movement_id: input.movementId ?? null,
        kind: input.kind,
        file_name: input.file.name.slice(0, 200) || `documento.${ext}`,
        storage_path: path,
        mime_type: mime,
        size_bytes: input.file.size,
        note: input.note?.trim() ? input.note.trim().slice(0, 300) : null,
      },
    ])
    .select(EQUIPMENT_DOC_COLUMNS)
    .single();

  if (error || !data) {
    await supabase.storage.from(EQUIPMENT_DOCS_BUCKET).remove([path]);
    return { ok: false, message: error?.message || 'Não foi possível registrar o documento.' };
  }
  return { ok: true, doc: data as unknown as EquipmentDoc };
}

/** Abre (ou baixa) o arquivo com um link temporário de 2 minutos. */
export async function openEquipmentDoc(supabase: SupabaseClient, doc: EquipmentDoc, download = false): Promise<string | null> {
  // A janela é aberta antes de esperar o link, senão o navegador do celular bloqueia.
  const win = download ? null : window.open('', '_blank');
  const { data, error } = await supabase.storage
    .from(EQUIPMENT_DOCS_BUCKET)
    .createSignedUrl(doc.storage_path, 120, download ? { download: doc.file_name } : undefined);
  if (error || !data?.signedUrl) {
    win?.close();
    return error?.message || 'Não foi possível abrir o arquivo.';
  }
  if (win) win.location.href = data.signedUrl;
  else window.location.assign(data.signedUrl);
  return null;
}

/** Apaga o registro e o arquivo. */
export async function deleteEquipmentDoc(supabase: SupabaseClient, doc: EquipmentDoc): Promise<string | null> {
  const { error } = await supabase.from('equipment_documents').delete().eq('id', doc.id);
  if (error) return error.message;
  await supabase.storage.from(EQUIPMENT_DOCS_BUCKET).remove([doc.storage_path]);
  return null;
}

export function equipmentDocItemLabel(doc: EquipmentDoc): string {
  const it = Array.isArray(doc.items) ? doc.items[0] : doc.items;
  return it?.description ?? 'Item removido';
}
