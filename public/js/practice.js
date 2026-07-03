import { createHandLandmarker } from "/src/mediapipe/createHandLandmarker.js?v=20260703-camera";
import { evaluateGeneralHandFeedback } from "/src/mediapipe/feedbackEngine.js?v=20260703-camera";

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

async function api(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

function drawLandmarks(canvas, hands) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#d97860";
  context.strokeStyle = "#ffffff";
  hands.flat().forEach(point => {
    context.beginPath();
    context.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
}

export async function renderPractice(app, id, repo) {
  const [{ lesson }, dictionary] = await Promise.all([
    api(`/api/lessons/${encodeURIComponent(id)}`),
    api(`/api/dictionary/lesson/${encodeURIComponent(id)}`)
  ]);
  const entry = dictionary.entries?.[0];
  const progress = repo.getProgress();

  app.innerHTML = `
    <section class="sectionTitle">
      <span>Practice</span>
      <h1>${html(lesson.symbol)} 따라 하기</h1>
      <p class="lead">기준 영상을 보며 천천히 따라 해보세요. 카메라 영상은 기기 안에서만 분석되며 서버에 저장되지 않습니다.</p>
    </section>
    <section class="cameraGrid">
      <article class="videoCard">
        <h2>기준 영상</h2>
        ${entry?.videoUrl ? `<video class="referenceVideo" src="${html(entry.videoUrl)}" poster="${html(entry.thumbnailUrl || "")}" controls playsinline preload="metadata"></video>` : `<div class="notice danger">사전 영상 연결 확인 중입니다.</div>`}
        <div class="signGuide">
          <strong>어떻게 따라 하나요?</strong>
          <p>${html(entry?.description || "아직 사전 설명을 불러오지 못했습니다. 기준 영상을 보고 손 모양과 방향을 천천히 확인해 주세요.")}</p>
        </div>
        <p class="meta">${html(entry?.attribution || "영상 출처: 국립국어원 한국수어사전")}</p>
      </article>
      <article class="videoCard">
        <h2>내 손 확인</h2>
        <div class="cameraBox" data-mirror="${progress.settings.mirrorCamera}">
          <video id="cameraVideo" autoplay muted playsinline></video>
          <canvas id="landmarkCanvas" aria-label="카메라가 감지한 손 위치 점 표시"></canvas>
        </div>
        <div class="actions">
          <button id="startCamera">카메라 시작</button>
          <button id="toggleLandmarks" class="secondary">${progress.settings.showLandmarks ? "손 위치 점 끄기" : "손 위치 점 켜기"}</button>
          <button id="completePractice" class="ghost">학습 완료</button>
        </div>
        <div id="cameraStatus" class="notice">카메라를 시작하기 전입니다.</div>
        <div id="feedbackList" class="feedbackList" aria-live="polite"></div>
      </article>
    </section>
  `;

  const video = document.querySelector("#cameraVideo");
  const canvas = document.querySelector("#landmarkCanvas");
  const status = document.querySelector("#cameraStatus");
  const feedbackList = document.querySelector("#feedbackList");
  let landmarker = null;
  let stream = null;
  let running = false;
  let lastVideoTime = -1;
  const history = [];

  function resizeCanvas() {
    canvas.width = video.clientWidth || 640;
    canvas.height = video.clientHeight || 480;
  }

  async function loop() {
    if (!running || !landmarker) return;
    if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
      lastVideoTime = video.currentTime;
      resizeCanvas();
      const result = landmarker.detectForVideo(video, performance.now());
      const hands = result.landmarks || [];
      if (hands[0]) history.push(hands[0]);
      while (history.length > 8) history.shift();
      if (repo.getProgress().settings.showLandmarks) drawLandmarks(canvas, hands);
      const feedback = evaluateGeneralHandFeedback({ hands, history, referenceAvailable: false });
      feedbackList.innerHTML = feedback.map(item => `<div class="feedbackItem">${html(item.text)}</div>`).join("");
      status.textContent = hands.length ? `${hands.length}개 손이 감지되고 있어요.` : "손이 아직 보이지 않아요.";
    }
    window.requestAnimationFrame(loop);
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

  document.querySelector("#completePractice").addEventListener("click", () => {
    repo.completeLesson(lesson.id);
    status.textContent = "좋아요! 첫걸음을 잘 마쳤어요.";
  });

  window.addEventListener("pagehide", () => {
    running = false;
    stream?.getTracks().forEach(track => track.stop());
  }, { once: true });
}
