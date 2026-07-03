import { LearningProgressRepository } from "/src/storage/learningProgressRepository.js";
import { buildQuiz } from "/src/data/fingerspelling/quizData.js";

const app = document.querySelector("#app");
const repo = new LearningProgressRepository(window.localStorage);
const isLocalDevelopment = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

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

function renderQuizCard(item, index) {
  return `
    <article class="quizCard" data-quiz-id="${html(item.id)}">
      <p class="eyebrow">${index === 0 ? "확인" : `문항 ${index + 1}`}</p>
      <h3>${html(item.prompt)}</h3>
      ${item.imageUrl ? `<img class="quizImage" src="${html(item.imageUrl)}" alt="오늘 배운 지문자 기준 이미지">` : ""}
      <div class="quizChoices">
        ${item.choices.map(choice => `<button class="ghost quizChoice" data-quiz-id="${html(item.id)}" data-choice="${html(choice.id)}" data-answer="${html(item.answerId)}">${html(choice.label)}</button>`).join("")}
      </div>
      <p id="quizResult-${html(item.id)}" class="lead quizResult" aria-live="polite"></p>
    </article>
  `;
}

function renderLessonStepper(lessonId, currentStep, { practicePassed = true } = {}) {
  const steps = [
    ["보기", `/learn/fingerspelling/${lessonId}#watch`],
    ["손모양 익히기", `/learn/fingerspelling/${lessonId}#understand`],
    ["따라 하기", `/practice/fingerspelling/${lessonId}`],
    ["확인하기", practicePassed ? `/learn/fingerspelling/${lessonId}#quiz` : ""],
    ["완료", `/learn/fingerspelling/${lessonId}#complete`]
  ];
  return `
    <nav class="stepper" aria-label="학습 단계">
      ${steps.map(([step, href]) => step === currentStep
        ? `<span data-active="true" aria-current="step">${step}</span>`
        : !href
          ? `<span aria-disabled="true">${step}</span>`
        : `<a href="${html(href)}">${step}</a>`).join("")}
    </nav>
  `;
}

function lessonStageFromHash() {
  const stage = window.location.hash.slice(1);
  return ["watch", "understand", "quiz", "complete"].includes(stage) ? stage : "watch";
}

