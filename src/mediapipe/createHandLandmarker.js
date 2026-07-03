export async function createHandLandmarker({ modelAssetPath = "/models/hand_landmarker.task", runningMode = "VIDEO" } = {}) {
  const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs");
  const filesetResolver = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
  return vision.HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath,
      delegate: "GPU"
    },
    numHands: 2,
    runningMode
  });
}
