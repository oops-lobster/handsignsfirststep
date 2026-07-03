import { createHandLandmarker } from "/src/mediapipe/createHandLandmarker.js?v=20260703-practice-meta";
import { evaluatePracticeFrame } from "/src/mediapipe/feedbackEngine.js?v=20260703-dictionary-rubric";

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

async function api(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

const handConnections = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];

function drawHandOverlay(canvas, hands) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  hands.forEach(hand => {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "rgba(255, 249, 242, 0.86)";
    context.lineWidth = Math.max(2, canvas.width * 0.004);
    handConnections.forEach(([from, to]) => {
      const a = hand[from];
      const b = hand[to];
      if (!a || !b) return;
      context.beginPath();
      context.moveTo(a.x * canvas.width, a.y * canvas.height);
      context.lineTo(b.x * canvas.width, b.y * canvas.height);
      context.stroke();
    });

    hand.forEach((point, index) => {
      const radius = [4, 8, 12, 16, 20].includes(index) ? 6 : 4;
      context.beginPath();
      context.arc(point.x * canvas.width, point.y * canvas.height, radius, 0, Math.PI * 2);
      context.fillStyle = [4, 8, 12, 16, 20].includes(index) ? "#d97860" : "#fff9f2";
      context.fill();
      context.strokeStyle = "rgba(62, 52, 47, 0.3)";
      context.lineWidth = 1.5;
      context.stroke();
    });
  });
}

function metaLabel(value, goodText, okText, waitText = "대기 중") {
  if (!value) return waitText;
  return value >= 72 ? goodText : okText;
}

function renderEvaluationMeta(meta) {
  const detectedText = meta.detected ? `${meta.handCount}개 손 감지` : "손을 기다리는 중";
  const guideText = meta.referenceMode === "dictionary-video-reference"
    ? "국립수어사전 설명에서 읽은 손가락 조건과 현재 손 모양을 비교합니다. 전문가 검수 전이므로 학습 보조 기준으로만 사용해 주세요."
    : "현재 피드백은 공식 채점이 아니라 카메라 안에서 손이 잘 보이는지 확인하는 연습 안내입니다.";
  const items = [
    ["손 감지", detectedText],
    ["화면 위치", metaLabel(meta.centerScore, "가운데에 잘 보여요", "조금 더 가운데로")],
    ["손 크기", metaLabel(meta.sizeScore, "크기가 적당해요", "거리 조정 필요")],
    ["유지 상태", metaLabel(meta.stabilityScore, "잠시 잘 유지 중", "조금만 천천히")]
  ];
  return `
    <div class="evaluationMeta" aria-label="연습 상태">
      ${items.map(([label, value]) => `
        <div class="evaluationMetaItem">
          <span>${html(label)}</span>
          <strong>${html(value)}</strong>
        </div>
      `).join("")}
      <p>${html(guideText)}</p>
    </div>
  `;
}

function lockedQuizLink(lessonId, label = "확인하기 잠김") {
  return `<a class="button quizLockedLink" href="/learn/fingerspelling/${html(lessonId)}#quiz" aria-disabled="true" tabindex="-1">${html(label)}</a>`;
}

