import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BoundaryController } from "../src/player/boundaryController.js";
import { frameToLocalTime, frameToSourceTime, nearestFrame, stepFrame, validateFrameMap } from "../src/player/frameMap.js";

const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../../fixtures/review_batch_manifest.json", import.meta.url)), "utf8"));
const candidate = manifest.candidates[0];

test("synthetic CFR frame map includes first, second, and last frame", () => {
  assert.deepEqual(validateFrameMap(candidate), { ok: true, code: "FRAME_MAP_VALID" });
  assert.equal(frameToLocalTime(candidate, 0), 0);
  assert.equal(frameToLocalTime(candidate, 1), 0.033333);
  assert.equal(frameToLocalTime(candidate, 23), 0.766667);
  assert.equal(frameToSourceTime(candidate, 9), 10.5);
  assert.equal(frameToSourceTime(candidate, 15), 10.7);
});

test("frame stepping clamps ±1 and ±5 at clip boundaries", () => {
  assert.equal(stepFrame(candidate, 0, -5), 0);
  assert.equal(stepFrame(candidate, 9, -1), 8);
  assert.equal(stepFrame(candidate, 9, 5), 14);
  assert.equal(stepFrame(candidate, 23, 5), 23);
});

test("nearest frame uses PTS rather than frame divided by nominal FPS", () => {
  assert.equal(nearestFrame(candidate, 0.034), 1);
  assert.equal(nearestFrame(candidate, 0.76), 23);
});

test("annotation initializes boundaries and source timestamp mapping", () => {
  const controller = new BoundaryController(candidate);
  assert.deepEqual(controller.snapshot(), {
    boundary_status: "KEEP_ORIGINAL",
    manual_start_local_frame: 9,
    manual_end_local_frame: 15,
    manual_start_source_sec: 10.5,
    manual_end_source_sec: 10.7,
    approved_start_local_frame: 9,
    approved_end_local_frame: 15,
    approved_start_source_sec: 10.5,
    approved_end_source_sec: 10.7
  });
  controller.setStart(8);
  controller.setEnd(16);
  assert.equal(controller.status, "MODIFIED");
  assert.equal(controller.snapshot().approved_start_source_sec, 10.466667);
  assert.equal(controller.snapshot().approved_end_source_sec, 10.733333);
  controller.resetToAnnotation();
  assert.equal(controller.status, "KEEP_ORIGINAL");
});

test("missing, mismatched, and VFR maps fail closed", () => {
  assert.equal(validateFrameMap({ ...candidate, frame_pts_sec: null }).code, "FRAME_MAP_MISSING");
  assert.equal(validateFrameMap({ ...candidate, frame_count: 25 }).code, "FRAME_COUNT_MISMATCH");
  assert.equal(validateFrameMap({ ...candidate, fps_mode: "VFR" }).code, "VARIABLE_FRAME_RATE_UNSUPPORTED");
});
