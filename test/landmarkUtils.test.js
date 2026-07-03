import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateHandBoundingBox,
  calculateJointAngle,
  calculateReferenceSimilarity,
  getFingerExtensionState,
  normalizeLandmarks
} from "../src/mediapipe/landmarkUtils.js";

const sampleHand = Array.from({ length: 21 }, (_, index) => ({
  x: 0.4 + index * 0.01,
  y: 0.5 - index * 0.008,
  z: 0
}));

test("calculateHandBoundingBox returns normalized bounds", () => {
  const box = calculateHandBoundingBox(sampleHand);
  assert.equal(Number(box.minX.toFixed(2)), 0.4);
  assert.equal(Number(box.maxX.toFixed(2)), 0.6);
  assert.ok(box.width > 0);
  assert.ok(box.height > 0);
});

test("normalizeLandmarks uses wrist-relative coordinates", () => {
  const normalized = normalizeLandmarks(sampleHand);
  assert.equal(normalized[0].x, 0);
  assert.equal(normalized[0].y, 0);
  assert.equal(normalized.length, 21);
});

test("calculateJointAngle handles a right angle", () => {
  const angle = calculateJointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 });
  assert.equal(Math.round(angle), 90);
});

test("getFingerExtensionState returns all fingers", () => {
  const state = getFingerExtensionState(sampleHand);
  assert.deepEqual(Object.keys(state), ["thumb", "index", "middle", "ring", "pinky"]);
});

test("calculateReferenceSimilarity returns one for identical samples", () => {
  const similarity = calculateReferenceSimilarity(sampleHand, sampleHand);
  assert.equal(similarity, 1);
});
