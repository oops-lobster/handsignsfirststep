export function calculateHandBoundingBox(landmarks) {
  if (!Array.isArray(landmarks) || !landmarks.length) return null;
  const xs = landmarks.map(point => point.x);
  const ys = landmarks.map(point => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

export function normalizeLandmarks(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 2) return [];
  const wrist = landmarks[0];
  const middleBase = landmarks[9] || landmarks[1];
  const scale = Math.hypot(middleBase.x - wrist.x, middleBase.y - wrist.y, (middleBase.z || 0) - (wrist.z || 0)) || 1;
  return landmarks.map(point => ({
    x: (point.x - wrist.x) / scale,
    y: (point.y - wrist.y) / scale,
    z: ((point.z || 0) - (wrist.z || 0)) / scale
  }));
}

export function calculateJointAngle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const abLength = Math.hypot(ab.x, ab.y, ab.z);
  const cbLength = Math.hypot(cb.x, cb.y, cb.z);
  if (!abLength || !cbLength) return 0;
  const cosine = Math.max(-1, Math.min(1, dot / (abLength * cbLength)));
  return Math.acos(cosine) * 180 / Math.PI;
}

const fingerJoints = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20]
};

export function getFingerExtensionState(landmarks) {
  const normalized = normalizeLandmarks(landmarks);
  const state = {};
  for (const [finger, joints] of Object.entries(fingerJoints)) {
    const [base, pip, dip, tip] = joints.map(index => normalized[index]);
    if (!base || !pip || !dip || !tip) {
      state[finger] = "unknown";
      continue;
    }
    const angle = calculateJointAngle(base, pip, tip);
    state[finger] = angle > 135 ? "extended" : angle < 95 ? "folded" : "partial";
  }
  return state;
}

export function calculateFingerTipDistance(landmarks, firstFinger = "thumb", secondFinger = "index") {
  const tipIndexes = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
  const normalized = normalizeLandmarks(landmarks);
  const first = normalized[tipIndexes[firstFinger]];
  const second = normalized[tipIndexes[secondFinger]];
  if (!first || !second) return null;
  return Math.hypot(first.x - second.x, first.y - second.y, (first.z || 0) - (second.z || 0));
}

export function estimatePalmOrientation(landmarks) {
  if (!landmarks?.[0] || !landmarks?.[5] || !landmarks?.[17]) return "unknown";
  const wrist = landmarks[0];
  const indexBase = landmarks[5];
  const pinkyBase = landmarks[17];
  const crossZ = (indexBase.x - wrist.x) * (pinkyBase.y - wrist.y) - (indexBase.y - wrist.y) * (pinkyBase.x - wrist.x);
  return crossZ > 0 ? "palm-ish" : "back-ish";
}

export function mirrorLandmarksIfNeeded(landmarks, mirror = false) {
  if (!mirror) return landmarks;
  return landmarks.map(point => ({ ...point, x: 1 - point.x }));
}

export function calculateReferenceSimilarity(current, reference) {
  const a = normalizeLandmarks(current);
  const b = normalizeLandmarks(reference);
  if (!a.length || a.length !== b.length) return null;
  const total = a.reduce((sum, point, index) => {
    const other = b[index];
    return sum + Math.hypot(point.x - other.x, point.y - other.y, (point.z || 0) - (other.z || 0));
  }, 0);
  return Math.max(0, 1 - total / a.length);
}

export function smoothLandmarks(previous, current, alpha = 0.65) {
  if (!previous?.length) return current;
  return current.map((point, index) => {
    const old = previous[index] || point;
    return {
      x: old.x * alpha + point.x * (1 - alpha),
      y: old.y * alpha + point.y * (1 - alpha),
      z: (old.z || 0) * alpha + (point.z || 0) * (1 - alpha)
    };
  });
}

export function isHandStable(history, threshold = 0.018) {
  if (!Array.isArray(history) || history.length < 4) return false;
  const centers = history.map(calculateHandBoundingBox).filter(Boolean).map(box => ({ x: box.centerX, y: box.centerY }));
  if (centers.length < 4) return false;
  const last = centers[centers.length - 1];
  const averageMovement = centers.slice(0, -1).reduce((sum, point) => sum + Math.hypot(point.x - last.x, point.y - last.y), 0) / (centers.length - 1);
  return averageMovement < threshold;
}