export async function renderPractice(app, id, repo) {
  const [{ lesson }, dictionary] = await Promise.all([
    api(`/api/lessons/${encodeURIComponent(id)}`),
    api(`/api/dictionary/lesson/${encodeURIComponent(id)}`)
  ]);
  const entry = dictionary.entries?.[0];
  const hasDictionaryReference = Boolean(entry?.videoUrl);
  const dictionaryDescription = entry?.description || "";
  const progress = repo.getProgress();

  app.innerHTML = `
    <section class="sectionTitle">
      <span>Practice</span>
      <h1>${html(lesson.symbol)} 따라 하기</h1>
      <p class="lead">기준 영상을 보며 천천히 따라 해보세요. 카메라 영상은 기기 안에서만 분석되며 서버에 저장되지 않습니다.</p>
    </section>
    <nav class="stepper" aria-label="학습 단계">
      <a href="/learn/fingerspelling/${html(lesson.id)}#watch">보기</a>
      <a href="/learn/fingerspelling/${html(lesson.id)}#understand">손모양 익히기</a>
      <span data-active="true" aria-current="step">따라 하기</span>
      <span aria-disabled="true">확인하기</span>
      <a href="/learn/fingerspelling/${html(lesson.id)}#complete">완료</a>
    </nav>
    <section class="cameraGrid">
      <article class="videoCard">
        <h2>기준 영상</h2>
        ${entry?.videoUrl ? `<video class="referenceVideo" src="${html(entry.videoUrl)}" poster="${html(entry.thumbnailUrl || "")}" controls playsinline preload="metadata"></video>` : `<div class="notice danger">사전 영상 연결 확인 중입니다.</div>`}
        <div class="signGuide">
          <strong>사전 영상 기준으로 따라 해요</strong>
          <p>${html(entry?.description || "아직 사전 설명을 불러오지 못했습니다. 기준 영상을 보고 손 모양과 방향을 천천히 확인해 주세요.")}</p>
        </div>
        <div class="referenceChecklist" aria-label="사전 영상 기준 확인 항목">
          <strong>따라 할 때 볼 부분</strong>
          <ul>
            <li>손가락이 펴지거나 접힌 모양</li>
            <li>엄지와 다른 손가락 사이의 거리</li>
            <li>손바닥과 손등이 향하는 방향</li>
          </ul>
        </div>
        <p class="meta">${html(entry?.attribution || "영상 출처: 국립국어원 한국수어사전")}</p>
      </article>
      <article class="videoCard">
        <h2>내 손 확인</h2>
        <div class="cameraBox" data-mirror="${progress.settings.mirrorCamera}">
          <video id="cameraVideo" autoplay muted playsinline></video>
          <canvas id="landmarkCanvas" aria-label="카메라가 감지한 손 위치 점 표시"></canvas>
          <div id="countdownOverlay" class="countdownOverlay" hidden></div>
        </div>
        <div class="actions">
          <button id="startCamera">카메라 시작</button>
          <button id="toggleLandmarks" class="secondary">${progress.settings.showLandmarks ? "손 위치 점 끄기" : "손 위치 점 켜기"}</button>
          <button id="resetPractice" class="secondary">다시 연습</button>
          <button id="completePractice" class="ghost" disabled>채점 후 저장</button>
        </div>
        <div id="cameraStatus" class="notice">카메라를 시작하기 전입니다.</div>
        <div id="evaluationMeta">${renderEvaluationMeta({ detected: false, handCount: 0, centerScore: 0, sizeScore: 0, stabilityScore: 0, referenceMode: hasDictionaryReference ? "dictionary-video-reference" : "general-camera-check" })}</div>
        <div id="feedbackList" class="feedbackList" aria-live="polite"></div>
        <p class="privacyNote">카메라 영상은 기기 안에서만 분석되며 서버에 저장되지 않습니다.</p>
      </article>
    </section>
    <section class="panel practiceNext">
      <div>
        <p class="eyebrow">Next</p>
        <h2>따라 했다면 짧게 확인해볼까요?</h2>
        <p class="lead">사전 설명의 손가락 조건과 맞으면 확인하기 문항으로 이어갈 수 있어요.</p>
      </div>
      <div class="actions">
        <a class="button secondary" href="/learn/fingerspelling/${html(lesson.id)}">학습 화면으로 돌아가기</a>
        ${lockedQuizLink(lesson.id)}
      </div>
    </section>
  `;

  const video = document.querySelector("#cameraVideo");
  const canvas = document.querySelector("#landmarkCanvas");
  const countdownOverlay = document.querySelector("#countdownOverlay");
  const status = document.querySelector("#cameraStatus");
  const feedbackList = document.querySelector("#feedbackList");
  const evaluationMeta = document.querySelector("#evaluationMeta");
  const completeButton = document.querySelector("#completePractice");
  const quizLinks = [...document.querySelectorAll(".quizLockedLink")];
  let landmarker = null;
  let stream = null;
  let running = false;
  let inferenceRunning = false;
  let lastVideoTime = -1;
  let stableFeedbackKey = "";
  let pendingFeedbackKey = "";
  let pendingFeedbackCount = 0;
  let stableFeedback = [];
  let stableMeta = { detected: false, handCount: 0, centerScore: 0, sizeScore: 0, stabilityScore: 0, referenceMode: hasDictionaryReference ? "dictionary-video-reference" : "general-camera-check" };
  let practiceUnlocked = false;
  const history = [];

  function unlockPractice() {
    if (practiceUnlocked) return;
    practiceUnlocked = true;
    repo.markPracticePassed(lesson.id);
    quizLinks.forEach(link => {
      link.removeAttribute("aria-disabled");
      link.removeAttribute("tabindex");
      link.textContent = "확인하기로 이동";
    });
    completeButton.disabled = false;
    completeButton.textContent = "연습 완료 저장";
    status.textContent = "훌륭해요! 사전 설명과 맞아서 확인하기로 넘어갈 수 있어요.";
  }

  function resizeCanvas() {
    canvas.width = video.clientWidth || 640;
    canvas.height = video.clientHeight || 480;
  }

  async function loop() {
    if (!running || !landmarker) return;
    if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
      if (inferenceRunning) {
        window.requestAnimationFrame(loop);
        return;
      }
      inferenceRunning = true;
      try {
        lastVideoTime = video.currentTime;
        resizeCanvas();
        const result = landmarker.detectForVideo(video, performance.now());
        const hands = result.landmarks || [];
        if (hands[0]) history.push(hands[0]);
        while (history.length > 8) history.shift();
        if (repo.getProgress().settings.showLandmarks) {
          drawHandOverlay(canvas, hands);
        } else {
          canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
        }
        const { feedback, meta } = evaluatePracticeFrame({ hands, history, referenceAvailable: hasDictionaryReference, dictionaryDescription });
        const feedbackKey = feedback.map(item => item.state).join("|");
        if (feedbackKey === stableFeedbackKey) {
          stableFeedback = feedback;
          stableMeta = meta;
        } else if (feedbackKey === pendingFeedbackKey) {
          pendingFeedbackCount += 1;
          if (pendingFeedbackCount >= 3 || feedback[0]?.state === "no_hand") {
            stableFeedbackKey = feedbackKey;
            stableFeedback = feedback;
            stableMeta = meta;
          }
        } else {
          pendingFeedbackKey = feedbackKey;
          pendingFeedbackCount = 1;
        }
        if (stableMeta.practicePassed) unlockPractice();
        feedbackList.innerHTML = stableFeedback.map(item => `<div class="feedbackItem ${item.state === "success" ? "success" : ""}">${html(item.text)}</div>`).join("");
        evaluationMeta.innerHTML = renderEvaluationMeta(stableMeta);
        if (!practiceUnlocked) status.textContent = hands.length ? `${hands.length}개 손이 감지되고 있어요.` : "손이 아직 보이지 않아요.";
      } finally {
        inferenceRunning = false;
      }
    }
    window.requestAnimationFrame(loop);
  }

  function showCountdown() {
    return new Promise(resolve => {
      const steps = ["3", "2", "1", "시작"];
      let index = 0;
      countdownOverlay.hidden = false;
      countdownOverlay.textContent = steps[index];
      const timer = window.setInterval(() => {
        index += 1;
        countdownOverlay.textContent = steps[index] || "";
        if (index >= steps.length - 1) {
          window.clearInterval(timer);
          window.setTimeout(() => {
            countdownOverlay.hidden = true;
            resolve();
          }, 500);
        }
      }, 650);
    });
  }

  document.querySelector("#startCamera").addEventListener("click", async () => {
    try {
      if (!window.isSecureContext) {
        throw new Error("카메라는 HTTPS 또는 localhost 환경에서만 사용할 수 있습니다.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("이 브라우저에서는 카메라 입력을 사용할 수 없습니다. Safari/Chrome 최신 버전에서 다시 열어주세요.");
      }
      status.textContent = "모델을 불러오는 중입니다.";
      landmarker ||= await createHandLandmarker({ runningMode: "VIDEO" });
      status.textContent = "카메라 권한을 요청합니다.";
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      status.textContent = "3초 뒤 연습을 시작합니다.";
      await showCountdown();
      running = true;
      repo.saveLastLesson(lesson.id);
      loop();
    } catch (error) {
      let message = "모델 파일은 /models/hand_landmarker.task 경로에 배치해야 합니다.";
      if (error.message.includes("MediaPipe")) {
        message = "MediaPipe 모듈을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
      } else if (error.name === "NotAllowedError" || error.message.includes("Permission denied")) {
        message = "카메라 권한이 거부되었습니다. 브라우저 주소창의 권한 설정에서 카메라를 허용해 주세요.";
      } else if (error.message.includes("카메라")) {
        message = error.message;
      }
      status.textContent = message;
      feedbackList.innerHTML = `<div class="feedbackItem">${html(message)}</div>`;
    }
  });

  document.querySelector("#toggleLandmarks").addEventListener("click", event => {
    const current = repo.getProgress().settings.showLandmarks;
    repo.updateSettings({ showLandmarks: !current });
    event.currentTarget.textContent = !current ? "손 위치 점 끄기" : "손 위치 점 켜기";
    if (current) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  });

  document.querySelector("#resetPractice").addEventListener("click", () => {
    history.length = 0;
    stableFeedbackKey = "";
    pendingFeedbackKey = "";
    pendingFeedbackCount = 0;
    stableFeedback = [];
    stableMeta = { detected: false, handCount: 0, centerScore: 0, sizeScore: 0, stabilityScore: 0, referenceMode: hasDictionaryReference ? "dictionary-video-reference" : "general-camera-check" };
    feedbackList.innerHTML = "";
    evaluationMeta.innerHTML = renderEvaluationMeta(stableMeta);
    status.textContent = running ? "다시 천천히 손을 보여주세요." : "카메라를 시작하기 전입니다.";
    practiceUnlocked = false;
    quizLinks.forEach(link => {
      link.setAttribute("aria-disabled", "true");
      link.setAttribute("tabindex", "-1");
      link.textContent = "확인하기 잠김";
    });
    completeButton.disabled = true;
    completeButton.textContent = "채점 후 저장";
  });

  completeButton.addEventListener("click", () => {
    repo.completeLesson(lesson.id);
    status.textContent = "첫걸음을 잘 마쳤어요. 진도에 저장되었습니다.";
    feedbackList.innerHTML = `<div class="feedbackItem success">천천히 반복하면 자연스럽게 익숙해질 거예요.</div>`;
    completeButton.disabled = true;
    completeButton.textContent = "저장 완료";
  });

  quizLinks.forEach(link => link.addEventListener("click", event => {
    if (link.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      status.textContent = "아직! 학습이 덜되었어요! 사전 설명과 손모양이 맞으면 확인하기가 열려요.";
      feedbackList.innerHTML = `<div class="feedbackItem">아직! 학습이 덜되었어요! 기준 영상과 사전 설명을 보고 다시 맞춰볼까요?</div>`;
    }
  }));

  window.addEventListener("pagehide", () => {
    running = false;
    stream?.getTracks().forEach(track => track.stop());
  }, { once: true });
}
