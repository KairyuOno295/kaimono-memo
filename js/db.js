// IndexedDB（ブラウザの中のデータベース）を「キーと値」で使うための小さな入れ物
// 一覧データ・送信待ちの操作・写真をここに保存する（オフラインでも見られるように）。
// IndexedDB が使えない環境では、メモリに保存する（その場合は再読み込みで消える）。

const STORE = 'kv';
let dbName = 'kaimono-memo';
let dbPromise = null;
let memory = null;

/** 保存先の名前を分ける（テスト用。アプリ本体では使わない） */
export function setDbNamespace(ns) {
  dbName = ns ? `kaimono-memo-${ns}` : 'kaimono-memo';
  dbPromise = null;
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(dbName, 1); } catch { resolve(null); return; }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }
  return dbPromise;
}

function mem() {
  if (!memory) memory = new Map();
  return memory;
}

/** 1回の読み書き（transaction）を実行して、終わるのを待つ */
function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const kv = {
  async get(key) {
    const db = await openDb();
    if (!db) return mem().get(key);
    return run(db, 'readonly', (s) => s.get(key));
  },

  /** 複数のキーをまとめて保存する（[[キー, 値], …]） */
  async setMany(entries) {
    const db = await openDb();
    if (!db) { entries.forEach(([k, v]) => mem().set(k, v)); return; }
    await run(db, 'readwrite', (s) => { entries.forEach(([k, v]) => s.put(v, k)); return null; });
  },

  async set(key, value) {
    return kv.setMany([[key, value]]);
  },

  async delMany(keys) {
    const db = await openDb();
    if (!db) { keys.forEach((k) => mem().delete(k)); return; }
    await run(db, 'readwrite', (s) => { keys.forEach((k) => s.delete(k)); return null; });
  },

  async del(key) {
    return kv.delMany([key]);
  },

  async keys() {
    const db = await openDb();
    if (!db) return [...mem().keys()];
    return run(db, 'readonly', (s) => s.getAllKeys());
  },
};
