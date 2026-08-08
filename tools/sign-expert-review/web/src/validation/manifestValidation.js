import { validateFrameMap } from "../player/frameMap.js";

export const REVIEW_BATCH_RECOMMENDED_MAX = 120;
export const REVIEW_BATCH_ABSOLUTE_MAX = 150;

export function validateReviewManifest(manifest) {
  if (manifest?.schema_version !== "sign-expert-review-batch-v1" || manifest.gloss_id !== "좋다1" || manifest.review_padding_sec !== 0.3) {
    return { ok: false, code: "BLOCKED_MANIFEST_INVALID" };
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.manifest_sha256 || "")) return { ok: false, code: "BLOCKED_MANIFEST_INVALID" };
  const candidates = manifest.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return { ok: false, code: "BLOCKED_MANIFEST_INVALID" };
  if (candidates.length > REVIEW_BATCH_ABSOLUTE_MAX) return { ok: false, code: "REVIEW_BATCH_TOO_LARGE" };
  const ids = candidates.map(candidate => candidate.candidate_id);
  if (new Set(ids).size !== ids.length) return { ok: false, code: "BLOCKED_MANIFEST_INVALID" };
  for (const candidate of candidates) {
    const map = validateFrameMap(candidate);
    if (!map.ok) return map;
    if (candidate.annotated_start_local_frame >= candidate.annotated_end_local_frame) return { ok: false, code: "BLOCKED_MANIFEST_INVALID" };
  }
  return { ok: true, code: candidates.length > REVIEW_BATCH_RECOMMENDED_MAX ? "REVIEW_BATCH_ABOVE_RECOMMENDED" : "VALID" };
}
