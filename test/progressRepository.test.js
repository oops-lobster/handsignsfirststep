import test from "node:test";
import assert from "node:assert/strict";
import { LearningProgressRepository } from "../src/storage/learningProgressRepository.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => map.get(key) || null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key)
  };
}

test("progress stores completed lessons", () => {
  const repo = new LearningProgressRepository(memoryStorage());
  repo.completeLesson("giyeok");
  assert.deepEqual(repo.getProgress().completedLessonIds, ["giyeok"]);
});

test("progress stores practice pass before quiz", () => {
  const repo = new LearningProgressRepository(memoryStorage());
  repo.markDictionaryPracticePassed("giyeok");
  assert.deepEqual(repo.getProgress().dictionaryPracticePassedLessonIds, ["giyeok"]);
});

test("progress resets invalid schema", () => {
  const storage = memoryStorage();
  storage.setItem("handsigns-first-step-progress", JSON.stringify({ schemaVersion: 999, completedLessonIds: ["x"] }));
  const repo = new LearningProgressRepository(storage);
  assert.deepEqual(repo.getProgress().completedLessonIds, []);
});

test("settings update keeps defaults", () => {
  const repo = new LearningProgressRepository(memoryStorage());
  repo.updateSettings({ showLandmarks: false });
  assert.equal(repo.getProgress().settings.showLandmarks, false);
  assert.equal(repo.getProgress().settings.mirrorCamera, true);
});
