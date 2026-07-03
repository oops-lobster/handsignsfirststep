import { starterLessons } from "./curriculum.js";

function symbolChoices(target) {
  const distractors = starterLessons.filter(lesson => lesson.id !== target.id);
  const mixed = distractors.slice(0, 2).concat(target, distractors.slice(2));

  return mixed.map(lesson => ({ id: lesson.id, label: lesson.symbol }));
}

export function buildQuiz(lessonId) {
  const target = starterLessons.find(lesson => lesson.id === lessonId) || starterLessons[0];

  return [
    {
      id: `${target.id}-symbol`,
      prompt: "오늘 배운 게 뭘까요?",
      choices: symbolChoices(target),
      answerId: target.id
    }
  ];
}
