import test from "node:test";
import assert from "node:assert/strict";
import { MockReviewStore } from "../src/adapters/mockReviewStore.js";
import { latestEvents, progressFor } from "../src/review/eventReducer.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

const manifest = { candidates: [{ candidate_id: "A" }, { candidate_id: "B" }] };

function event(id, candidate, time, overrides = {}) {
  return { event_id: id, content_hash: `hash-${id}`, batch_id: "batch", revision: "r1", candidate_id: candidate, reviewed_at: time, ...overrides };
}

test("mock store appends once and rejects event/content duplicates", async () => {
  const store = new MockReviewStore({ storage: new MemoryStorage() });
  const first = event("e1", "A", "2026-08-08T00:00:00Z");
  assert.deepEqual(await store.appendEvent(first), { appended: true, idempotent: false });
  assert.deepEqual(await store.appendEvent(first), { appended: false, idempotent: true });
  assert.deepEqual(await store.appendEvent({ ...first, event_id: "e2" }), { appended: false, idempotent: true });
  assert.equal((await store.listEvents()).length, 1);
});

test("mock network failure is recoverable", async () => {
  const store = new MockReviewStore({ storage: new MemoryStorage(), failNextSave: true });
  await assert.rejects(store.appendEvent(event("e1", "A", "2026-08-08T00:00:00Z")), /MOCK_NETWORK_FAILURE/);
  assert.equal((await store.appendEvent(event("e1", "A", "2026-08-08T00:00:00Z"))).appended, true);
});

test("latest event reduction is idempotent and revision-scoped", () => {
  const events = [
    event("e1", "A", "2026-08-08T00:00:00Z"),
    event("e2", "A", "2026-08-08T00:02:00Z", { target_validation: "TARGET_UNCERTAIN" }),
    event("e2", "A", "2026-08-08T00:02:00Z"),
    event("e3", "B", "2026-08-08T00:03:00Z", { revision: "stale" })
  ];
  const current = latestEvents(events, { batchId: "batch", revision: "r1" });
  assert.equal(current.get("A").event_id, "e2");
  assert.equal(current.has("B"), false);
  assert.deepEqual(progressFor(manifest, current), {
    total: 2, complete: 0, coarseComplete: 0, precisePending: 0, preciseComplete: 0, pending: 1, held: 1
  });
});
