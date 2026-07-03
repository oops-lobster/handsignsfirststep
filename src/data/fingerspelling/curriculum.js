export const fingerspellingLessons = [
  { id: "giyeok", symbol: "ㄱ", category: "consonant", order: 1, dictionaryQuery: "ㄱ", curriculumGroup: "starter", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "nieun", symbol: "ㄴ", category: "consonant", order: 2, dictionaryQuery: "ㄴ", curriculumGroup: "starter", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "digeut", symbol: "ㄷ", category: "consonant", order: 3, dictionaryQuery: "ㄷ", curriculumGroup: "starter", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "rieul", symbol: "ㄹ", category: "consonant", order: 4, dictionaryQuery: "ㄹ", curriculumGroup: "starter", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "mieum", symbol: "ㅁ", category: "consonant", order: 5, dictionaryQuery: "ㅁ", curriculumGroup: "starter", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "bieup", symbol: "ㅂ", category: "consonant", order: 6, dictionaryQuery: "ㅂ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "siot", symbol: "ㅅ", category: "consonant", order: 7, dictionaryQuery: "ㅅ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "ieung", symbol: "ㅇ", category: "consonant", order: 8, dictionaryQuery: "ㅇ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "jieut", symbol: "ㅈ", category: "consonant", order: 9, dictionaryQuery: "ㅈ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "chieut", symbol: "ㅊ", category: "consonant", order: 10, dictionaryQuery: "ㅊ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "kieuk", symbol: "ㅋ", category: "consonant", order: 11, dictionaryQuery: "ㅋ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "tieut", symbol: "ㅌ", category: "consonant", order: 12, dictionaryQuery: "ㅌ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "pieup", symbol: "ㅍ", category: "consonant", order: 13, dictionaryQuery: "ㅍ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "hieut", symbol: "ㅎ", category: "consonant", order: 14, dictionaryQuery: "ㅎ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "a", symbol: "ㅏ", category: "vowel", order: 15, dictionaryQuery: "ㅏ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "ya", symbol: "ㅑ", category: "vowel", order: 16, dictionaryQuery: "ㅑ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "eo", symbol: "ㅓ", category: "vowel", order: 17, dictionaryQuery: "ㅓ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "yeo", symbol: "ㅕ", category: "vowel", order: 18, dictionaryQuery: "ㅕ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "o", symbol: "ㅗ", category: "vowel", order: 19, dictionaryQuery: "ㅗ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "yo", symbol: "ㅛ", category: "vowel", order: 20, dictionaryQuery: "ㅛ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "u", symbol: "ㅜ", category: "vowel", order: 21, dictionaryQuery: "ㅜ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "yu", symbol: "ㅠ", category: "vowel", order: 22, dictionaryQuery: "ㅠ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "eu", symbol: "ㅡ", category: "vowel", order: 23, dictionaryQuery: "ㅡ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" },
  { id: "i", symbol: "ㅣ", category: "vowel", order: 24, dictionaryQuery: "ㅣ", curriculumGroup: "browse", reviewStatus: "expert-review-pending", referenceFeedbackStatus: "general-only" }
].map(lesson => ({
  ...lesson,
  learningTips: ["현재 사전 영상을 중심으로 학습할 수 있어요.", "세부 손 모양 설명은 전문가 검수 후 추가될 예정이에요."],
  commonMistakes: ["전문가 검수 전", "손 모양 피드백 준비 중"]
}));

export const starterLessons = fingerspellingLessons.filter(lesson => lesson.curriculumGroup === "starter");

export function findLesson(id) {
  return fingerspellingLessons.find(lesson => lesson.id === id || lesson.symbol === id);
}
