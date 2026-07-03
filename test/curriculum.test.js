import test from "node:test";
import assert from "node:assert/strict";
import { fingerspellingLessons, starterLessons } from "../src/data/fingerspelling/curriculum.js";
import { buildQuiz } from "../src/data/fingerspelling/quizData.js";

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

test("starter quiz has three to five questions", () => {
  const quiz = buildQuiz(starterLessons[0].id);
  assert.ok(quiz.length >= 3);
  assert.ok(quiz.length <= 5);
  assert.ok(quiz.every(item => item.choices.some(choice => choice.id === item.answerId)));
});
