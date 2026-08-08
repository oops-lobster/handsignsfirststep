export class ReviewSession {
  constructor({ storage = globalThis.localStorage, namespace = "sign-review" } = {}) {
    this.storage = storage;
    this.namespace = namespace;
  }

  #key(suffix) {
    return `${this.namespace}:${suffix}`;
  }

  saveLastCandidate(batchId, candidateId) {
    this.storage?.setItem(this.#key(`last:${batchId}`), candidateId);
  }

  lastCandidate(batchId) {
    return this.storage?.getItem(this.#key(`last:${batchId}`)) || null;
  }

  saveDraft(batchId, revision, candidateId, draft) {
    this.storage?.setItem(this.#key(`draft:${batchId}:${revision}:${candidateId}`), JSON.stringify(draft));
  }

  loadDraft(batchId, revision, candidateId) {
    try {
      return JSON.parse(this.storage?.getItem(this.#key(`draft:${batchId}:${revision}:${candidateId}`)) || "null");
    } catch {
      return null;
    }
  }

  clearDraft(batchId, revision, candidateId) {
    this.storage?.removeItem(this.#key(`draft:${batchId}:${revision}:${candidateId}`));
  }
}
