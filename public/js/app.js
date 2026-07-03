import { LearningProgressRepository } from "/src/storage/learningProgressRepository.js";
import { buildQuiz } from "/src/data/fingerspelling/quizData.js";

const app = document.querySelector("#app");
const repo = new LearningProgressRepository(window.localStorage);

async function api(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function categoryLabel(category) {
  return category === "vowel" ? "모음" : "자음";
}

function progressSummary(lessons) {
  const progress = repo.getProgress();
  const completed = lessons.filter(lesson => progress.completedLessonIds.includes(lesson.id)).length;
  return { progress, completed, total: lessons.length, percent: lessons.length ? Math.round(completed / lessons.length * 100) : 0 };
}

function renderVideo(entry) {
  if (!entry?.videoUrl) {
    return `<div class="notice danger">사전 영상 연결 확인 중입니다. 잘못된 영상을 보여주지 않기 위해 임시로 비워두었습니다.</div>`;
  }
  return `
    <div class="videoCard">
      <video src="${html(entry.videoUrl)}" poster="${html(entry.thumbnailUrl || "")}" controls playsinline preload="metadata"></video>
      <p class="meta">${html(entry.attribution || "영상 출처: 국립국어원 한국수어사전")}</p>
      ${entry.sourceUrl ? `<a class="button ghost" href="${html(entry.sourceUrl)}" target="_blank" rel="noreferrer">원본 사전 열기</a>` : ""}
    </div>
  `;
}

function lessonCard(lesson, completedIds = []) {
  const done = completedIds.includes(lesson.id);
  return `
    <a class="lessonCard" href="/learn/fingerspelling/${lesson.id}">
      <span class="pill">${categoryLabel(lesson.category)} · ${lesson.curriculumGroup === "starter" ? "입문 과정 시범 구성" : "둘러보기"}</span>
      <span class="symbol">${html(lesson.symbol)}</span>
      <strong>${html(lesson.symbol)} 지문자</strong>
      <span class="meta">${done ? "학습 완료" : "전문가 검수 전"} · 사전 영상 연결 확인</span>
    </a>
  `;
}

async function home() {
  const { lessons } = await api("/api/lessons");
  const { progress, completed, total, percent } = progressSummary(lessons);
  const next = lessons.find(lesson => !progress.completedLessonIds.includes(lesson.id)) || lessons[0];
  app.innerHTML = `
    <section class="hero">
      <div class="panel">
        <p class="eyebrow">손으로 시작하는 첫 인사</p>
        <h1>천천히 따라 해도 괜찮아요.</h1>
        <p class="lead">손말 첫걸음은 한국수어 지문자를 처음 배우는 사용자가 국립수어사전 영상을 보고, 카메라로 손이 잘 보이는지 확인하며 연습하는 입문 학습 MVP입니다.</p>
        <div class="actions">
          <a class="button" href="/learn/fingerspelling">지문자 학습 시작</a>
          <a class="button secondary" href="${next ? `/learn/fingerspelling/${next.id}` : "/learn/fingerspelling"}">이어서 학습하기</a>
        </div>
      </div>
      <aside class="panel">
        <p class="eyebrow">오늘의 학습</p>
        <h2>${next ? `${html(next.symbol)} 지문자` : "준비 중"}</h2>
        <div class="progressBar" aria-label="전체 진행률 ${percent}%"><span style="width:${percent}%"></span></div>
        <p class="lead">${completed} / ${total}개 완료</p>
        <div class="notice">카메라 영상은 기기 안에서만 분석되며 서버에 저장되지 않습니다.</div>
      </aside>
    </section>
    <section class="sectionTitle">
      <span>Starter</span>
      <h2>첫 5개 입문 과정</h2>
      <p class="lead">교육 순서는 전문가 검수 전인 시범 구성입니다. 공식 설명처럼 보이지 않도록 사전 영상과 앱 안내를 구분합니다.</p>
    </section>
    <section class="grid">${lessons.filter(lesson => lesson.curriculumGroup === "starter").map(lesson => lessonCard(lesson, progress.completedLessonIds)).join("")}</section>
  `;
}

async function listLessons() {
  const { lessons } = await api("/api/lessons");
  const { progress, completed, total, percent } = progressSummary(lessons);
  app.innerHTML = `
    <section class="sectionTitle">
      <span>Fingerspelling</span>
      <h1>지문자 과정</h1>
      <p class="lead">자음과 모음을 나누어 보고, 연결 가능한 국립수어사전 영상을 확인합니다.</p>
      <div class="progressBar"><span style="width:${percent}%"></span></div>
      <p class="meta">${completed} / ${total}개 완료</p>
    </section>
    <h2>입문 과정 시범 구성</h2>
    <section class="grid">${lessons.filter(lesson => lesson.curriculumGroup === "starter").map(lesson => lessonCard(lesson, progress.completedLessonIds)).join("")}</section>
    <h2>전체 지문자 둘러보기</h2>
    <section class="grid">${lessons.map(lesson => lessonCard(lesson, progress.completedLessonIds)).join("")}</section>
  `;
}

async function lessonPage(id) {
  const [{ lesson }, dictionary] = await Promise.all([
    api(`/api/lessons/${encodeURIComponent(id)}`),
    api(`/api/dictionary/lesson/${encodeURIComponent(id)}`)
  ]);
  const entry = dictionary.entries?.[0];
  const quiz = buildQuiz(lesson.id);
  app.innerHTML = `
    <section class="sectionTitle">
      <span>${categoryLabel(lesson.category)} · ${lesson.reviewStatus === "expert-reviewed" ? "전문가 검수 완료" : "전문가 검수 전"}</span>
      <h1><span class="symbol">${html(lesson.symbol)}</span> 지문자 배우기</h1>
      <p class="lead">보기, 이해하기, 따라 하기, 확인하기, 완료 순서로 천천히 연습합니다.</p>
    </section>
    <div class="stepper" aria-label="학습 단계">
      ${["보기", "이해하기", "따라 하기", "확인하기", "완료"].map((step, index) => `<span data-active="${index === 0}">${step}</span>`).join("")}
    </div>
    <section class="layoutTwo">
      ${renderVideo(entry)}
      <div class="panel">
        <p class="eyebrow">이해하기</p>
        <h2>현재는 사전 영상을 중심으로 학습할 수 있어요.</h2>
        <ul class="tips">
          ${lesson.learningTips.map(tip => `<li>${html(tip)}</li>`).join("")}
          ${lesson.commonMistakes.map(item => `<li>${html(item)}</li>`).join("")}
        </ul>
        <div class="actions">
          <a class="button" href="/practice/fingerspelling/${lesson.id}">카메라로 따라 하기</a>
          <button class="secondary" id="completeLesson">학습 완료</button>
        </div>
      </div>
    </section>
    <section class="panel">
      <p class="eyebrow">확인하기</p>
      <h2>${html(quiz[0].prompt)}</h2>
      <div class="quizChoices">
        ${quiz[0].choices.map(choice => `<button class="ghost quizChoice" data-choice="${choice.id}" data-answer="${quiz[0].answerId}">${html(choice.label)}</button>`).join("")}
      </div>
      <p id="quizResult" class="lead"></p>
    </section>
  `;
  document.querySelector("#completeLesson")?.addEventListener("click", () => {
    repo.completeLesson(lesson.id);
    renderCompletion(lesson);
  });
  document.querySelectorAll(".quizChoice").forEach(button => {
    button.addEventListener("click", () => {
      const ok = button.dataset.choice === button.dataset.answer;
      document.querySelector("#quizResult").textContent = ok
        ? "좋아요. 첫걸음을 잘 마쳤어요."
        : "조금 헷갈릴 수 있어요. 영상을 다시 살펴볼까요?";
      if (ok) repo.completeQuiz(lesson.id);
    });
  });
}

function renderCompletion(lesson) {
  app.insertAdjacentHTML("beforeend", `
    <section class="panel">
      <p class="eyebrow">완료</p>
      <h2>손말과 조금 더 가까워졌어요.</h2>
      <div class="actions">
        <a class="button" href="/learn/fingerspelling">과정 목록</a>
        <a class="button secondary" href="/practice/fingerspelling/${lesson.id}">다시 연습하기</a>
      </div>
    </section>
  `);
}

async function progressPage() {
  const { lessons } = await api("/api/lessons");
  const { progress, completed, total, percent } = progressSummary(lessons);
  app.innerHTML = `
    <section class="panel">
      <p class="eyebrow">Progress</p>
      <h1>학습 진도</h1>
      <div class="progressBar"><span style="width:${percent}%"></span></div>
      <p class="lead">${completed} / ${total}개 지문자를 완료했어요.</p>
      <p>최근 학습: ${progress.recentLessonIds.length ? progress.recentLessonIds.map(html).join(", ") : "아직 없습니다."}</p>
      <div class="actions"><button id="resetProgress" class="ghost">진도 초기화</button></div>
    </section>
  `;
  document.querySelector("#resetProgress")?.addEventListener("click", () => {
    repo.resetProgress();
    progressPage();
  });
}

function aboutPage() {
  app.innerHTML = `
    <section class="panel">
      <p class="eyebrow">About</p>
      <h1>손말 첫걸음은 공식 평가 도구가 아닙니다.</h1>
      <p class="lead">이 앱은 한국수어 지문자를 처음 접하는 사용자가 사전 영상을 보고 반복 연습하도록 돕는 학습 MVP입니다. 통역 서비스가 아니며, 모든 손 모양을 정확하게 판정하지 않습니다.</p>
      <div class="grid">
        <article class="card"><strong>카메라 개인정보</strong><p>카메라 영상은 기기 안에서만 분석되며 서버에 저장되지 않습니다.</p></article>
        <article class="card"><strong>출처</strong><p>수어 영상은 국립국어원 한국수어사전 자료를 API로 연결해 표시합니다.</p></article>
        <article class="card"><strong>검수 필요</strong><p>세부 손 모양 설명과 기준 landmark는 농인 당사자 및 한국수어 전문가 검수가 필요합니다.</p></article>
      </div>
    </section>
  `;
}

function devReferenceCapture() {
  app.innerHTML = `
    <section class="panel">
      <p class="eyebrow">Development only</p>
      <h1>Reference Capture</h1>
      <p class="lead">이 페이지는 개발 환경에서 normalized landmark sample 형식을 확인하기 위한 자리입니다. production에서는 일반 사용자에게 노출하지 않는 것을 전제로 합니다.</p>
      <a class="button" href="/practice/fingerspelling/giyeok">카메라 연습 화면에서 수집 흐름 확인</a>
    </section>
  `;
}

function practiceRoute(id) {
  import("/js/practice.js").then(module => module.renderPractice(app, id, repo));
}

async function render() {
  const path = window.location.pathname;
  try {
    if (path === "/") return await home();
    if (path === "/learn/fingerspelling") return await listLessons();
    if (path.startsWith("/learn/fingerspelling/")) return await lessonPage(decodeURIComponent(path.split("/").pop()));
    if (path.startsWith("/practice/fingerspelling/")) return practiceRoute(decodeURIComponent(path.split("/").pop()));
    if (path === "/progress") return await progressPage();
    if (path === "/about") return aboutPage();
    if (path === "/dev/reference-capture") return devReferenceCapture();
    return await home();
  } catch (error) {
    app.innerHTML = `<section class="panel danger"><h1>페이지를 불러오지 못했어요.</h1><p>${html(error.message)}</p></section>`;
  }
}

render();
