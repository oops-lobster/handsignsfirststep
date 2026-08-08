import { sha256Text, stableJson } from "../security/hash.js";
import { normalizeReviewInput } from "./reviewModel.js";

export const CLIENT_VERSION = "sign-expert-review-web/2.0.0";

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function createReviewEvent({ manifest, candidate, reviewerCode, form, boundaries, saveStatus = "VALID", now = new Date() }) {
  const review = normalizeReviewInput({ ...form, ...boundaries }, candidate);
  const payload = {
    batch_id: manifest.batch_id,
    candidate_id: candidate.candidate_id,
    revision: manifest.revision,
    reviewer_code: reviewerCode.trim(),
    reviewed_at: now.toISOString(),
    client_version: CLIENT_VERSION,
    review_mode: review.review_mode,
    review_state: review.review_state,
    target_validation: review.target_validation,
    boundary_assessment: review.boundary_assessment,
    precise_review_required: review.precise_review_required,
    precise_review_reason: review.precise_review_reason,
    boundary_confidence: review.boundary_confidence,
    annotated_start_local_frame: candidate.annotated_start_local_frame,
    annotated_end_local_frame: candidate.annotated_end_local_frame,
    auto_proposed_start_local_frame: review.auto_proposed_start_local_frame,
    auto_proposed_end_local_frame: review.auto_proposed_end_local_frame,
    auto_proposed_start_source_sec: review.auto_proposed_start_source_sec,
    auto_proposed_end_source_sec: review.auto_proposed_end_source_sec,
    manual_start_local_frame: review.manual_start_local_frame,
    manual_end_local_frame: review.manual_end_local_frame,
    manual_start_source_sec: review.manual_start_source_sec,
    manual_end_source_sec: review.manual_end_source_sec,
    approved_start_local_frame: review.approved_start_local_frame,
    approved_end_local_frame: review.approved_end_local_frame,
    approved_start_source_sec: review.approved_start_source_sec,
    approved_end_source_sec: review.approved_end_source_sec,
    boundary_status: review.boundary_status,
    learning_video_assessment: review.learning_video_assessment,
    reference_assessment: review.reference_assessment,
    learning_allowed: review.learning_allowed,
    reference_allowed: review.reference_allowed,
    representative_fit: review.representative_fit,
    representative_fit_legacy: review.representative_fit_legacy,
    sentence_connection_effect: review.sentence_connection_effect,
    sentence_connection_effect_legacy: review.sentence_connection_effect_legacy,
    excluded: review.excluded,
    exclusion_reason: String(form.exclusion_reason || "").trim(),
    expert_notes: String(form.expert_notes || "").trim(),
    review_duration_ms: Math.max(0, Number(form.review_duration_ms || 0)),
    interaction_count: Math.max(0, Number(form.interaction_count || 0)),
    clip_sha256: candidate.clip_sha256,
    manifest_sha256: manifest.manifest_sha256,
    save_status: saveStatus
  };
  const { reviewed_at: _reviewedAt, save_status: _saveStatus, ...idempotentPayload } = payload;
  const content_hash = await sha256Text(stableJson(idempotentPayload));
  return { event_id: `${candidate.candidate_id}:${manifest.revision}:${content_hash.slice(0, 24)}:${randomId()}`, ...payload, content_hash };
}
