export class MockReviewStore {
  constructor({ storage = globalThis.localStorage, storageKey = "sign-review:mock-events", failNextSave = false } = {}) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.failNextSave = failNextSave;
  }

  async listEvents() {
    try {
      const parsed = JSON.parse(this.storage?.getItem(this.storageKey) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async appendEvent(event) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("MOCK_NETWORK_FAILURE");
    }
    const events = await this.listEvents();
    if (events.some(existing => existing.event_id === event.event_id || existing.content_hash === event.content_hash)) {
      return { appended: false, idempotent: true };
    }
    events.push(event);
    this.storage?.setItem(this.storageKey, JSON.stringify(events));
    return { appended: true, idempotent: false };
  }
}
