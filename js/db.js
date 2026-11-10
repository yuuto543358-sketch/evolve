// IndexedDB をかんたんに使うための小さなラッパー
// データはこの端末のブラウザ内に保存されます（サーバーは不要）。

const DB_VERSION = 1;
export const RECORD_STORES = ['exercises', 'workouts', 'cardio', 'meals', 'body', 'photos'];
const ALL_STORES = ['kv', ...RECORD_STORES, 'photoBlobs'];

let dbPromise = null;

export function isDemo() {
  try { return localStorage.getItem('evolve:demo') === '1'; } catch { return false; }
}

export function setDemo(on) {
  try {
    if (on) localStorage.setItem('evolve:demo', '1');
    else localStorage.removeItem('evolve:demo');
  } catch { /* localStorage が使えない環境では何もしない */ }
}

export function dbName() {
  return isDemo() ? 'evolve-demo' : 'evolve';
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('このブラウザはデータ保存（IndexedDB）に対応していません'));
      return;
    }
    const req = indexedDB.open(dbName(), DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      for (const name of RECORD_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const os = db.createObjectStore(name, { keyPath: 'id' });
          if (name !== 'exercises') os.createIndex('date', 'date');
        }
      }
      if (!db.objectStoreNames.contains('photoBlobs')) db.createObjectStore('photoBlobs');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('データベースが他のタブで使用中です。他のタブを閉じてください。'));
  });
  return dbPromise;
}

function run(storeNames, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存が中断されました（容量不足の可能性があります）'));
    const out = fn(tx);
    if (out && typeof out.onsuccess !== 'undefined') {
      out.onsuccess = () => { result = out.result; };
    } else {
      result = out;
    }
  }));
}

export function getAll(store) {
  return run([store], 'readonly', (tx) => tx.objectStore(store).getAll());
}

export function put(store, value, key) {
  return run([store], 'readwrite', (tx) => (key === undefined
    ? tx.objectStore(store).put(value)
    : tx.objectStore(store).put(value, key)));
}

export function get(store, key) {
  return run([store], 'readonly', (tx) => tx.objectStore(store).get(key));
}

export function del(store, key) {
  return run([store], 'readwrite', (tx) => tx.objectStore(store).delete(key));
}

export function getAllKeys(store) {
  return run([store], 'readonly', (tx) => tx.objectStore(store).getAllKeys());
}

export function bulkPut(store, values, keyFn) {
  return run([store], 'readwrite', (tx) => {
    const os = tx.objectStore(store);
    for (const v of values) {
      if (keyFn) os.put(v, keyFn(v)); else os.put(v);
    }
  });
}

export function clearAll() {
  return run(ALL_STORES, 'readwrite', (tx) => {
    for (const s of ALL_STORES) tx.objectStore(s).clear();
  });
}

export function kvGet(key) { return get('kv', key); }
export function kvSet(key, value) { return put('kv', value, key); }

export async function deleteDatabase(name) {
  if (dbPromise) {
    try { (await dbPromise).close(); } catch { /* ignore */ }
    dbPromise = null;
  }
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
