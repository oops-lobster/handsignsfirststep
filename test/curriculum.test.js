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

test("starter quiz asks a focused mixed-choice symbol question", () => {
  const quiz = buildQuiz(starterLessons[0].id);
  assert.equal(quiz.length, 1);
  assert.equal(quiz[0].prompt, "오늘 배운 게 뭘까요?");
  assert.equal(quiz[0].choices.length, starterLessons.length);
  assert.ok(quiz[0].choices.some(choice => choice.id === quiz[0].answerId));
  assert.notEqual(quiz[0].choices[0].id, quiz[0].answerId);
});
