export const FRAME_ERRORS = Object.freeze({
  MISSING: "FRAME_MAP_MISSING",
  COUNT_MISMATCH: "FRAME_COUNT_MISMATCH",
  VFR_UNSUPPORTED: "VARIABLE_FRAME_RATE_UNSUPPORTED"
});

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function strictlyAscending(values) {
  return values.every((value, index) => index === 0 || value > values[index - 1]);
}

export function validateFrameMap(candidate) {
  const local = candidate?.frame_pts_sec;
  const source = candidate?.source_frame_pts_sec;
  if (!Array.isArray(local) || !Array.isArray(source) || local.length < 2 || source.length < 2) {
    return { ok: false, code: FRAME_ERRORS.MISSING };
  }
  if (candidate.fps_mode !== "CFR") {
    return { ok: false, code: FRAME_ERRORS.VFR_UNSUPPORTED };
  }
  if (candidate.frame_count !== local.length || candidate.frame_count !== source.length) {
    return { ok: false, code: FRAME_ERRORS.COUNT_MISMATCH };
  }
  if (!local.every(finiteNumber) || !source.every(finiteNumber) || !strictlyAscending(local) || !strictlyAscending(source)) {
    return { ok: false, code: FRAME_ERRORS.COUNT_MISMATCH };
  }
  return { ok: true, code: "FRAME_MAP_VALID" };
}

export function clampFrame(candidate, frame) {
  return Math.max(0, Math.min(candidate.frame_count - 1, Math.trunc(frame)));
}

export function stepFrame(candidate, currentFrame, delta) {
  return clampFrame(candidate, currentFrame + delta);
}

export function frameToLocalTime(candidate, frame) {
  const validation = validateFrameMap(candidate);
  if (!validation.ok) throw new Error(validation.code);
  return candidate.frame_pts_sec[clampFrame(candidate, frame)];
}

export function frameToSourceTime(candidate, frame) {
  const validation = validateFrameMap(candidate);
  if (!validation.ok) throw new Error(validation.code);
  return candidate.source_frame_pts_sec[clampFrame(candidate, frame)];
}

export function nearestFrame(candidate, mediaTime) {
  const validation = validateFrameMap(candidate);
  if (!validation.ok) throw new Error(validation.code);
  let low = 0;
  let high = candidate.frame_pts_sec.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candidate.frame_pts_sec[middle] < mediaTime) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  const before = candidate.frame_pts_sec[low - 1];
  const after = candidate.frame_pts_sec[low];
  return mediaTime - before <= after - mediaTime ? low - 1 : low;
}

export function frameTolerance(candidate, frame) {
  const index = clampFrame(candidate, frame);
  const pts = candidate.frame_pts_sec;
  const previousGap = index > 0 ? pts[index] - pts[index - 1] : Number.POSITIVE_INFINITY;
  const nextGap = index < pts.length - 1 ? pts[index + 1] - pts[index] : Number.POSITIVE_INFINITY;
  return Math.min(previousGap, nextGap, 1 / candidate.nominal_fps) * 0.51;
}
