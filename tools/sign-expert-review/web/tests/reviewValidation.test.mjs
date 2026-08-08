import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateReview } from "../src/validation/reviewValidation.js";

const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../../fixtures/review_batch_manifest.json", import.meta.url)), "utf8"));
const candidate = manifest.candidates[0];

function review(overrides = {}) {
  return {
    revision: manifest.revision,
    clip_sha256: candidate.clip_sha256,
    target_validation: "TARGET_CONFIRMED",
    boundary_status: "KEEP_ORIGINAL",
    approved_start_local_frame: 9,
    approved_end_local_frame: 15,
    learning_allowed: "ALLOWED",
    reference_allowed: "ALLOWED",
    representative_fit: "HIGH",
    sentence_connection_effect: "NONE",
    excluded: false,
    exclusion_reason: "",
    expert_notes: "",
    ...overrides
  };
}

test("valid keep-original review passes", () => {
  assert.equal(validateReview(review(), candidate, manifest).code, "VALID");
});

test("modified boundary must differ and remain ordered", () => {
  assert.equal(validateReview(review({ boundary_status: "MODIFIED" }), candidate, manifest).code, "INVALID_BOUNDARY");
  assert.equal(validateReview(review({ boundary_status: "MODIFIED", approved_start_local_frame: 8 }), candidate, manifest).code, "VALID");
  assert.equal(validateReview(review({ boundary_status: "MODIFIED", approved_start_local_frame: 16 }), candidate, manifest).code, "INVALID_BOUNDARY");
});

test("mismatch and exclusion usage combinations fail closed", () => {
  assert.equal(validateReview(review({ target_validation: "TARGET_MISMATCH" }), candidate, manifest).code, "INVALID_TARGET");
  assert.equal(validateReview(review({ excluded: true, exclusion_reason: "영상 손상" }), candidate, manifest).code, "INVALID_USAGE_COMBINATION");
  assert.equal(validateReview(review({ excluded: true, exclusion_reason: "영상 손상", learning_allowed: "NOT_ALLOWED", reference_allowed: "NOT_ALLOWED" }), candidate, manifest).code, "VALID");
});

test("unusable and conditional decisions require explanatory text", () => {
  assert.equal(validateReview(review({ boundary_status: "UNUSABLE" }), candidate, manifest).code, "INVALID_USAGE_COMBINATION");
  assert.equal(validateReview(review({ learning_allowed: "CONDITIONAL" }), candidate, manifest).code, "INVALID_USAGE_COMBINATION");
  assert.equal(validateReview(review({ learning_allowed: "CONDITIONAL", expert_notes: "교육용 앞 문맥 확인 필요" }), candidate, manifest).code, "VALID");
});

test("stale revision and changed clip are blocked", () => {
  assert.equal(validateReview(review({ revision: "STALE" }), candidate, manifest).code, "STALE_MANIFEST");
  assert.equal(validateReview(review({ clip_sha256: "0".repeat(64) }), candidate, manifest).code, "CLIP_CHANGED");
});
