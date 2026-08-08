export class OfflineEventQueue {
  constructor({ indexedDBImpl = globalThis.indexedDB, databaseName = "sign-expert-review", storeName = "pending-events" } = {}) {
    this.indexedDB = indexedDBImpl;
    this.databaseName = databaseName;
    this.storeName = storeName;
  }

  async enqueue(event) {
    const db = await this.#open();
    await transactionPromise(db, this.storeName, "readwrite", store => store.put(event));
  }

  async list() {
    const db = await this.#open();
    return transactionPromise(db, this.storeName, "readonly", store => store.getAll());
  }

  async remove(eventId) {
    const db = await this.#open();
    await transactionPromise(db, this.storeName, "readwrite", store => store.delete(eventId));
  }

  async flush(store) {
    const pending = await this.list();
    const failures = [];
    for (const event of pending) {
      try {
        await store.appendEvent({ ...event, save_status: "VALID" });
        await this.remove(event.event_id);
      } catch (error) {
        failures.push({ event_id: event.event_id, error: error.message });
      }
    }
    return { attempted: pending.length, synced: pending.length - failures.length, failures };
  }

  async #open() {
    if (!this.indexedDB) throw new Error("INDEXEDDB_UNAVAILABLE");
    return new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) {
          request.result.createObjectStore(this.storeName, { keyPath: "event_id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

function transactionPromise(db, storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error || request?.error);
    transaction.onabort = () => reject(transaction.error || new Error("INDEXEDDB_ABORTED"));
  });
}
