import { frameToSourceTime, validateFrameMap } from "../player/frameMap.js";
import { ADJUSTMENT_ASSESSMENTS, BOUNDARY_ASSESSMENTS, normalizeReviewInput } from "../review/reviewModel.js";

export const VALIDATION_CODES = Object.freeze({
  VALID: "VALID",
  INVALID_BOUNDARY: "INVALID_BOUNDARY",
  INVALID_TARGET: "INVALID_TARGET",
  INVALID_USAGE: "INVALID_USAGE_COMBINATION",
  STALE_MANIFEST: "STALE_MANIFEST",
  CLIP_CHANGED: "CLIP_CHANGED"
});

const TARGETS = new Set(["TARGET_CONFIRMED", "TARGET_MISMATCH", "TARGET_UNCERTAIN"]);
const LEARNING = new Set(["LEARNING_ALLOWED", "LEARNING_CONDITIONAL", "LEARNING_NOT_ALLOWED", "LEARNING_UNCERTAIN"]);
const REFERENCES = new Set(["REFERENCE_ALLOWED", "REFERENCE_CONDITIONAL", "REFERENCE_NOT_ALLOWED", "REFERENCE_UNCERTAIN"]);
const REPRESENTATIVE = new Set(["REPRESENTATIVE_HIGH", "REPRESENTATIVE_MEDIUM", "REPRESENTATIVE_LOW", "REPRESENTATIVE_UNSUITABLE", "REPRESENTATIVE_UNCERTAIN"]);
const CONNECTIONS = new Set(["CONNECTION_NONE", "CONNECTION_MINOR", "CONNECTION_MAJOR", "CONNECTION_UNCERTAIN"]);

function fail(code, message, field = null) {
  return { ok: false, code, message, field };
}

