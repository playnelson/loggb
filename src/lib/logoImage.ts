/** Tamanho máximo aceito pelo banco para a logo (data URL), ver organizations.logo_data. */
export const LOGO_MAX_CHARS = 300_000;

const MAX_SIDE = 256;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível abrir esta imagem. Use PNG, JPG, WEBP ou SVG.'));
    };
    img.src = url;
  });
}

/**
 * Reduz a logo para no máximo 256 px no maior lado e devolve um data URL.
 * Mantém transparência (PNG); se ficar grande demais, tenta WEBP.
 */
export async function logoFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo de imagem (PNG, JPG, WEBP ou SVG).');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Imagem muito grande (máximo 10 MB).');
  }
  const img = await loadImage(file);
  const w = img.naturalWidth || MAX_SIDE;
  const h = img.naturalHeight || MAX_SIDE;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Seu navegador não conseguiu processar a imagem.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let data = canvas.toDataURL('image/png');
  if (data.length > LOGO_MAX_CHARS) data = canvas.toDataURL('image/webp', 0.85);
  if (data.length > LOGO_MAX_CHARS) data = canvas.toDataURL('image/jpeg', 0.8);
  if (data.length > LOGO_MAX_CHARS) throw new Error('Não foi possível reduzir a logo o suficiente. Tente outra imagem.');
  return data;
}
