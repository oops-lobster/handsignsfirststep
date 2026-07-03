import test from "node:test";
import assert from "node:assert/strict";
import { fingerspellingLessons, starterLessons } from "../src/data/fingerspelling/curriculum.js";

test("curriculum has starter lessons", () => {
  assert.equal(starterLessons.length, 5);
});

test("curriculum lesson ids are unique", () => {
  const ids = new Set(fingerspellingLessons.map(lesson => lesson.id));
  assert.equal(ids.size, fingerspellingLessons.length);
});

test("curriculum does not pretend expert review", () => {
  assert.ok(fingerspellingLessons.every(lesson => lesson.reviewStatus !== "expert-reviewed"));
});
