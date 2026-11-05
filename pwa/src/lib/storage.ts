import type { Identity } from './pairing';
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('tandem-pairing', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('identity');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function identityStore(value?: Identity | null): Promise<Identity | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('identity', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('identity');
      const r =
        value === undefined
          ? store.get('current')
          : value === null
            ? store.delete('current')
            : store.put(value, 'current');
      tx.oncomplete = () => resolve(value === undefined ? r.result : (value ?? undefined));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
