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

const rumiImages = {
  idle: "/assets/rumi/transparent/rumi_idle.png",
  happy: "/assets/rumi/transparent/rumi_happy.png",
  cheer: "/assets/rumi/transparent/rumi_cheer.png",
  sad: "/assets/rumi/transparent/rumi_sad.png",
  surprised: "/assets/rumi/transparent/rumi_surprised.png",
  thinking: "/assets/rumi/transparent/rumi_thinking.png",
  encourage: "/assets/rumi/transparent/rumi_encourage.png",
  confident: "/assets/rumi/transparent/rumi_confident.png"
};

function rumiMascot(emotion = "idle", size = "md", withGlow = false) {
  const src = rumiImages[emotion] || rumiImages.idle;
  return `<img class="rumiMascot rumiMascot--${html(size)}${withGlow ? " withGlow" : ""}" src="${html(src)}" alt="손말 요정 루미">`;
}

function rumiSpeechBubble({ emotion = "idle", eyebrow = "루미의 안내", message, actionLabel, href }) {
  return `
    <div class="rumiTalk">
      ${rumiMascot(emotion, "sm", true)}
      <div class="speechBubble">
        <p class="eyebrow">${html(eyebrow)}</p>
        <p>${html(message)}</p>
        ${actionLabel && href ? `<a class="palmButton palmButton--small" href="${html(href)}">${html(actionLabel)}</a>` : ""}
      </div>
    </div>
  `;
}

function bubbleLearningMap(steps) {
  return `
    <section class="learningMap" aria-label="루미와 함께 가는 학습 지도">
      ${steps.map((step, index) => `
        <a class="mapNode mapNode--${html(step.status)}" href="${html(step.href)}" aria-label="${html(step.title)} ${html(step.statusLabel)}">
          <span class="nodeIcon" aria-hidden="true">${html(step.icon || "손")}</span>
          <span class="nodeText">
            <strong>${html(step.title)}</strong>
            <small>${html(step.description)}</small>
          </span>
          <span class="nodeBadge">${html(step.statusLabel)}</span>
        </a>
        ${index < steps.length - 1 ? `<span class="glowPath" aria-hidden="true"></span>` : ""}
      `).join("")}
    </section>
  `;
}

function handLetterPad(lessons, completedIds = []) {
  return `
    <section class="handLetterPad" aria-label="지문자 손바닥 선택">
      ${lessons.map(lesson => {
        const done = completedIds.includes(lesson.id);
        return `
          <a class="palmTile${done ? " isDone" : ""}" href="/learn/fingerspelling/${html(lesson.id)}" aria-label="${html(lesson.symbol)} 지문자 배우기">
            <span class="palmStatus">${done ? "빛 획득" : categoryLabel(lesson.category)}</span>
            <span class="palmSymbol">${html(lesson.symbol)}</span>
            <strong>${html(lesson.symbol)} 손말</strong>
          </a>
        `;
      }).join("")}
    </section>
  `;
}

