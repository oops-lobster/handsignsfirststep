export const defaultProgress = {
  schemaVersion: 1,
  completedLessonIds: [],
  quizCompletedLessonIds: [],
  practicePassedLessonIds: [],
  lastLessonId: "",
  reviewLessonIds: [],
  recentLessonIds: [],
  settings: {
    showLandmarks: true,
    mirrorCamera: true
  },
  cameraNoticeAccepted: false,
  firstVisitSeen: false
};

export class LearningProgressRepository {
  constructor(storage, key = "handsigns-first-step-progress") {
    this.storage = storage;
    this.key = key;
  }

  getProgress() {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return structuredClone(defaultProgress);
      const parsed = JSON.parse(raw);
      if (parsed.schemaVersion !== 1) return structuredClone(defaultProgress);
      return { ...structuredClone(defaultProgress), ...parsed, settings: { ...defaultProgress.settings, ...parsed.settings } };
    } catch {
      return structuredClone(defaultProgress);
    }
  }

  save(progress) {
    this.storage?.setItem(this.key, JSON.stringify(progress));
    return progress;
  }

  completeLesson(lessonId) {
    const progress = this.getProgress();
    if (!progress.completedLessonIds.includes(lessonId)) progress.completedLessonIds.push(lessonId);
    this.saveLastLesson(lessonId, progress);
    return this.save(progress);
  }

  completeQuiz(lessonId) {
    const progress = this.getProgress();
    if (!progress.quizCompletedLessonIds.includes(lessonId)) progress.quizCompletedLessonIds.push(lessonId);
    this.saveLastLesson(lessonId, progress);
    return this.save(progress);
  }

  markPracticePassed(lessonId) {
    const progress = this.getProgress();
    if (!progress.practicePassedLessonIds.includes(lessonId)) progress.practicePassedLessonIds.push(lessonId);
    this.saveLastLesson(lessonId, progress);
    return this.save(progress);
  }

  saveLastLesson(lessonId, current = this.getProgress()) {
    current.lastLessonId = lessonId;
    current.recentLessonIds = [lessonId, ...current.recentLessonIds.filter(id => id !== lessonId)].slice(0, 6);
    return this.save(current);
  }

  addReviewLesson(lessonId) {
    const progress = this.getProgress();
    if (!progress.reviewLessonIds.includes(lessonId)) progress.reviewLessonIds.push(lessonId);
    return this.save(progress);
  }

  updateSettings(settings) {
    const progress = this.getProgress();
    progress.settings = { ...progress.settings, ...settings };
    return this.save(progress);
  }

  resetProgress() {
    return this.save(structuredClone(defaultProgress));
  }
}
