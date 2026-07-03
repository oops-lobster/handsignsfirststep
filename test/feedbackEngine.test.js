import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGeneralHandFeedback, evaluatePracticeFrame } from "../src/mediapipe/feedbackEngine.js";

const centeredHand = Array.from({ length: 21 }, (_, index) => ({
  x: 0.42 + (index % 5) * 0.04,
  y: 0.36 + Math.floor(index / 5) * 0.04,
  z: 0
}));

const allExtendedHand = [
  { x: 0.5, y: 0.75, z: 0 },
  { x: 0.43, y: 0.69, z: 0 },
  { x: 0.37, y: 0.63, z: 0 },
  { x: 0.31, y: 0.57, z: 0 },
  { x: 0.25, y: 0.51, z: 0 },
  { x: 0.44, y: 0.62, z: 0 },
  { x: 0.44, y: 0.5, z: 0 },
  { x: 0.44, y: 0.38, z: 0 },
  { x: 0.44, y: 0.26, z: 0 },
  { x: 0.5, y: 0.62, z: 0 },
  { x: 0.5, y: 0.49, z: 0 },
  { x: 0.5, y: 0.36, z: 0 },
  { x: 0.5, y: 0.23, z: 0 },
  { x: 0.56, y: 0.62, z: 0 },
  { x: 0.56, y: 0.5, z: 0 },
  { x: 0.56, y: 0.38, z: 0 },
  { x: 0.56, y: 0.26, z: 0 },
  { x: 0.62, y: 0.62, z: 0 },
  { x: 0.62, y: 0.51, z: 0 },
  { x: 0.62, y: 0.4, z: 0 },
  { x: 0.62, y: 0.29, z: 0 }
];

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
  assert.equal(evaluation.meta.practicePassed, false);
  assert.ok(evaluation.feedback.length <= 2);
});

test("practice success requires parsed dictionary finger conditions", () => {
  const evaluation = evaluatePracticeFrame({
    hands: [allExtendedHand],
    history: [allExtendedHand, allExtendedHand, allExtendedHand, allExtendedHand],
    referenceAvailable: true,
    dictionaryDescription: "오른 주먹의 1·2·3·4·5지를 펴서 세운다."
  });

  assert.equal(evaluation.meta.rubricAvailable, true);
  assert.equal(evaluation.meta.practicePassed, true);
  assert.equal(evaluation.meta.primaryState, "success");
});

test("practice does not pass when dictionary finger conditions are missing", () => {
  const evaluation = evaluatePracticeFrame({
    hands: [centeredHand],
    history: [centeredHand, centeredHand, centeredHand, centeredHand],
    referenceAvailable: true,
    dictionaryDescription: "오른손을 자연스럽게 움직인다."
  });

  assert.equal(evaluation.meta.rubricAvailable, false);
  assert.equal(evaluation.meta.practicePassed, false);
  assert.notEqual(evaluation.meta.primaryState, "success");
});