function missionPortals() {
  const missions = [
    ["학교", "교실에서 쓰는 첫 표현", "school"],
    ["자기소개", "이름과 인사 표현", "intro"],
    ["길찾기", "방향을 묻는 표현", "transport"],
    ["응급상황", "도움이 필요할 때", "emergency"]
  ];
  return `
    <section class="missionPortals" aria-label="상황 미션">
      ${missions.map(([title, desc, type]) => `
        <button class="missionPortal" type="button" data-mission="${html(type)}">
          <span class="portalSticker" aria-hidden="true">✦</span>
          <strong>${html(title)}</strong>
          <small>${html(desc)}</small>
          <span>루미와 들어가기</span>
        </button>
      `).join("")}
    </section>
  `;
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
    <div class="videoBubble">
      <video src="${html(entry.videoUrl)}" poster="${html(entry.thumbnailUrl || "")}" controls playsinline preload="metadata"></video>
      <p class="meta">${html(entry.attribution || "영상 출처: 국립국어원 한국수어사전")}</p>
      ${entry.sourceUrl ? `<a class="button ghost" href="${html(entry.sourceUrl)}" target="_blank" rel="noreferrer">원본 사전 열기</a>` : ""}
    </div>
  `;
}

function renderQuizCard(item, index) {
  return `
    <article class="quizCard speechBubble quizBubble" data-quiz-id="${html(item.id)}">
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
    <a class="lessonCard mapNode mapNode--${done ? "done" : "current"}" href="/learn/fingerspelling/${lesson.id}">
      <span class="nodeIcon" aria-hidden="true">${done ? "✓" : "손"}</span>
      <span class="nodeText">
        <span class="symbol">${html(lesson.symbol)}</span>
        <strong>${html(lesson.symbol)} 지문자</strong>
        <small>${done ? "학습 완료" : `${categoryLabel(lesson.category)} · 사전 영상 보기`}</small>
      </span>
      <span class="nodeBadge">${done ? "완료" : "시작"}</span>
    </a>
  `;
}

async function home() {
  app.innerHTML = `
    <section class="introScreen" aria-labelledby="introTitle">
      <div class="introLogo">
        <img src="/assets/rumi/logo/rumi_app_logo.png" alt="손말 첫걸음 루미 로고">
        <span>손말 첫걸음</span>
      </div>

      <div class="introStage" aria-hidden="true">
        <img class="introRumi introRumi--one" src="${html(rumiImages.happy)}" alt="">
        <img class="introRumi introRumi--two" src="${html(rumiImages.cheer)}" alt="">
        <img class="introRumi introRumi--three" src="${html(rumiImages.encourage)}" alt="">
        <img class="introRumi introRumi--four" src="${html(rumiImages.idle)}" alt="">
      </div>

      <div class="introCopy">
        <p class="eyebrow">Rumi Intro</p>
        <h1 id="introTitle">수어는 자막입니다.</h1>
        <p class="lead">루미는 손말을 배울 때 길을 밝혀주는 작은 빛이에요. 오늘은 한 글자만 천천히 보고, 따라 하고, 확인해요.</p>
        <div class="introActions">
          <a class="palmButton" href="/learn/fingerspelling">학습 시작</a>
          <a class="palmButton palmButton--soft" href="/progress">내 빛 보기</a>
        </div>
      </div>
    </section>
  `;
}

async function listLessons() {
  const { lessons } = await api("/api/lessons");
  const { progress, completed, total, percent } = progressSummary(lessons);
  const starterLessons = lessons.filter(lesson => lesson.curriculumGroup === "starter");
  const remainingLessons = lessons.filter(lesson => lesson.curriculumGroup !== "starter");
  app.innerHTML = `
    <section class="listIntro">
      <div class="listIntroMascot">
        ${rumiMascot("happy", "md", true)}
      </div>
      <div class="speechBubble listIntroBubble">
        <p class="eyebrow">지문자 배우기</p>
        <h1>오늘 배울 손말 하나를 골라요</h1>
        <p class="lead">이 화면의 기능은 하나입니다. 손바닥 버튼을 눌러 한 글자의 보기, 따라 하기, 확인하기로 이동합니다.</p>
        <div class="progressPebble" aria-label="전체 진행률 ${percent}%">
          <span>모은 빛</span>
          <strong>${completed} / ${total}</strong>
          <div class="progressBar"><span style="width:${percent}%"></span></div>
        </div>
      </div>
    </section>
    <section class="sectionTitle contentRail">
      <span>Starter</span>
      <h2>입문 손바닥 길</h2>
      <p class="lead">처음 5개는 루미가 먼저 안내하는 시범 과정입니다.</p>
    </section>
    <div class="contentRail">
      ${handLetterPad(starterLessons, progress.completedLessonIds)}
    </div>
    <section class="sectionTitle contentRail">
      <span>All Letters</span>
      <h2>다음 글자들</h2>
      <p class="lead">입문 과정을 마친 뒤 하나씩 열어볼 수 있는 지문자입니다.</p>
    </section>
    <section class="bubbleList contentRail">${remainingLessons.map(lesson => lessonCard(lesson, progress.completedLessonIds)).join("")}</section>
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
  const practicePassed = progress.dictionaryPracticePassedLessonIds.includes(lesson.id);
  let stageMarkup = "";

  if (stage === "watch") {
    stageMarkup = `
      <section id="watch" class="learningStage singleStage stageBubble">
        <p class="eyebrow">보기</p>
        ${rumiSpeechBubble({
          emotion: "idle",
          eyebrow: "루미의 보기 안내",
          message: "먼저 사전 영상을 끝까지 보며 손가락과 손바닥 방향을 살펴봐요."
        })}
        ${renderVideo(entry)}
        <div class="stageNav">
          <a class="palmButton palmButton--soft" href="/learn/fingerspelling/${lesson.id}#understand">다음: 손모양 익히기</a>
        </div>
      </section>
    `;
  }

  if (stage === "understand") {
    stageMarkup = `
      <section id="understand" class="learningStage singleStage stageBubble">
        <p class="eyebrow">손모양 익히기</p>
        <h2>${html(lesson.symbol)} 손모양에서 먼저 볼 부분</h2>
        <p class="lead">영상을 보기만 하고 바로 따라 하면 손가락 방향을 놓치기 쉬워요. 이 단계에서는 따라 하기 전에 손의 기준점을 먼저 확인합니다.</p>
        ${rumiSpeechBubble({
          emotion: "thinking",
          eyebrow: "루미의 힌트",
          message: "손가락이 펴졌는지, 접혔는지, 손바닥이 어디를 보는지 차례대로 봐요."
        })}
        <ul class="tips speechBubble miniBubble">
          ${lesson.learningTips.map(tip => `<li>${html(tip)}</li>`).join("")}
          ${lesson.commonMistakes.map(item => `<li>${html(item)}</li>`).join("")}
        </ul>
        <div class="stageNav">
          <a class="palmButton palmButton--soft" href="/learn/fingerspelling/${lesson.id}#watch">이전: 보기</a>
          <a class="palmButton" href="/practice/fingerspelling/${lesson.id}">다음: 따라 하기</a>
        </div>
      </section>
    `;
  }

  if (stage === "quiz") {
    stageMarkup = practicePassed
      ? `
        <section id="quiz" class="learningStage singleStage stageBubble">
          <p class="eyebrow">확인하기</p>
          <h2>오늘 배운 지문자를 골라보세요.</h2>
          ${rumiSpeechBubble({
            emotion: "encourage",
            eyebrow: "루미의 문제",
            message: "기준 사진을 보고 오늘 배운 손말을 찾아봐요."
          })}
          <div class="quizStack">
            ${quiz.map(renderQuizCard).join("")}
          </div>
          <div class="stageNav">
            <a class="palmButton palmButton--soft" href="/practice/fingerspelling/${lesson.id}">이전: 따라 하기</a>
            <button id="completeLesson">완료 저장</button>
          </div>
        </section>
      `
      : `
        <section id="quiz" class="learningStage singleStage stageBubble">
          <p class="eyebrow">확인하기 잠김</p>
          <h2>아직! 학습이 덜 되었어요.</h2>
          ${rumiSpeechBubble({
            emotion: "sad",
            eyebrow: "루미가 기다리는 중",
            message: "괜찮아요. 따라 하기에서 손모양을 3초만 잘 유지하면 확인하기가 열려요."
          })}
          <div class="actions">
            <a class="palmButton" href="/practice/fingerspelling/${lesson.id}">따라 하기에서 다시 해보기</a>
            <a class="palmButton palmButton--soft" href="/learn/fingerspelling/${lesson.id}#understand">손모양 다시 보기</a>
          </div>
        </section>
      `;
  }

  if (stage === "complete") {
    stageMarkup = isCompleted
      ? `
        <section id="complete" class="learningStage singleStage stageBubble">
          <p class="eyebrow">완료</p>
          <h2>${html(lesson.symbol)} 지문자를 마쳤어요.</h2>
          ${rumiSpeechBubble({
            emotion: "cheer",
            eyebrow: "루미의 칭찬",
            message: "와! 오늘 미션 성공이에요. 손말과 조금 더 가까워졌어요."
          })}
          <div class="actions">
            <a class="palmButton" href="/learn/fingerspelling">과정 목록</a>
            <a class="palmButton palmButton--soft" href="/practice/fingerspelling/${lesson.id}">다시 연습하기</a>
          </div>
        </section>
      `
      : `
        <section id="complete" class="learningStage singleStage stageBubble">
          <p class="eyebrow">완료</p>
          <h2>아직 완료 전이에요.</h2>
          ${rumiSpeechBubble({
            emotion: "thinking",
            eyebrow: "루미의 안내",
            message: "확인하기를 마치고 완료 저장을 누르면 진도에 기록돼요."
          })}
          <div class="actions">
            <a class="palmButton" href="/learn/fingerspelling/${lesson.id}#quiz">확인하기로 이동</a>
          </div>
        </section>
      `;
  }

  app.innerHTML = `
    <section class="sectionTitle lessonHeader">
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
    <section class="hero compactHero">
      ${rumiMascot(completed ? "cheer" : "happy", "md", true)}
      <div class="speechBubble heroBubble">
      <p class="eyebrow">Progress</p>
      <h1>루미와 모은 손말 빛</h1>
      <div class="progressBar"><span style="width:${percent}%"></span></div>
      <p class="lead">${completed} / ${total}개 지문자를 완료했어요.</p>
      <p>최근 학습: ${progress.recentLessonIds.length ? progress.recentLessonIds.map(html).join(", ") : "아직 없습니다."}</p>
      <div class="actions"><button id="resetProgress" class="ghost">진도 초기화</button></div>
      </div>
    </section>
  `;
  document.querySelector("#resetProgress")?.addEventListener("click", () => {
    repo.resetProgress();
    progressPage();
  });
}

