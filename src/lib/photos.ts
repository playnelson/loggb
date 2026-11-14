import type { SupabaseClient } from '@supabase/supabase-js';

/** Pasta privada das fotos dos itens do almoxarifado. */
export const ITEM_PHOTOS_BUCKET = 'item-photos';

/* Fotos tiradas no celular: diminui, envia para a pasta privada e gera links temporários. */

/** Diminui a foto (máx. 1280 px, JPEG) antes de enviar. */
export async function shrinkPhoto(file: File): Promise<Blob> {
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

/** Envia a foto para `<workspace>/<pasta>/<id>-<hora>.jpg` e devolve o caminho (ou a mensagem de erro). */
export async function uploadPhoto(
  client: SupabaseClient,
  bucket: string,
  workspaceId: string,
  folder: string,
  ownerId: string,
  file: File
): Promise<{ path: string } | { error: string }> {
  let blob: Blob;
  try {
    blob = await shrinkPhoto(file);
  } catch {
    return { error: 'Não consegui abrir essa foto. Use JPG ou PNG.' };
  }
  const path = `${workspaceId}/${folder}/${ownerId}-${Date.now()}.jpg`;
  const up = await client.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg' });
  if (up.error) return { error: `Não consegui enviar a foto: ${up.error.message}` };
  return { path };
}

/** Links temporários (1 h) para mostrar as fotos. */
export async function signedPhotoUrls(client: SupabaseClient, bucket: string, paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = [...new Set(paths.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 500) {
    const { data } = await client.storage.from(bucket).createSignedUrls(unique.slice(i, i + 500), 3600);
    for (const r of data ?? []) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
  }
  return out;
}
