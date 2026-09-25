import { CONFIG } from '../core/config.js';

const STORE_DEFINITIONS = {
  meta: { keyPath: 'key' },
  profiles: { keyPath: 'id' },
  packs: { keyPath: 'id' },
  words: { keyPath: ['profileId', 'wordKey'] },
  packWords: { keyPath: ['packId', 'wordKey'] },
  progress: { keyPath: ['profileId', 'wordKey'] },
  attempts: { keyPath: 'id', autoIncrement: true },
  sessions: { keyPath: 'id' },
};

let databasePromise;
let usingFallback = false;
const fallbackKey = `${CONFIG.dbName}-fallback`;

function emptyFallback() {
  return Object.fromEntries(Object.keys(STORE_DEFINITIONS).map((name) => [name, []]));
}

function loadFallback() {
  try { return { ...emptyFallback(), ...JSON.parse(localStorage.getItem(fallbackKey) || '{}') }; }
  catch { return emptyFallback(); }
}

function saveFallback(data) { localStorage.setItem(fallbackKey, JSON.stringify(data)); }

function sameKey(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function recordKey(storeName, record) {
  const keyPath = STORE_DEFINITIONS[storeName].keyPath;
  return Array.isArray(keyPath) ? keyPath.map((part) => record[part]) : record[keyPath];
}

function fallbackTransaction(storeNames) {
  const data = loadFallback();
  const makeRequest = (operation) => {
    const request = {};
    queueMicrotask(() => {
      try { request.result = operation(); request.onsuccess?.(); }
      catch (error) { request.error = error; request.onerror?.(); }
    });
    return request;
  };
  return {
    __fallback: true,
    objectStore(storeName) {
      if (!storeNames.includes(storeName)) throw new Error(`事务未包含 ${storeName}`);
      const records = data[storeName];
      return {
        get: (key) => makeRequest(() => records.find((item) => sameKey(recordKey(storeName, item), key))),
        getAll: () => makeRequest(() => structuredClone(records)),
        put: (record) => makeRequest(() => {
          const copy = structuredClone(record); const key = recordKey(storeName, copy);
          const index = records.findIndex((item) => sameKey(recordKey(storeName, item), key));
          if (index >= 0) records[index] = copy; else records.push(copy); return key;
        }),
        add: (record) => makeRequest(() => {
          const copy = structuredClone(record);
          if (STORE_DEFINITIONS[storeName].autoIncrement && copy.id == null) copy.id = records.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
          records.push(copy); return recordKey(storeName, copy);
        }),
        delete: (key) => makeRequest(() => { const index = records.findIndex((item) => sameKey(recordKey(storeName, item), key)); if (index >= 0) records.splice(index, 1); }),
        clear: () => makeRequest(() => { records.length = 0; }),
      };
    },
    commit: () => saveFallback(data),
  };
}

export function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('数据库事务已取消'));
  });
}

export function openDatabase() {
  if (!globalThis.indexedDB?.open) { usingFallback = true; return Promise.resolve(null); }
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(CONFIG.dbName, CONFIG.dbVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        Object.entries(STORE_DEFINITIONS).forEach(([name, options]) => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, options);
        });
      };
      request.onsuccess = () => {
        const db = request.result;
        const timeout = setTimeout(() => { usingFallback = true; db.close(); resolve(null); }, 800);
        try {
          const tx = db.transaction('meta', 'readwrite');
          const store = tx.objectStore('meta');
          const probe = store.put({ key: '__probe__', value: Date.now() });
          probe.onsuccess = () => {
            const read = store.getAll();
            read.onsuccess = () => { clearTimeout(timeout); resolve(db); };
            read.onerror = () => { clearTimeout(timeout); usingFallback = true; db.close(); resolve(null); };
          };
          probe.onerror = () => { clearTimeout(timeout); usingFallback = true; db.close(); resolve(null); };
        } catch { clearTimeout(timeout); usingFallback = true; db.close(); resolve(null); }
      };
      request.onerror = () => { usingFallback = true; resolve(null); };
      request.onblocked = () => reject(new Error('数据库升级被其他页面阻止，请关闭其他标签页后重试'));
    });
  }
  return databasePromise;
}

export async function readAll(storeName) {
  const db = await openDatabase();
  if (usingFallback) return structuredClone(loadFallback()[storeName]);
  return requestAsPromise(db.transaction(storeName).objectStore(storeName).getAll());
}

export async function getOne(storeName, key) {
  const db = await openDatabase();
  if (usingFallback) return structuredClone(loadFallback()[storeName].find((item) => sameKey(recordKey(storeName, item), key)));
  return requestAsPromise(db.transaction(storeName).objectStore(storeName).get(key));
}

export async function putOne(storeName, value) {
  const db = await openDatabase();
  if (usingFallback) {
    const tx = fallbackTransaction([storeName]);
    await requestAsPromise(tx.objectStore(storeName).put(value)); tx.commit(); return value;
  }
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
  return value;
}

export async function runTransaction(storeNames, callback) {
  const db = await openDatabase();
  if (usingFallback) {
    const tx = fallbackTransaction(storeNames);
    const result = await callback(tx); tx.commit(); return result;
  }
  const tx = db.transaction(storeNames, 'readwrite');
  const done = transactionDone(tx);
  const result = await callback(tx);
  await done;
  return result;
}

export async function exportSnapshot() {
  const data = {};
  for (const storeName of Object.keys(STORE_DEFINITIONS).filter((name) => name !== 'meta')) {
    data[storeName] = await readAll(storeName);
  }
  return data;
}

export async function replaceSnapshot(data) {
  const stores = Object.keys(STORE_DEFINITIONS).filter((name) => name !== 'meta');
  await openDatabase();
  if (usingFallback) {
    const current = loadFallback(); stores.forEach((name) => { current[name] = structuredClone(data[name]); }); saveFallback(current); return;
  }
  return runTransaction(stores, (tx) => {
    stores.forEach((name) => {
      const store = tx.objectStore(name);
      store.clear();
      data[name].forEach((record) => store.put(record));
    });
  });
}
