const DB_NAME = 'bingo_quiz_media';
const STORE_NAME = 'images';
const IDB_PREFIX = 'idb://';
const memCache = new Map();

export function isIdbImageRef(url) {
  return /^idb:\/\/[a-zA-Z0-9_-]{4,64}$/.test(String(url || '').trim());
}

export function getCachedIdbImage(ref) {
  return memCache.get(String(ref || '').trim()) || '';
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('NO_IDB')); return; }
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IDB_OPEN_FAIL'));
    } catch (e) {
      reject(e);
    }
  });
}

export async function saveImageToIdb(dataUrl) {
  const val = String(dataUrl || '').trim();
  if (!val) return '';
  if (isIdbImageRef(val)) return val;
  const id = 'img_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const ref = IDB_PREFIX + id;
  memCache.set(ref, val);
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ id, dataUrl: val, bytes: val.length, createdAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return ref;
  } catch {
    return val;
  }
}

export async function getImageFromIdb(ref) {
  const clean = String(ref || '').trim();
  if (!clean) return '';
  if (!isIdbImageRef(clean)) return clean;
  if (memCache.has(clean)) return memCache.get(clean);
  const id = clean.slice(IDB_PREFIX.length);
  try {
    const db = await openDb();
    const rec = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    const url = rec && rec.dataUrl ? rec.dataUrl : '';
    if (url) memCache.set(clean, url);
    return url;
  } catch {
    return '';
  }
}

export async function hydrateImages(rootEl) {
  if (!rootEl) return;
  const imgs = [...rootEl.querySelectorAll('img[data-idb-src]')];
  await Promise.all(imgs.map(async img => {
    const ref = img.dataset.idbSrc;
    if (!ref) return;
    const url = await getImageFromIdb(ref);
    if (url && document.contains(img)) {
      img.src = url;
      img.style.display = '';
    }
  }));
}

export async function getIdbUsage() {
  try {
    const db = await openDb();
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error);
    });
    const bytes = all.reduce((s, r) => s + (Number(r.bytes) || (r.dataUrl ? r.dataUrl.length : 0)), 0);
    return { count: all.length, bytes, kb: Math.round(bytes / 1024) };
  } catch {
    return { count: 0, bytes: 0, kb: 0 };
  }
}

export async function inlineIdbImagesInText(rawText) {
  const txt = String(rawText || '');
  const refs = [...new Set([...txt.matchAll(/idb:\/\/[a-zA-Z0-9_-]{4,64}/g)].map(m => m[0]))];
  if (!refs.length) return txt;
  let out = txt;
  for (const ref of refs) {
    const dataUrl = await getImageFromIdb(ref);
    if (dataUrl) out = out.split(ref).join(dataUrl);
  }
  return out;
}
