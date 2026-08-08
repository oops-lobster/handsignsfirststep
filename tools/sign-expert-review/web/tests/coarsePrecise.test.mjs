import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizeReviewInput } from "../src/review/reviewModel.js";
import { validateReview } from "../src/validation/reviewValidation.js";
import { validateReviewManifest } from "../src/validation/manifestValidation.js";

const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../../fixtures/review_batch_manifest.json", import.meta.url)), "utf8"));
const candidate = manifest.candidates[0];

function coarse(overrides = {}) {
  return {
    revision: manifest.revision,
    clip_sha256: candidate.clip_sha256,
    review_mode: "COARSE",
    target_validation: "TARGET_CONFIRMED",
    boundary_assessment: "BOUNDARY_KEEP_ORIGINAL",
    learning_video_assessment: "LEARNING_ALLOWED",
    reference_assessment: "REFERENCE_ALLOWED",
    representative_fit: "REPRESENTATIVE_MEDIUM",
    sentence_connection_effect: "CONNECTION_NONE",
    excluded: false,
    exclusion_reason: "",
    expert_notes: "",
    ...overrides
  };
}

test("COARSE starts without an implicit boundary assessment", () => {
  const value = normalizeReviewInput({ review_mode: "COARSE" }, candidate);
  assert.equal(value.review_mode, "COARSE");
  assert.equal(value.boundary_assessment, null);
  assert.equal(value.approved_start_local_frame, null);
});

test("keeping the original boundary completes coarse review with annotation coordinates", () => {
  const result = validateReview(coarse(), candidate, manifest);
  assert.equal(result.code, "VALID");
  assert.equal(result.review.review_state, "COARSE_REVIEW_COMPLETE");
  assert.equal(result.review.approved_start_local_frame, candidate.annotated_start_local_frame);
  assert.equal(result.review.approved_end_local_frame, candidate.annotated_end_local_frame);
});

test("directional coarse assessments create precise pending without approved frames", () => {
  for (const boundary of ["BOUNDARY_START_TOO_EARLY", "BOUNDARY_END_TOO_LATE"]) {
    const result = validateReview(coarse({ boundary_assessment: boundary, expert_notes: "정밀 경계 확인 필요" }), candidate, manifest);
    assert.equal(result.code, "VALID");
    assert.equal(result.review.review_state, "PRECISE_REVIEW_REQUIRED");
    assert.equal(result.review.boundary_status, "NEEDS_REFINEMENT");
    assert.equal(result.review.approved_start_local_frame, null);
  }
});

test("ambiguous boundaries, conditional usage, and exclusion require explanations", () => {
  assert.equal(validateReview(coarse({ boundary_assessment: "BOUNDARY_AMBIGUOUS" }), candidate, manifest).code, "INVALID_USAGE_COMBINATION");
  assert.equal(validateReview(coarse({ learning_video_assessment: "LEARNING_CONDITIONAL" }), candidate, manifest).code, "INVALID_USAGE_COMBINATION");
  assert.equal(validateReview(coarse({ learning_video_assessment: "LEARNING_CONDITIONAL", expert_notes: "앞 문맥 확인" }), candidate, manifest).code, "VALID");
  assert.equal(validateReview(coarse({ excluded: true, learning_video_assessment: "LEARNING_NOT_ALLOWED", reference_assessment: "REFERENCE_NOT_ALLOWED" }), candidate, manifest).code, "INVALID_USAGE_COMBINATION");
});

test("target mismatch cannot retain usage or representative approval", () => {
  assert.equal(validateReview(coarse({ target_validation: "TARGET_MISMATCH" }), candidate, manifest).code, "INVALID_TARGET");
  const result = validateReview(coarse({
    target_validation: "TARGET_MISMATCH",
    learning_video_assessment: "LEARNING_NOT_ALLOWED",
    reference_assessment: "REFERENCE_NOT_ALLOWED",
    representative_fit: "REPRESENTATIVE_UNSUITABLE",
    excluded: true,
    exclusion_reason: "다른 gloss",
    expert_notes: "[좋다1]이 아님"
  }), candidate, manifest);
  assert.equal(result.code, "VALID");
  assert.equal(result.review.review_state, "REJECTED");
});

test("valid PRECISE manual frames take priority and complete the precise review", () => {
  const result = validateReview(coarse({
    review_mode: "PRECISE",
    boundary_assessment: "BOUNDARY_START_TOO_EARLY",
    manual_start_local_frame: 10,
    manual_end_local_frame: 15,
    expert_notes: "시작을 한 프레임 늦춤"
  }), candidate, manifest);
  assert.equal(result.code, "VALID");
  assert.equal(result.review.review_state, "PRECISE_REVIEW_COMPLETE");
  assert.equal(result.review.approved_start_local_frame, 10);
  assert.equal(result.review.approved_start_source_sec, candidate.source_frame_pts_sec[10]);
});

test("batch manifest allows 150 candidates and blocks 151", () => {
  const make = count => ({
    ...manifest,
    candidates: Array.from({ length: count }, (_, index) => ({ ...candidate, candidate_id: `GOOD1_LIMIT_${String(index).padStart(3, "0")}` }))
  });
  assert.equal(validateReviewManifest(make(150)).ok, true);
  assert.deepEqual(validateReviewManifest(make(151)), { ok: false, code: "REVIEW_BATCH_TOO_LARGE" });
});