function aboutPage() {
  app.innerHTML = `
    <section class="infoScreen">
      <div class="infoMascot">${rumiMascot("thinking", "md", true)}</div>
      <div class="speechBubble infoBubble">
      <p class="eyebrow">About</p>
      <h1>손말 첫걸음은 공식 평가 도구가 아닙니다.</h1>
      <p class="lead">이 앱은 한국수어 지문자를 처음 접하는 사용자가 사전 영상을 보고 반복 연습하도록 돕는 학습 MVP입니다. 통역 서비스가 아니며, 모든 손 모양을 정확하게 판정하지 않습니다.</p>
      </div>
    </section>
    <section class="infoList contentRail">
      <article class="speechBubble miniBubble"><strong>카메라 개인정보</strong><p>카메라 영상은 기기 안에서만 분석되며 서버에 저장되지 않습니다.</p></article>
      <article class="speechBubble miniBubble"><strong>출처</strong><p>수어 영상은 국립국어원 한국수어사전 자료를 API로 연결해 표시합니다.</p></article>
      <article class="speechBubble miniBubble"><strong>검수 필요</strong><p>세부 손 모양 설명과 기준 손 위치 데이터는 농인 당사자 및 한국수어 전문가 검수가 필요합니다.</p></article>
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
    <section class="hero compactHero">
      ${rumiMascot("idle", "md", true)}
      <div class="speechBubble heroBubble">
      <p class="eyebrow">Practice</p>
      <h1>연습 화면을 준비하고 있어요.</h1>
      <p class="lead">국립수어사전 기준 영상을 불러오는 중입니다. 잠시만 기다려 주세요.</p>
      <div class="notice">카메라 영상은 기기 안에서만 분석되며 서버에 저장되지 않습니다.</div>
      </div>
    </section>
  `;
  import("/js/practice.js?v=20260703-rumi-map")
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
