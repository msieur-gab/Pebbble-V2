// Owned-device storage (IndexedDB). Used only when the device is marked as owned.
// Keeps, per pebbble: its tag key, the password key if one was entered, the
// encrypted header, and the encrypted audio files. Everything stays encrypted at
// rest; the keys sit beside it, which is what "owned device" means.

const DB_NAME = 'pebbble-v2';
const MODE_KEY = 'pebbble-device'; // 'owned' | 'guest'

let dbPromise = null;

function db() {
    dbPromise ??= new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const d = req.result;
            d.createObjectStore('pebbbles', { keyPath: 'id' }); // { id, key, pwKey?, header, name, count, savedAt }
            d.createObjectStore('files', { keyPath: 'path' });  // { path: "<id>/<file>", id, sealed }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function run(store, mode, fn) {
    const tx = (await db()).transaction(store, mode);
    const result = fn(tx.objectStore(store));
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(result?.result);
        tx.onerror = () => reject(tx.error);
    });
}

// ---------- device mode ----------

export function getMode() {
    try { return localStorage.getItem(MODE_KEY); } catch { return null; }
}

export async function setMode(mode) {
    try { localStorage.setItem(MODE_KEY, mode); } catch {}
    if (mode === 'guest') await clearAll();
}

export const isOwned = () => getMode() === 'owned';

// ---------- pebbbles ----------

export const getPebbble = id => run('pebbbles', 'readonly', s => s.get(id));
export const listPebbbles = () => run('pebbbles', 'readonly', s => s.getAll());
export const putPebbble = record => run('pebbbles', 'readwrite', s => s.put(record));

// ---------- files ----------

export const getFile = path => run('files', 'readonly', s => s.get(path)).then(r => r?.sealed ?? null);
export const putFile = (path, sealed) => run('files', 'readwrite', s => s.put({ path, id: path.split('/')[0], sealed }));
export const filePaths = id => run('files', 'readonly', s => s.getAllKeys(IDBKeyRange.bound(`${id}/`, `${id}/￿`)));
export const deleteFile = path => run('files', 'readwrite', s => s.delete(path));

export async function forget(id) {
    for (const path of await filePaths(id)) await deleteFile(path);
    await run('pebbbles', 'readwrite', s => s.delete(id));
}

export async function clearAll() {
    if (!dbPromise) {
        // Nothing opened yet in this session: delete the whole database.
        await new Promise(r => { const q = indexedDB.deleteDatabase(DB_NAME); q.onsuccess = q.onerror = q.onblocked = () => r(); });
        return;
    }
    await run('pebbbles', 'readwrite', s => s.clear());
    await run('files', 'readwrite', s => s.clear());
}
