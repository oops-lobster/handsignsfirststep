import test from "node:test";
import assert from "node:assert/strict";
import { OfflineEventQueue } from "../src/storage/offlineQueue.js";
import { ReviewSession } from "../src/storage/reviewSession.js";

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }
}

function memoryIndexedDB() {
  const records = new Map();
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    transaction: () => {
      const transaction = { oncomplete: null, onerror: null, onabort: null };
      const complete = request => {
        queueMicrotask(() => transaction.oncomplete?.());
        return request;
      };
      transaction.objectStore = () => ({
        put: event => {
          records.set(event.event_id, structuredClone(event));
          return complete({ result: event.event_id });
        },
        getAll: () => complete({ result: [...records.values()].map(event => structuredClone(event)) }),
        delete: eventId => {
          records.delete(eventId);
          return complete({ result: undefined });
        }
      });
      return transaction;
    }
  };

  return {
    open: () => {
      const request = { result: database, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
}

test("review session restores the last candidate and revision-scoped draft", () => {
  const storage = new MemoryStorage();
  const session = new ReviewSession({ storage });
  const draft = { boundary_status: "MODIFIED", approved_start_local_frame: 10 };

  session.saveLastCandidate("batch-1", "GOOD1_003");
  session.saveDraft("batch-1", "REVIEW_V1", "GOOD1_003", draft);

  assert.equal(session.lastCandidate("batch-1"), "GOOD1_003");
  assert.deepEqual(session.loadDraft("batch-1", "REVIEW_V1", "GOOD1_003"), draft);
  assert.equal(session.loadDraft("batch-1", "REVIEW_V2", "GOOD1_003"), null);

  session.clearDraft("batch-1", "REVIEW_V1", "GOOD1_003");
  assert.equal(session.loadDraft("batch-1", "REVIEW_V1", "GOOD1_003"), null);
});

test("offline queue retains failed events and flushes them after reconnect", async () => {
  const queue = new OfflineEventQueue({ indexedDBImpl: memoryIndexedDB(), databaseName: "test-review-queue" });
  await queue.enqueue({ event_id: "event-1", save_status: "SYNC_PENDING" });
  await queue.enqueue({ event_id: "event-2", save_status: "SYNC_PENDING" });

  const firstStore = {
    appendEvent: async event => {
      if (event.event_id === "event-1") throw new Error("NETWORK_UNAVAILABLE");
      assert.equal(event.save_status, "VALID");
    }
  };
  const first = await queue.flush(firstStore);
  assert.deepEqual(first, {
    attempted: 2,
    synced: 1,
    failures: [{ event_id: "event-1", error: "NETWORK_UNAVAILABLE" }]
  });
  assert.deepEqual((await queue.list()).map(event => event.event_id), ["event-1"]);

  const second = await queue.flush({ appendEvent: async () => undefined });
  assert.deepEqual(second, { attempted: 1, synced: 1, failures: [] });
  assert.deepEqual(await queue.list(), []);
});
