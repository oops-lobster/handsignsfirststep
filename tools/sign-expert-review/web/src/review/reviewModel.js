import { frameToSourceTime } from "../player/frameMap.js";

export const BOUNDARY_ASSESSMENTS = Object.freeze([
  "BOUNDARY_KEEP_ORIGINAL",
  "BOUNDARY_START_TOO_EARLY",
  "BOUNDARY_START_TOO_LATE",
  "BOUNDARY_END_TOO_EARLY",
  "BOUNDARY_END_TOO_LATE",
  "BOUNDARY_BOTH_NEED_ADJUSTMENT",
  "BOUNDARY_AMBIGUOUS",
  "BOUNDARY_UNUSABLE"
]);

export const ADJUSTMENT_ASSESSMENTS = new Set([
  "BOUNDARY_START_TOO_EARLY",
  "BOUNDARY_START_TOO_LATE",
  "BOUNDARY_END_TOO_EARLY",
  "BOUNDARY_END_TOO_LATE",
  "BOUNDARY_BOTH_NEED_ADJUSTMENT"
]);

const LEARNING_TO_LEGACY = {
  LEARNING_ALLOWED: "ALLOWED",
  LEARNING_CONDITIONAL: "CONDITIONAL",
  LEARNING_NOT_ALLOWED: "NOT_ALLOWED",
  LEARNING_UNCERTAIN: "UNSURE"
};
const REFERENCE_TO_LEGACY = {
  REFERENCE_ALLOWED: "ALLOWED",
  REFERENCE_CONDITIONAL: "CONDITIONAL",
  REFERENCE_NOT_ALLOWED: "NOT_ALLOWED",
  REFERENCE_UNCERTAIN: "UNSURE"
};
const REPRESENTATIVE_TO_LEGACY = {
  REPRESENTATIVE_HIGH: "HIGH",
  REPRESENTATIVE_MEDIUM: "MEDIUM",
  REPRESENTATIVE_LOW: "LOW",
  REPRESENTATIVE_UNSUITABLE: "UNSUITABLE",
  REPRESENTATIVE_UNCERTAIN: "UNSURE"
};
const CONNECTION_TO_LEGACY = {
  CONNECTION_NONE: "NONE",
  CONNECTION_MINOR: "MINOR",
  CONNECTION_MAJOR: "PRESENT",
  CONNECTION_UNCERTAIN: "UNSURE"
};

const invert = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [value, key]));
const LEGACY_TO_LEARNING = invert(LEARNING_TO_LEGACY);
const LEGACY_TO_REFERENCE = invert(REFERENCE_TO_LEGACY);
const LEGACY_TO_REPRESENTATIVE = invert(REPRESENTATIVE_TO_LEGACY);
const LEGACY_TO_CONNECTION = invert(CONNECTION_TO_LEGACY);

