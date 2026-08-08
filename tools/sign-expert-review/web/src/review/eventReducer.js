import { candidateReviewState, normalizeReviewInput } from "./reviewModel.js";

export function latestEvents(events, { batchId, revision } = {}) {
  const byCandidate = new Map();
  const seenEventIds = new Set();
  for (const event of events || []) {
    if (!event?.event_id || seenEventIds.has(event.event_id)) continue;
    seenEventIds.add(event.event_id);
    if (batchId && event.batch_id !== batchId) continue;
    if (revision && event.revision !== revision) continue;
    if (!event.candidate_id || !event.reviewed_at) continue;
    const current = byCandidate.get(event.candidate_id);
    const currentKey = current ? `${current.reviewed_at}:${current.event_id}` : "";
    const nextKey = `${event.reviewed_at}:${event.event_id}`;
    if (!current || nextKey > currentKey) byCandidate.set(event.candidate_id, event);
  }
  return byCandidate;
}

export function progressFor(manifest, current) {
  const total = manifest.candidates.length;
  const states = manifest.candidates.map(candidate => candidateReviewState(current.get(candidate.candidate_id), candidate));
  const coarseComplete = states.filter(value => ["COARSE_REVIEW_COMPLETE", "PRECISE_REVIEW_REQUIRED", "PRECISE_REVIEW_COMPLETE", "REJECTED"].includes(value)).length;
  const precisePending = states.filter(value => value === "PRECISE_REVIEW_REQUIRED").length;
  const preciseComplete = states.filter(value => value === "PRECISE_REVIEW_COMPLETE").length;
  const held = states.filter(value => value === "REVIEW_ON_HOLD").length;
  const pending = states.filter(value => value === "NOT_REVIEWED").length;
  return { total, complete: coarseComplete, coarseComplete, precisePending, preciseComplete, pending, held };
}

export function normalizedCurrentEvent(event, candidate) {
  return event ? normalizeReviewInput(event, candidate) : null;
}
