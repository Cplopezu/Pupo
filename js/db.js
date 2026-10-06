// Persistencia local en IndexedDB: gastos, imágenes de boletas y ajustes.
const DB_NAME = 'pupo-gastos';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('gastos')) {
        const s = d.createObjectStore('gastos', { keyPath: 'id' });
        s.createIndex('fecha', 'fecha');
      }
      if (!d.objectStoreNames.contains('imagenes')) d.createObjectStore('imagenes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('ajustes')) d.createObjectStore('ajustes', { keyPath: 'clave' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    let out;
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  all: store => tx(store, 'readonly', s => s.getAll()),
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  put: (store, value) => tx(store, 'readwrite', s => s.put(value)),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  clear: store => tx(store, 'readwrite', s => s.clear()),
};

export async function getAjuste(clave, porDefecto) {
  const r = await db.get('ajustes', clave);
  return r ? r.valor : porDefecto;
}
export const setAjuste = (clave, valor) => db.put('ajustes', { clave, valor });

export async function pedirPersistencia() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* sin soporte */ }
  return false;
}

export async function estimarUso() {
  try {
    if (navigator.storage?.estimate) return await navigator.storage.estimate();
  } catch { /* sin soporte */ }
  return null;
}
