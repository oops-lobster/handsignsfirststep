import { starterLessons } from "./curriculum.js";

function choiceSet(target, offset = 0) {
  const distractors = starterLessons
    .filter(lesson => lesson.id !== target.id)
    .slice(offset)
    .concat(starterLessons.filter(lesson => lesson.id !== target.id).slice(0, offset))
    .slice(0, 3);

  return distractors
    .concat(target)
    .sort((a, b) => a.order - b.order)
    .map(lesson => ({ id: lesson.id, label: lesson.symbol }));
}

export function buildQuiz(lessonId) {
  const target = starterLessons.find(lesson => lesson.id === lessonId) || starterLessons[0];

  return [
    {
      id: `${target.id}-symbol`,
      prompt: "방금 본 지문자는 무엇인가요?",
      choices: choiceSet(target),
      answerId: target.id
    },
    {
      id: `${target.id}-shape`,
      prompt: `기준 영상에서 연습한 글자는 어느 모양인가요?`,
      choices: choiceSet(target, 1),
      answerId: target.id
    },
    {
      id: `${target.id}-review`,
      prompt: "오늘 다시 한 번 확인할 지문자를 골라보세요.",
      choices: choiceSet(target, 2),
      answerId: target.id
    }
  ];
}