export function normalizeReviewInput(input = {}, candidate) {
  const boundaryAssessment = input.boundary_assessment || legacyBoundaryAssessment(input.boundary_status);
  const learningAssessment = input.learning_video_assessment || LEGACY_TO_LEARNING[input.learning_allowed] || null;
  const referenceAssessment = input.reference_assessment || LEGACY_TO_REFERENCE[input.reference_allowed] || null;
  const representativeFit = input.representative_fit?.startsWith?.("REPRESENTATIVE_")
    ? input.representative_fit
    : LEGACY_TO_REPRESENTATIVE[input.representative_fit] || null;
  const sentenceEffect = input.sentence_connection_effect?.startsWith?.("CONNECTION_")
    ? input.sentence_connection_effect
    : LEGACY_TO_CONNECTION[input.sentence_connection_effect] || null;
  const reviewMode = input.review_mode || (input.boundary_status === "MODIFIED" ? "PRECISE" : "COARSE");
  const legacyModified = input.boundary_status === "MODIFIED";
  const manualStart = nullableInteger(input.manual_start_local_frame ?? (legacyModified ? input.approved_start_local_frame : null));
  const manualEnd = nullableInteger(input.manual_end_local_frame ?? (legacyModified ? input.approved_end_local_frame : null));
  const manualValid = manualBoundaryValid(candidate, manualStart, manualEnd);
  const manualChanged = manualValid && (manualStart !== candidate.annotated_start_local_frame || manualEnd !== candidate.annotated_end_local_frame);
  const preciseReasons = preciseReviewReasons({ ...input, boundary_assessment: boundaryAssessment }, candidate);
  const preciseRequired = input.precise_review_required === true || String(input.precise_review_required || "").toLowerCase() === "true" || preciseReasons.length > 0;
  const boundary = resolveApprovedBoundary({
    candidate,
    boundaryAssessment,
    reviewMode,
    manualStart,
    manualEnd,
    manualValid,
    manualChanged
  });
  const excluded = parseExcluded(input.excluded);
  const reviewState = deriveReviewState({
    ...input,
    excluded,
    target_validation: input.target_validation,
    boundary_assessment: boundaryAssessment,
    review_mode: reviewMode,
    precise_review_required: preciseRequired,
    approved_start_local_frame: boundary.approvedStart,
    approved_end_local_frame: boundary.approvedEnd,
    manualValid,
    manualChanged
  });

  return {
    ...input,
    review_mode: reviewMode,
    review_state: reviewState,
    target_validation: input.target_validation || null,
    boundary_assessment: boundaryAssessment,
    precise_review_required: preciseRequired,
    precise_review_reason: String(input.precise_review_reason || preciseReasons.join("; ")),
    boundary_confidence: input.boundary_confidence ?? candidate.boundary_confidence ?? null,
    auto_proposed_start_local_frame: nullableInteger(input.auto_proposed_start_local_frame ?? candidate.auto_proposed_start_local_frame),
    auto_proposed_end_local_frame: nullableInteger(input.auto_proposed_end_local_frame ?? candidate.auto_proposed_end_local_frame),
    auto_proposed_start_source_sec: nullableNumber(input.auto_proposed_start_source_sec ?? candidate.auto_proposed_start_source_sec),
    auto_proposed_end_source_sec: nullableNumber(input.auto_proposed_end_source_sec ?? candidate.auto_proposed_end_source_sec),
    manual_start_local_frame: reviewMode === "PRECISE" && manualValid ? manualStart : null,
    manual_end_local_frame: reviewMode === "PRECISE" && manualValid ? manualEnd : null,
    manual_start_source_sec: reviewMode === "PRECISE" && manualValid ? frameToSourceTime(candidate, manualStart) : null,
    manual_end_source_sec: reviewMode === "PRECISE" && manualValid ? frameToSourceTime(candidate, manualEnd) : null,
    approved_start_local_frame: boundary.approvedStart,
    approved_end_local_frame: boundary.approvedEnd,
    approved_start_source_sec: boundary.approvedStart == null ? null : frameToSourceTime(candidate, boundary.approvedStart),
    approved_end_source_sec: boundary.approvedEnd == null ? null : frameToSourceTime(candidate, boundary.approvedEnd),
    boundary_status: boundary.boundaryStatus,
    learning_video_assessment: learningAssessment,
    reference_assessment: referenceAssessment,
    learning_allowed: LEARNING_TO_LEGACY[learningAssessment] || input.learning_allowed || null,
    reference_allowed: REFERENCE_TO_LEGACY[referenceAssessment] || input.reference_allowed || null,
    representative_fit: representativeFit,
    representative_fit_legacy: REPRESENTATIVE_TO_LEGACY[representativeFit] || null,
    sentence_connection_effect: sentenceEffect,
    sentence_connection_effect_legacy: CONNECTION_TO_LEGACY[sentenceEffect] || null,
    excluded
  };
}

