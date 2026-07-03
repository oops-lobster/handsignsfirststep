import { starterLessons } from "./curriculum.js";

export function buildQuiz(lessonId) {
  const target = starterLessons.find(lesson => lesson.id === lessonId) || starterLessons[0];
  const choices = starterLessons
    .filter(lesson => lesson.id !== target.id)
    .slice(0, 3)
    .concat(target)
    .sort((a, b) => a.order - b.order);

  return [
    {
      id: `${target.id}-symbol`,
      prompt: "방금 본 지문자는 무엇인가요?",
      choices: choices.map(lesson => ({ id: lesson.id, label: lesson.symbol })),
      answerId: target.id
    }
  ];
}
