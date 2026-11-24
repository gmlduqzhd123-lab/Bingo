export async function compressImageFile(file, maxDim = 640, quality = 0.78) {
  if (!file || (file.type && !file.type.startsWith('image/'))) {
    throw new Error('NOT_IMAGE');
  }
  const rawUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('READ_ERROR'));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('DECODE_ERROR'));
    el.src = rawUrl;
  });
  const w0 = img.naturalWidth || img.width || 1;
  const h0 = img.naturalHeight || img.height || 1;
  const scale = Math.min(1, maxDim / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  let out = canvas.toDataURL('image/webp', quality);
  if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', quality);
  else {
    const jpg = canvas.toDataURL('image/jpeg', quality);
    if (jpg.length < out.length) out = jpg;
  }
  if (out.length > 180000) {
    out = canvas.toDataURL('image/jpeg', 0.58);
  }
  if (out.length > 180000) throw new Error('TOO_LARGE');
  return out;
}