export function validateReview(input, candidate, manifest) {
  const map = validateFrameMap(candidate);
  if (!map.ok) return fail(map.code, "프레임 맵을 검증할 수 없어 저장이 차단되었습니다.");
  if (input.revision !== manifest.revision) return fail(VALIDATION_CODES.STALE_MANIFEST, "검토 배치가 갱신되었습니다. 다시 불러오세요.");
  if (input.clip_sha256 !== candidate.clip_sha256) return fail(VALIDATION_CODES.CLIP_CHANGED, "검토 영상 체크섬이 manifest와 다릅니다.");

  const legacyInput = !input.boundary_assessment;
  const review = normalizeReviewInput(input, candidate);
  if (!TARGETS.has(review.target_validation)) return fail(VALIDATION_CODES.INVALID_TARGET, "[좋다1] 포함 여부를 선택해 주세요.", "target_validation");
  if (!BOUNDARY_ASSESSMENTS.includes(review.boundary_assessment)) return fail(VALIDATION_CODES.INVALID_BOUNDARY, "기존 경계 평가를 명시적으로 선택해 주세요.", "boundary_assessment");
  if (!LEARNING.has(review.learning_video_assessment)) return fail(VALIDATION_CODES.INVALID_USAGE, "학습 영상 사용 가능 여부를 선택해 주세요.", "learning_video_assessment");
  if (!REFERENCES.has(review.reference_assessment)) return fail(VALIDATION_CODES.INVALID_USAGE, "reference 사용 가능 여부를 선택해 주세요.", "reference_assessment");
  if (!REPRESENTATIVE.has(review.representative_fit)) return fail(VALIDATION_CODES.INVALID_USAGE, "대표 영상 적합도를 선택해 주세요.", "representative_fit");
  if (!CONNECTIONS.has(review.sentence_connection_effect)) return fail(VALIDATION_CODES.INVALID_USAGE, "문장 연결 영향을 선택해 주세요.", "sentence_connection_effect");
  if (![true, false, null].includes(review.excluded)) return fail(VALIDATION_CODES.INVALID_USAGE, "제외·유지·보류 중 하나를 선택해 주세요.", "excluded");

  if (review.target_validation === "TARGET_MISMATCH") {
    const usageAllowed = review.learning_video_assessment === "LEARNING_ALLOWED" || review.reference_assessment === "REFERENCE_ALLOWED";
    const representativeAllowed = ["REPRESENTATIVE_HIGH", "REPRESENTATIVE_MEDIUM", "REPRESENTATIVE_LOW"].includes(review.representative_fit);
    if (usageAllowed || representativeAllowed || review.excluded === false) {
      return fail(VALIDATION_CODES.INVALID_TARGET, "다른 표현은 사용·대표 후보로 승인할 수 없으며 제외 또는 보류해야 합니다.", "target_validation");
    }
  }
  if (review.excluded === true && (review.learning_video_assessment === "LEARNING_ALLOWED" || review.reference_assessment === "REFERENCE_ALLOWED")) {
    return fail(VALIDATION_CODES.INVALID_USAGE, "제외 후보는 학습 또는 reference로 승인할 수 없습니다.", "excluded");
  }
  if (review.boundary_assessment === "BOUNDARY_UNUSABLE" && review.excluded !== true) {
    return fail(VALIDATION_CODES.INVALID_USAGE, "경계 사용 불가는 후보 제외와 함께 저장해야 합니다.", "excluded");
  }
  if (review.excluded === true && !String(review.exclusion_reason || "").trim()) {
    return fail(VALIDATION_CODES.INVALID_USAGE, "제외 후보에는 사유가 필요합니다.", "exclusion_reason");
  }
  const conditional = review.learning_video_assessment === "LEARNING_CONDITIONAL" || review.reference_assessment === "REFERENCE_CONDITIONAL";
  const notesRequired = conditional || (!legacyInput && (
    review.excluded === true || review.target_validation === "TARGET_MISMATCH" ||
    ["BOUNDARY_AMBIGUOUS", "BOUNDARY_UNUSABLE"].includes(review.boundary_assessment) ||
    (review.precise_review_required && review.review_state === "PRECISE_REVIEW_REQUIRED")
  ));
  if (notesRequired && !String(review.expert_notes || "").trim()) {
    return fail(VALIDATION_CODES.INVALID_USAGE, "조건부·모호·제외·불일치·정밀 검토 요청에는 의견이 필요합니다.", "expert_notes");
  }

  const hasApprovedBoundary = review.approved_start_local_frame != null || review.approved_end_local_frame != null;
  if (hasApprovedBoundary) {
    const start = review.approved_start_local_frame;
    const end = review.approved_end_local_frame;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= candidate.frame_count || start >= end) {
      return fail(VALIDATION_CODES.INVALID_BOUNDARY, "시작 프레임은 종료 프레임보다 앞서고 영상 범위 안이어야 합니다.", "manual_start_local_frame");
    }
    const startSource = frameToSourceTime(candidate, start);
    const endSource = frameToSourceTime(candidate, end);
    if (startSource < candidate.review_start_source_sec - 0.000001 || endSource > candidate.review_end_source_sec + 0.000001) {
      return fail(VALIDATION_CODES.INVALID_BOUNDARY, "승인 경계가 검토 가능한 원본 구간을 벗어났습니다.");
    }
  }
  if (review.boundary_assessment === "BOUNDARY_KEEP_ORIGINAL" && review.review_mode === "COARSE" &&
      (review.approved_start_local_frame !== candidate.annotated_start_local_frame || review.approved_end_local_frame !== candidate.annotated_end_local_frame)) {
    return fail(VALIDATION_CODES.INVALID_BOUNDARY, "기존 경계 적절 판정은 annotation 경계를 사용해야 합니다.", "boundary_assessment");
  }
  if (legacyInput && input.boundary_status === "MODIFIED") {
    const start = input.approved_start_local_frame;
    const end = input.approved_end_local_frame;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end >= candidate.frame_count ||
        (start === candidate.annotated_start_local_frame && end === candidate.annotated_end_local_frame)) {
      return fail(VALIDATION_CODES.INVALID_BOUNDARY, "수정 판정에는 기존과 다른 유효한 경계가 필요합니다.", "boundary_status");
    }
  }
  if (!legacyInput && ADJUSTMENT_ASSESSMENTS.has(review.boundary_assessment) && review.review_mode === "PRECISE") {
    const direction = validateAdjustmentDirection(review, candidate);
    if (!direction.ok) return direction;
  }
  return { ok: true, code: VALIDATION_CODES.VALID, message: "저장할 수 있습니다.", review };
}

function validateAdjustmentDirection(review, candidate) {
  const start = review.manual_start_local_frame;
  const end = review.manual_end_local_frame;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start >= end) {
    return fail(VALIDATION_CODES.INVALID_BOUNDARY, "정밀 검토에서는 버튼으로 유효한 시작·종료 프레임을 지정해 주세요.", "manual_start_local_frame");
  }
  const originalStart = candidate.annotated_start_local_frame;
  const originalEnd = candidate.annotated_end_local_frame;
  const checks = {
    BOUNDARY_START_TOO_EARLY: start > originalStart,
    BOUNDARY_START_TOO_LATE: start < originalStart,
    BOUNDARY_END_TOO_EARLY: end > originalEnd,
    BOUNDARY_END_TOO_LATE: end < originalEnd,
    BOUNDARY_BOTH_NEED_ADJUSTMENT: start !== originalStart && end !== originalEnd
  };
  if (!checks[review.boundary_assessment]) {
    return fail(VALIDATION_CODES.INVALID_BOUNDARY, "선택한 경계 방향과 정밀 프레임 수정 결과가 일치하지 않습니다.", "boundary_assessment");
  }
  return { ok: true };
}
