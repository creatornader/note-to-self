// IndexedDB wrappers for browser-side persistence.
//
// Schema (DB_VERSION 1):
//   - identity        : wrapped age identity blobs (key: "current"), bearer token (key: "bearer")
//   - sync_state      : SyncState snapshot (key: "current")
//   - cache_index     : last-seen merged Index (key: "current")
//   - cache_messages  : decrypted message previews keyed by message id
//
// Each store uses out-of-line keys so we can store opaque structured-clone-safe
// values without forcing every record to carry an `id` field.

const DB_NAME = "nts-store";
const DB_VERSION = 1;

export const STORES = [
  "identity",
  "sync_state",
  "cache_index",
  "cache_messages",
] as const;

export type Store = (typeof STORES)[number];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error(`IndexedDB upgrade blocked: another tab holds an older version of ${DB_NAME}`));
  });
}

export async function idbGet<T>(
  store: Store,
  key: IDBValidKey,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function idbPut(
  store: Store,
  key: IDBValidKey,
  value: unknown,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function idbDel(store: Store, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function idbClear(store: Store): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function idbKeys(store: Store): Promise<IDBValidKey[]> {
  const db = await openDb();
  try {
    return await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/// Wipe every store. Used by the panic-wipe flow (M4b) and by tests for isolation.
export async function idbWipeAll(): Promise<void> {
  for (const s of STORES) await idbClear(s);
}
