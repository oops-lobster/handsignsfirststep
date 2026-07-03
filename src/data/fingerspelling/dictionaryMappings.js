import { fingerspellingLessons } from "./curriculum.js";

export const dictionaryMappings = Object.fromEntries(
  fingerspellingLessons.map(lesson => [lesson.id, {
    lessonId: lesson.id,
    query: lesson.dictionaryQuery,
    dictionaryEntryId: null,
    mappingStatus: "query-only"
  }])
);
