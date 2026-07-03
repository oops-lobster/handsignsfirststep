export async function createHandLandmarker({ modelAssetPath = "/models/hand_landmarker.task", runningMode = "VIDEO" } = {}) {
  const version = await loadVisionTasksVersion();
  const vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/vision_bundle.mjs`);
  const filesetResolver = await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`);
  return vision.HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath,
      delegate: "GPU"
    },
    numHands: 2,
    runningMode
  });
}

async function loadVisionTasksVersion() {
  const versions = ["0.10.35", "0.10.21"];
  for (const version of versions) {
    try {
      const response = await fetch(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/vision_bundle.mjs`, {
        method: "HEAD",
        cache: "force-cache"
      });
      if (response.ok) return version;
    } catch {
      // Try the next pinned version before surfacing a user-facing error.
    }
  }
  throw new Error("MediaPipe 모듈을 불러오지 못했습니다. 네트워크 또는 CDN 연결을 확인해 주세요.");
}
