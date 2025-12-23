// Offline Storage for Inventory Audit
// Uses IndexedDB to store counts when offline

const DB_NAME = 'inventory-audit-db';
const DB_VERSION = 1;
const STORE_NAME = 'pending-counts';

interface PendingCount {
  id?: number;
  auditId: string;
  productId: string;
  count: number;
  countRound: 1 | 2 | 3;
  notes?: string;
  timestamp: number;
  synced: boolean;
}

let db: IDBDatabase | null = null;

export async function initOfflineDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('auditId', 'auditId', { unique: false });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

export async function saveCountOffline(
  auditId: string,
  productId: string,
  count: number,
  countRound: 1 | 2 | 3,
  notes?: string
): Promise<void> {
  const database = await initOfflineDB();
  const transaction = database.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  const pendingCount: PendingCount = {
    auditId,
    productId,
    count,
    countRound,
    notes,
    timestamp: Date.now(),
    synced: false,
  };

  await new Promise<void>((resolve, reject) => {
    const request = store.add(pendingCount);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingCounts(auditId?: string): Promise<PendingCount[]> {
  const database = await initOfflineDB();
  const transaction = database.transaction([STORE_NAME], 'readonly');
  const store = transaction.objectStore(STORE_NAME);
  const index = store.index('auditId');

  return new Promise((resolve, reject) => {
    const request = auditId
      ? index.getAll(auditId)
      : store.getAll();

    request.onsuccess = () => {
      const counts = request.result.filter((c: PendingCount) => !c.synced);
      resolve(counts);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function markAsSynced(id: number): Promise<void> {
  const database = await initOfflineDB();
  const transaction = database.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const getRequest = store.get(id);
    getRequest.onsuccess = () => {
      const count = getRequest.result;
      if (count) {
        count.synced = true;
        const updateRequest = store.put(count);
        updateRequest.onsuccess = () => resolve();
        updateRequest.onerror = () => reject(updateRequest.error);
      } else {
        resolve();
      }
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

export async function clearSyncedCounts(): Promise<void> {
  const database = await initOfflineDB();
  const transaction = database.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const index = store.index('synced');

  return new Promise((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(true));
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function syncPendingCounts(
  syncFn: (count: PendingCount) => Promise<{ success: boolean }>
): Promise<{ synced: number; failed: number }> {
  const pendingCounts = await getPendingCounts();
  let synced = 0;
  let failed = 0;

  for (const count of pendingCounts) {
    try {
      const result = await syncFn(count);
      if (result.success && count.id) {
        await markAsSynced(count.id);
        synced++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error('Error syncing count:', error);
      failed++;
    }
  }

  // Clean up synced counts periodically
  if (synced > 0) {
    await clearSyncedCounts();
  }

  return { synced, failed };
}

export function isOnline(): boolean {
  return navigator.onLine;
}

export function setupOnlineListener(callback: () => void): () => void {
  const handleOnline = () => callback();
  window.addEventListener('online', handleOnline);
  return () => window.removeEventListener('online', handleOnline);
}