export function preciseReviewReasons(input, candidate) {
  const reasons = [];
  if (candidate.precise_review_required) reasons.push(candidate.precise_review_reason || "OPERATOR_REQUIRED");
  if (candidate.representative_final_candidate) reasons.push("REPRESENTATIVE_FINAL_CANDIDATE");
  const confidence = input.boundary_confidence ?? candidate.boundary_confidence;
  if ((typeof confidence === "number" && confidence < 0.7) || String(confidence || "").toUpperCase() === "LOW") reasons.push("LOW_BOUNDARY_CONFIDENCE");
  if (ADJUSTMENT_ASSESSMENTS.has(input.boundary_assessment)) reasons.push("BOUNDARY_ADJUSTMENT_REQUESTED");
  if (input.boundary_assessment === "BOUNDARY_AMBIGUOUS") reasons.push("BOUNDARY_AMBIGUOUS");
  if (input.review_mode === "PRECISE") reasons.push("RESEARCHER_REQUESTED_PRECISE");
  return [...new Set(reasons)];
}

export function candidateReviewState(event, candidate) {
  if (!event) return "NOT_REVIEWED";
  return normalizeReviewInput(event, candidate).review_state;
}

function resolveApprovedBoundary({ candidate, boundaryAssessment, reviewMode, manualStart, manualEnd, manualValid, manualChanged }) {
  if (boundaryAssessment === "BOUNDARY_UNUSABLE") return { boundaryStatus: "UNUSABLE", approvedStart: null, approvedEnd: null };
  if (boundaryAssessment === "BOUNDARY_AMBIGUOUS") return { boundaryStatus: "BOUNDARY_UNCERTAIN", approvedStart: null, approvedEnd: null };
  if (ADJUSTMENT_ASSESSMENTS.has(boundaryAssessment)) {
    if (reviewMode === "PRECISE" && manualValid && manualChanged) {
      return { boundaryStatus: "MODIFIED", approvedStart: manualStart, approvedEnd: manualEnd };
    }
    return { boundaryStatus: "NEEDS_REFINEMENT", approvedStart: null, approvedEnd: null };
  }
  if (boundaryAssessment === "BOUNDARY_KEEP_ORIGINAL") {
    const preciseBoundary = reviewMode === "PRECISE" && manualValid;
    return {
      boundaryStatus: preciseBoundary && manualChanged ? "MODIFIED" : "KEEP_ORIGINAL",
      approvedStart: preciseBoundary ? manualStart : candidate.annotated_start_local_frame,
      approvedEnd: preciseBoundary ? manualEnd : candidate.annotated_end_local_frame
    };
  }
  return { boundaryStatus: null, approvedStart: null, approvedEnd: null };
}

function deriveReviewState(input) {
  if (input.review_state === "REVIEW_ON_HOLD" || input.excluded === null) return "REVIEW_ON_HOLD";
  if (input.excluded === true || input.target_validation === "TARGET_MISMATCH" || input.boundary_assessment === "BOUNDARY_UNUSABLE") return "REJECTED";
  const preciseComplete = input.review_mode === "PRECISE" && input.approved_start_local_frame != null && input.approved_end_local_frame != null && (input.manualValid || input.boundary_assessment === "BOUNDARY_KEEP_ORIGINAL");
  if (input.precise_review_required && !preciseComplete) return "PRECISE_REVIEW_REQUIRED";
  if (preciseComplete) return "PRECISE_REVIEW_COMPLETE";
  return "COARSE_REVIEW_COMPLETE";
}

function manualBoundaryValid(candidate, start, end) {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end < candidate.frame_count;
}

function legacyBoundaryAssessment(status) {
  if (status === "KEEP_ORIGINAL") return "BOUNDARY_KEEP_ORIGINAL";
  if (status === "MODIFIED") return "BOUNDARY_BOTH_NEED_ADJUSTMENT";
  if (status === "BOUNDARY_UNCERTAIN") return "BOUNDARY_AMBIGUOUS";
  if (status === "UNUSABLE") return "BOUNDARY_UNUSABLE";
  return null;
}

function parseExcluded(value) {
  if (value === null || value === "HOLD" || value === "null" || value === "") return null;
  if (value === true || String(value).toLowerCase() === "true") return true;
  if (value === false || String(value).toLowerCase() === "false") return false;
  return null;
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
