import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGeneralHandFeedback } from "../src/mediapipe/feedbackEngine.js";

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