function lessonStageLabel(stage) {
  return {
    watch: "보기",
    understand: "손모양 익히기",
    quiz: "확인하기",
    complete: "완료"
  }[stage] || "보기";
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
  const quiz = buildQuiz(lesson.id).map((item, index) => index === 0
    ? { ...item, imageUrl: entry?.thumbnailUrl || "", prompt: "이 사진이 나타내는 지문자는 무엇일까요?" }
    : item);
  const stage = lessonStageFromHash();
  const progress = repo.getProgress();
  const isCompleted = progress.completedLessonIds.includes(lesson.id);
  const practicePassed = progress.practicePassedLessonIds.includes(lesson.id);
  let stageMarkup = "";

  if (stage === "watch") {
    stageMarkup = `
      <section id="watch" class="learningStage singleStage">
        <p class="eyebrow">보기</p>
        ${renderVideo(entry)}
        <div class="stageNav">
          <a class="button secondary" href="/learn/fingerspelling/${lesson.id}#understand">다음: 손모양 익히기</a>
        </div>
      </section>
    `;
  }

  if (stage === "understand") {
    stageMarkup = `
      <section id="understand" class="panel learningStage singleStage">
        <p class="eyebrow">손모양 익히기</p>
        <h2>${html(lesson.symbol)} 손모양에서 먼저 볼 부분</h2>
        <p class="lead">영상을 보기만 하고 바로 따라 하면 손가락 방향을 놓치기 쉬워요. 이 단계에서는 따라 하기 전에 손의 기준점을 먼저 확인합니다.</p>
        <ul class="tips">
          ${lesson.learningTips.map(tip => `<li>${html(tip)}</li>`).join("")}
          ${lesson.commonMistakes.map(item => `<li>${html(item)}</li>`).join("")}
        </ul>
        <div class="stageNav">
          <a class="button secondary" href="/learn/fingerspelling/${lesson.id}#watch">이전: 보기</a>
          <a class="button" href="/practice/fingerspelling/${lesson.id}">다음: 따라 하기</a>
        </div>
      </section>
    `;
  }

  if (stage === "quiz") {
    stageMarkup = practicePassed
      ? `
        <section id="quiz" class="panel learningStage singleStage">
          <p class="eyebrow">확인하기</p>
          <h2>오늘 배운 지문자를 골라보세요.</h2>
          <div class="quizStack">
            ${quiz.map(renderQuizCard).join("")}
          </div>
          <div class="stageNav">
            <a class="button secondary" href="/practice/fingerspelling/${lesson.id}">이전: 따라 하기</a>
            <button id="completeLesson">완료 저장</button>
          </div>
        </section>
      `
      : `
        <section id="quiz" class="panel learningStage singleStage">
          <p class="eyebrow">확인하기 잠김</p>
          <h2>아직! 학습이 덜 되었어요.</h2>
          <p class="lead">사전 설명의 손가락 조건과 맞으면 확인하기가 열립니다. 먼저 따라 하기에서 손모양을 맞춰보세요.</p>
          <div class="actions">
            <a class="button" href="/practice/fingerspelling/${lesson.id}">따라 하기에서 다시 해보기</a>
            <a class="button secondary" href="/learn/fingerspelling/${lesson.id}#understand">손모양 다시 보기</a>
          </div>
        </section>
      `;
  }

  if (stage === "complete") {
    stageMarkup = isCompleted
      ? `
        <section id="complete" class="panel learningStage singleStage">
          <p class="eyebrow">완료</p>
          <h2>${html(lesson.symbol)} 지문자를 마쳤어요.</h2>
          <p class="lead">손말과 조금 더 가까워졌어요. 천천히 반복하면 자연스럽게 익숙해질 거예요.</p>
          <div class="actions">
            <a class="button" href="/learn/fingerspelling">과정 목록</a>
            <a class="button secondary" href="/practice/fingerspelling/${lesson.id}">다시 연습하기</a>
          </div>
        </section>
      `
      : `
        <section id="complete" class="panel learningStage singleStage">
          <p class="eyebrow">완료</p>
          <h2>아직 완료 전이에요.</h2>
          <p class="lead">확인하기를 마치고 완료 저장을 누르면 진도에 기록됩니다.</p>
          <div class="actions">
            <a class="button" href="/learn/fingerspelling/${lesson.id}#quiz">확인하기로 이동</a>
          </div>
        </section>
      `;
  }

  app.innerHTML = `
    <section class="sectionTitle">
      <span>${categoryLabel(lesson.category)} · ${lesson.reviewStatus === "expert-reviewed" ? "전문가 검수 완료" : "전문가 검수 전"}</span>
      <h1><span class="symbol">${html(lesson.symbol)}</span> 지문자 배우기</h1>
      <p class="lead">보기, 손모양 익히기, 따라 하기, 확인하기, 완료 순서로 천천히 연습합니다.</p>
    </section>
    ${renderLessonStepper(lesson.id, lessonStageLabel(stage), { practicePassed })}
    ${stageMarkup}
  `;
  document.querySelector("#completeLesson")?.addEventListener("click", () => {
    repo.completeLesson(lesson.id);
    if (window.location.hash === "#complete") lessonPage(lesson.id);
    else window.location.hash = "complete";
  });
  document.querySelectorAll(".quizChoice").forEach(button => {
    button.addEventListener("click", () => {
      const ok = button.dataset.choice === button.dataset.answer;
      const result = document.getElementById(`quizResult-${button.dataset.quizId}`);
      result.textContent = ok
        ? "좋아요. 첫걸음을 잘 마쳤어요."
        : "조금 헷갈릴 수 있어요. 영상을 다시 살펴볼까요?";
      button.closest(".quizCard")?.querySelectorAll(".quizChoice").forEach(choice => {
        choice.setAttribute("aria-pressed", String(choice === button));
      });
      const solvedCount = [...document.querySelectorAll(".quizResult")]
        .filter(item => item.textContent.includes("좋아요")).length;
      if (ok && solvedCount >= quiz.length) {
        repo.completeQuiz(lesson.id);
        document.querySelector("#completeLesson")?.focus();
      }
    });
  });
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
        <article class="card"><strong>검수 필요</strong><p>세부 손 모양 설명과 기준 손 위치 데이터는 농인 당사자 및 한국수어 전문가 검수가 필요합니다.</p></article>
      </div>
    </section>
  `;
}

function devReferenceCapture() {
  app.innerHTML = `
    <section class="panel">
      <p class="eyebrow">Development only</p>
      <h1>Reference Capture</h1>
      <p class="lead">이 페이지는 개발 환경에서 기준 손 위치 데이터 형식을 확인하기 위한 자리입니다. production에서는 일반 사용자에게 노출하지 않는 것을 전제로 합니다.</p>
      <a class="button" href="/practice/fingerspelling/giyeok">카메라 연습 화면에서 수집 흐름 확인</a>
    </section>
  `;
}

function practiceRoute(id) {
  app.innerHTML = `
    <section class="panel">
      <p class="eyebrow">Practice</p>
      <h1>연습 화면을 준비하고 있어요.</h1>
      <p class="lead">국립수어사전 기준 영상을 불러오는 중입니다. 잠시만 기다려 주세요.</p>
      <div class="notice">카메라 영상은 기기 안에서만 분석되며 서버에 저장되지 않습니다.</div>
    </section>
  `;
  import("/js/practice.js?v=20260703-practice-meta")
    .then(module => module.renderPractice(app, id, repo))
    .catch(error => {
      app.innerHTML = `<section class="panel danger"><h1>연습 화면을 불러오지 못했어요.</h1><p>${html(error.message)}</p></section>`;
    });
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
    if (path === "/dev/reference-capture") return isLocalDevelopment ? devReferenceCapture() : aboutPage();
    return await home();
  } catch (error) {
    app.innerHTML = `<section class="panel danger"><h1>페이지를 불러오지 못했어요.</h1><p>${html(error.message)}</p></section>`;
  }
}

window.addEventListener("hashchange", () => {
  render();
});

render();
