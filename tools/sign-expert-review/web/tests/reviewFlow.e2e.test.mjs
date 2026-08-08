import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BoundaryController } from "../src/player/boundaryController.js";
import { createReviewEvent } from "../src/review/eventFactory.js";
import { latestEvents } from "../src/review/eventReducer.js";
import { validateReview } from "../src/validation/reviewValidation.js";
import { webcrypto } from "node:crypto";

globalThis.crypto ||= webcrypto;
const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../../fixtures/review_batch_manifest.json", import.meta.url)), "utf8"));

const baseForm = {
  target_validation: "TARGET_CONFIRMED",
  boundary_status: "KEEP_ORIGINAL",
  learning_allowed: "ALLOWED",
  reference_allowed: "ALLOWED",
  representative_fit: "HIGH",
  sentence_connection_effect: "NONE",
  excluded: false,
  exclusion_reason: "",
  expert_notes: ""
};

for (const scenario of [
  { name: "keep original", change: () => {} },
  { name: "modify start", change: controller => controller.setStart(8) },
  { name: "modify end", change: controller => controller.setEnd(16) },
  { name: "modify both", change: controller => { controller.setStart(8); controller.setEnd(16); } }
]) {
  test(`review flow: ${scenario.name}`, async () => {
    const candidate = manifest.candidates[0];
    const boundaries = new BoundaryController(candidate);
    scenario.change(boundaries);
    const snapshot = boundaries.snapshot();
    const form = { ...baseForm, boundary_status: snapshot.boundary_status };
    assert.equal(validateReview({ ...form, ...snapshot, revision: manifest.revision, clip_sha256: candidate.clip_sha256 }, candidate, manifest).ok, true);
    const event = await createReviewEvent({ manifest, candidate, reviewerCode: "R-01", form, boundaries: snapshot, now: new Date("2026-08-08T00:00:00Z") });
    assert.equal(latestEvents([event], { batchId: manifest.batch_id, revision: manifest.revision }).get(candidate.candidate_id).event_id, event.event_id);
  });
}

test("review flow: mismatch, unusable, conditional, stale, and resume gates", () => {
  const candidate = manifest.candidates[0];
  const boundaries = new BoundaryController(candidate).snapshot();
  const validate = form => validateReview({ ...boundaries, ...form, revision: manifest.revision, clip_sha256: candidate.clip_sha256 }, candidate, manifest).code;
  assert.equal(validate({ ...baseForm, target_validation: "TARGET_MISMATCH" }), "INVALID_TARGET");
  assert.equal(validate({ ...baseForm, boundary_status: "UNUSABLE" }), "INVALID_USAGE_COMBINATION");
  assert.equal(validate({ ...baseForm, learning_allowed: "CONDITIONAL", expert_notes: "" }), "INVALID_USAGE_COMBINATION");
  assert.equal(validate({ ...baseForm, learning_allowed: "CONDITIONAL", expert_notes: "조건 확인" }), "VALID");
  assert.equal(validateReview({ ...baseForm, ...boundaries, revision: "old", clip_sha256: candidate.clip_sha256 }, candidate, manifest).code, "STALE_MANIFEST");
});

const coarseForm = {
  target_validation: "TARGET_CONFIRMED",
  boundary_assessment: "BOUNDARY_KEEP_ORIGINAL",
  learning_video_assessment: "LEARNING_ALLOWED",
  reference_assessment: "REFERENCE_ALLOWED",
  representative_fit: "REPRESENTATIVE_MEDIUM",
  sentence_connection_effect: "CONNECTION_NONE",
  excluded: false,
  exclusion_reason: "",
  expert_notes: ""
};

test("coarse-first flow completes without opening the precise panel", async () => {
  const candidate = manifest.candidates[0];
  const boundaries = new BoundaryController(candidate).snapshot();
  const input = { ...coarseForm, review_mode: "COARSE", ...boundaries, revision: manifest.revision, clip_sha256: candidate.clip_sha256 };
  const validation = validateReview(input, candidate, manifest);
  assert.equal(validation.review.review_state, "COARSE_REVIEW_COMPLETE");
  const event = await createReviewEvent({ manifest, candidate, reviewerCode: "R-COARSE", form: input, boundaries });
  assert.equal(event.review_state, "COARSE_REVIEW_COMPLETE");
  assert.equal(event.manual_start_local_frame, null);
  assert.equal(event.approved_start_local_frame, candidate.annotated_start_local_frame);
});

test("coarse direction is precise-pending until a later valid manual event", async () => {
  const candidate = manifest.candidates[0];
  const controller = new BoundaryController(candidate);
  const coarse = {
    ...coarseForm,
    review_mode: "COARSE",
    boundary_assessment: "BOUNDARY_START_TOO_EARLY",
    expert_notes: "정밀 시작 경계 확인 필요"
  };
  const pending = await createReviewEvent({ manifest, candidate, reviewerCode: "R-PRECISE", form: coarse, boundaries: controller.snapshot(), now: new Date("2026-08-08T00:00:00Z") });
  assert.equal(pending.review_state, "PRECISE_REVIEW_REQUIRED");
  assert.equal(pending.approved_start_local_frame, null);

  controller.setStart(10);
  const precise = await createReviewEvent({
    manifest,
    candidate,
    reviewerCode: "R-PRECISE",
    form: { ...coarse, review_mode: "PRECISE" },
    boundaries: controller.snapshot(),
    now: new Date("2026-08-08T00:01:00Z")
  });
  assert.equal(precise.review_state, "PRECISE_REVIEW_COMPLETE");
  assert.equal(precise.approved_start_local_frame, 10);
  assert.equal(latestEvents([pending, precise], { batchId: manifest.batch_id, revision: manifest.revision }).get(candidate.candidate_id).review_state, "PRECISE_REVIEW_COMPLETE");
});
