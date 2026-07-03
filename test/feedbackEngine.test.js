import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGeneralHandFeedback, evaluatePracticeFrame } from "../src/mediapipe/feedbackEngine.js";

const centeredHand = Array.from({ length: 21 }, (_, index) => ({
  x: 0.42 + (index % 5) * 0.04,
  y: 0.36 + Math.floor(index / 5) * 0.04,
  z: 0
}));

test("feedback handles no hand", () => {
  const feedback = evaluateGeneralHandFeedback({ hands: [] });
  assert.equal(feedback[0].state, "no_hand");
});

test("feedback limits messages to two", () => {
  const hugeOffscreen = centeredHand.map(point => ({ ...point, x: point.x + 0.5, y: point.y + 0.5 }));
  const feedback = evaluateGeneralHandFeedback({ hands: [hugeOffscreen], history: [] });
  assert.ok(feedback.length <= 2);
});

test("feedback falls back when reference is unavailable", () => {
  const feedback = evaluateGeneralHandFeedback({ hands: [centeredHand], history: [centeredHand, centeredHand, centeredHand, centeredHand], referenceAvailable: false });
  assert.ok(feedback.some(item => ["reference_unavailable", "unstable"].includes(item.state)));
});

test("practice evaluation includes learner-facing meta", () => {
  const evaluation = evaluatePracticeFrame({ hands: [centeredHand], history: [centeredHand, centeredHand, centeredHand, centeredHand], referenceAvailable: false });
  assert.equal(evaluation.meta.detected, true);
  assert.equal(evaluation.meta.handCount, 1);
  assert.equal(evaluation.meta.referenceMode, "general-camera-check");
  assert.ok(evaluation.meta.centerScore > 0);
  assert.ok(evaluation.feedback.length <= 2);
});

test("practice evaluation can use dictionary video as beginner reference", () => {
  const evaluation = evaluatePracticeFrame({ hands: [centeredHand], history: [centeredHand, centeredHand, centeredHand, centeredHand], referenceAvailable: true });
  assert.equal(evaluation.meta.referenceMode, "dictionary-video-reference");
  assert.ok(evaluation.feedback.some(item => item.state === "dictionary_reference" || item.state === "success"));
  assert.ok(evaluation.feedback.length <= 2);
});
