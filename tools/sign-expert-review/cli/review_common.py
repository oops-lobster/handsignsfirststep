#!/usr/bin/env python3
"""Shared, dependency-free contracts for the restricted expert-review tool."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


TARGET_GLOSS_ID = "좋다1"
REVIEW_PADDING_SEC = 0.3
REVIEW_EVENT_HEADERS = (
    "event_id", "batch_id", "candidate_id", "revision", "reviewer_code",
    "reviewed_at", "client_version", "review_mode", "review_state",
    "target_validation", "boundary_assessment", "precise_review_required",
    "precise_review_reason", "boundary_confidence",
    "annotated_start_local_frame", "annotated_end_local_frame",
    "auto_proposed_start_local_frame", "auto_proposed_end_local_frame",
    "auto_proposed_start_source_sec", "auto_proposed_end_source_sec",
    "manual_start_local_frame", "manual_end_local_frame",
    "manual_start_source_sec", "manual_end_source_sec",
    "approved_start_local_frame", "approved_end_local_frame",
    "approved_start_source_sec", "approved_end_source_sec", "boundary_status",
    "learning_video_assessment", "reference_assessment", "learning_allowed",
    "reference_allowed", "representative_fit", "representative_fit_legacy",
    "sentence_connection_effect", "sentence_connection_effect_legacy", "excluded",
    "exclusion_reason", "expert_notes", "review_duration_ms", "interaction_count",
    "clip_sha256", "manifest_sha256", "content_hash", "save_status",
)
TARGET_VALIDATIONS = {"TARGET_CONFIRMED", "TARGET_MISMATCH", "TARGET_UNCERTAIN"}
BOUNDARY_ASSESSMENTS = {
    "BOUNDARY_KEEP_ORIGINAL", "BOUNDARY_START_TOO_EARLY", "BOUNDARY_START_TOO_LATE",
    "BOUNDARY_END_TOO_EARLY", "BOUNDARY_END_TOO_LATE", "BOUNDARY_BOTH_NEED_ADJUSTMENT",
    "BOUNDARY_AMBIGUOUS", "BOUNDARY_UNUSABLE",
}
ADJUSTMENT_ASSESSMENTS = {
    "BOUNDARY_START_TOO_EARLY", "BOUNDARY_START_TOO_LATE", "BOUNDARY_END_TOO_EARLY",
    "BOUNDARY_END_TOO_LATE", "BOUNDARY_BOTH_NEED_ADJUSTMENT",
}
BOUNDARY_STATUSES = {"KEEP_ORIGINAL", "MODIFIED", "NEEDS_REFINEMENT", "BOUNDARY_UNCERTAIN", "UNUSABLE"}
USAGE_STATUSES = {"ALLOWED", "CONDITIONAL", "NOT_ALLOWED", "UNSURE"}
LEARNING_ASSESSMENTS = {"LEARNING_ALLOWED", "LEARNING_CONDITIONAL", "LEARNING_NOT_ALLOWED", "LEARNING_UNCERTAIN"}
REFERENCE_ASSESSMENTS = {"REFERENCE_ALLOWED", "REFERENCE_CONDITIONAL", "REFERENCE_NOT_ALLOWED", "REFERENCE_UNCERTAIN"}
REPRESENTATIVE_ASSESSMENTS = {"REPRESENTATIVE_HIGH", "REPRESENTATIVE_MEDIUM", "REPRESENTATIVE_LOW", "REPRESENTATIVE_UNSUITABLE", "REPRESENTATIVE_UNCERTAIN"}
CONNECTION_ASSESSMENTS = {"CONNECTION_NONE", "CONNECTION_MINOR", "CONNECTION_MAJOR", "CONNECTION_UNCERTAIN"}
REVIEW_STATES = {"COARSE_REVIEW_COMPLETE", "PRECISE_REVIEW_REQUIRED", "PRECISE_REVIEW_COMPLETE", "REVIEW_ON_HOLD", "REJECTED"}
REVIEW_BATCH_RECOMMENDED_MAX = 120
REVIEW_BATCH_ABSOLUTE_MAX = 150

LEARNING_TO_LEGACY = {"LEARNING_ALLOWED": "ALLOWED", "LEARNING_CONDITIONAL": "CONDITIONAL", "LEARNING_NOT_ALLOWED": "NOT_ALLOWED", "LEARNING_UNCERTAIN": "UNSURE"}
REFERENCE_TO_LEGACY = {"REFERENCE_ALLOWED": "ALLOWED", "REFERENCE_CONDITIONAL": "CONDITIONAL", "REFERENCE_NOT_ALLOWED": "NOT_ALLOWED", "REFERENCE_UNCERTAIN": "UNSURE"}
REPRESENTATIVE_TO_LEGACY = {"REPRESENTATIVE_HIGH": "HIGH", "REPRESENTATIVE_MEDIUM": "MEDIUM", "REPRESENTATIVE_LOW": "LOW", "REPRESENTATIVE_UNSUITABLE": "UNSUITABLE", "REPRESENTATIVE_UNCERTAIN": "UNSURE"}
CONNECTION_TO_LEGACY = {"CONNECTION_NONE": "NONE", "CONNECTION_MINOR": "MINOR", "CONNECTION_MAJOR": "PRESENT", "CONNECTION_UNCERTAIN": "UNSURE"}


class ReviewBlockedError(RuntimeError):
    def __init__(self, code: str, message: str, *, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}

    def as_dict(self) -> dict[str, Any]:
        return {"status": self.code, "message": str(self), "details": self.details}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"cannot read JSON: {path}") from exc


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def manifest_content_sha256(manifest: dict[str, Any]) -> str:
    value = dict(manifest)
    value.pop("manifest_sha256", None)
    return canonical_sha256(value)


def _number(value: Any, field: str, candidate_id: str) -> float:
    if isinstance(value, bool):
        raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"{candidate_id}: {field} must be numeric")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"{candidate_id}: {field} must be numeric") from exc
    if not math.isfinite(number) or number < 0:
        raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"{candidate_id}: {field} must be finite and non-negative")
    return number


def _ascending(values: list[Any]) -> bool:
    return all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 and (index == 0 or value > values[index - 1]) for index, value in enumerate(values))


def validate_manifest(manifest: Any, *, verify_manifest_hash: bool = True) -> dict[str, Any]:
    if not isinstance(manifest, dict) or manifest.get("schema_version") != "sign-expert-review-batch-v1":
        raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", "unsupported review batch schema")
    if manifest.get("gloss_id") != TARGET_GLOSS_ID:
        raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", "exact gloss_id must be 좋다1")
    if float(manifest.get("review_padding_sec", -1)) != REVIEW_PADDING_SEC:
        raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", "review_padding_sec must be exactly 0.3")
    for field in ("batch_id", "revision", "created_at"):
        if not str(manifest.get(field) or "").strip():
            raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"{field} is required")
    expected_manifest_hash = str(manifest.get("manifest_sha256") or "")
    if len(expected_manifest_hash) != 64 or any(character not in "0123456789abcdef" for character in expected_manifest_hash):
        raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", "manifest_sha256 must be lowercase SHA-256")
    actual_manifest_hash = manifest_content_sha256(manifest)
    if verify_manifest_hash and expected_manifest_hash != actual_manifest_hash:
        raise ReviewBlockedError(
            "BLOCKED_MANIFEST_INVALID",
            "manifest_sha256 does not match canonical manifest content",
            details={"expected": expected_manifest_hash, "actual": actual_manifest_hash},
        )
    candidates = manifest.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", "candidates must be a non-empty array")
    if len(candidates) > REVIEW_BATCH_ABSOLUTE_MAX:
        raise ReviewBlockedError("REVIEW_BATCH_TOO_LARGE", f"expert review batch exceeds the absolute limit of {REVIEW_BATCH_ABSOLUTE_MAX}")
    identifiers: set[str] = set()
    for candidate in candidates:
        if not isinstance(candidate, dict):
            raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", "candidate must be an object")
        candidate_id = str(candidate.get("candidate_id") or "").strip()
        if not candidate_id:
            raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", "candidate_id is required")
        if candidate_id in identifiers:
            raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"duplicate candidate_id: {candidate_id}")
        identifiers.add(candidate_id)
        for field in ("signer_id", "session_id", "source_archive_id", "clip_filename", "clip_sha256"):
            if not str(candidate.get(field) or "").strip():
                raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"{candidate_id}: {field} is required")
        if not str(candidate["clip_filename"]).casefold().endswith(".mp4"):
            raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"{candidate_id}: clip must be MP4")
        if len(str(candidate["clip_sha256"])) != 64:
            raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"{candidate_id}: invalid clip_sha256")
        if candidate.get("fps_mode") != "CFR":
            raise ReviewBlockedError("VARIABLE_FRAME_RATE_UNSUPPORTED", f"{candidate_id}: only CFR review clips are supported")
        frame_count = candidate.get("frame_count")
        local_pts = candidate.get("frame_pts_sec")
        source_pts = candidate.get("source_frame_pts_sec")
        if not isinstance(frame_count, int) or frame_count < 2 or not isinstance(local_pts, list) or not isinstance(source_pts, list):
            raise ReviewBlockedError("BLOCKED_FRAME_MAP_MISSING", f"{candidate_id}: frame map is missing")
        if len(local_pts) != frame_count or len(source_pts) != frame_count or not _ascending(local_pts) or not _ascending(source_pts):
            raise ReviewBlockedError("BLOCKED_FRAME_MAP_MISSING", f"{candidate_id}: frame map count/order mismatch")
        start = candidate.get("annotated_start_local_frame")
        end = candidate.get("annotated_end_local_frame")
        if not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end < frame_count:
            raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"{candidate_id}: annotated frames are invalid")
        review_start = _number(candidate.get("review_start_source_sec"), "review_start_source_sec", candidate_id)
        review_end = _number(candidate.get("review_end_source_sec"), "review_end_source_sec", candidate_id)
        if review_start >= review_end or source_pts[0] < review_start - 1e-6 or source_pts[-1] > review_end + 1e-6:
            raise ReviewBlockedError("BLOCKED_FRAME_MAP_MISSING", f"{candidate_id}: source PTS leaves review range")
    return manifest


def probe_mp4(path: Path) -> dict[str, Any]:
    try:
        process = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=codec_name,pix_fmt,r_frame_rate,avg_frame_rate,nb_frames,duration",
                "-of", "json", str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        streams = json.loads(process.stdout).get("streams") or []
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"clip is not decodable: {path.name}") from exc
    if not streams:
        raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"clip has no video stream: {path.name}")
    return streams[0]


def verify_clip(candidate: dict[str, Any], clips_dir: Path, *, probe: bool = True) -> dict[str, Any]:
    clip = clips_dir / str(candidate["clip_filename"])
    if clip.is_symlink() or not clip.exists() or not clip.is_file():
        raise ReviewBlockedError("BLOCKED_CLIP_MISSING", f"clip missing: {candidate['clip_filename']}")
    actual_hash = sha256_file(clip)
    if actual_hash != candidate["clip_sha256"]:
        raise ReviewBlockedError(
            "BLOCKED_FILE_CHANGED", f"clip checksum changed: {candidate['candidate_id']}",
            details={"expected": candidate["clip_sha256"], "actual": actual_hash},
        )
    info: dict[str, Any] = {
        "candidate_id": candidate["candidate_id"], "path": str(clip),
        "size_bytes": clip.stat().st_size, "sha256": actual_hash,
    }
    if probe:
        stream = probe_mp4(clip)
        if stream.get("codec_name") != "h264":
            raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", f"{candidate['candidate_id']}: codec must be H.264")
        if stream.get("avg_frame_rate") != stream.get("r_frame_rate"):
            raise ReviewBlockedError("VARIABLE_FRAME_RATE_UNSUPPORTED", f"{candidate['candidate_id']}: ffprobe detected non-CFR timing")
        if int(stream.get("nb_frames") or 0) != candidate["frame_count"]:
            raise ReviewBlockedError("BLOCKED_FRAME_MAP_MISSING", f"{candidate['candidate_id']}: decoded frame count differs from manifest")
        info["probe"] = stream
    return info


@dataclass(frozen=True)
class QuotaPlan:
    limit_bytes: int
    usage_bytes: int
    usage_in_drive_bytes: int
    trash_bytes: int
    available_bytes: int
    planned_upload_bytes: int
    headroom_bytes: int
    expected_final_usage_bytes: int
    fits: bool
    excess_bytes: int

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def quota_plan(storage_quota: dict[str, Any], planned_upload_bytes: int, headroom_percent: float = 10.0) -> QuotaPlan:
    try:
        limit = int(storage_quota["limit"])
        usage = int(storage_quota["usage"])
        in_drive = int(storage_quota.get("usageInDrive", 0))
        trash = int(storage_quota.get("usageInDriveTrash", 0))
    except (KeyError, TypeError, ValueError) as exc:
        raise ReviewBlockedError("BLOCKED_INSUFFICIENT_DRIVE_SPACE", "Drive storageQuota limit and usage are required") from exc
    if min(limit, usage, in_drive, trash, planned_upload_bytes) < 0 or not 0 <= headroom_percent < 100:
        raise ReviewBlockedError("BLOCKED_INSUFFICIENT_DRIVE_SPACE", "invalid quota or headroom configuration")
    headroom = math.ceil(limit * headroom_percent / 100)
    available = max(0, limit - usage)
    final_usage = usage + planned_upload_bytes
    allowed_usage = limit - headroom
    fits = final_usage <= allowed_usage
    return QuotaPlan(limit, usage, in_drive, trash, available, planned_upload_bytes, headroom, final_usage, fits, max(0, final_usage - allowed_usage))


def _nullable_number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _nullable_int(value: Any) -> int | None:
    number = _nullable_number(value)
    return int(number) if number is not None and number.is_integer() else None


def _excluded_value(value: Any) -> bool | None:
    if value in (None, "", "HOLD", "null"):
        return None
    if value is True or str(value).casefold() == "true":
        return True
    if value is False or str(value).casefold() == "false":
        return False
    return None


def _legacy_boundary_assessment(status: Any) -> str | None:
    return {
        "KEEP_ORIGINAL": "BOUNDARY_KEEP_ORIGINAL",
        "MODIFIED": "BOUNDARY_BOTH_NEED_ADJUSTMENT",
        "BOUNDARY_UNCERTAIN": "BOUNDARY_AMBIGUOUS",
        "UNUSABLE": "BOUNDARY_UNUSABLE",
    }.get(str(status or ""))


def _precise_reasons(event: dict[str, Any], candidate: dict[str, Any], boundary_assessment: str | None) -> list[str]:
    reasons: list[str] = []
    if candidate.get("precise_review_required"):
        reasons.append(str(candidate.get("precise_review_reason") or "OPERATOR_REQUIRED"))
    if candidate.get("representative_final_candidate"):
        reasons.append("REPRESENTATIVE_FINAL_CANDIDATE")
    confidence = event.get("boundary_confidence", candidate.get("boundary_confidence"))
    if (isinstance(confidence, (int, float)) and not isinstance(confidence, bool) and confidence < 0.7) or str(confidence or "").upper() == "LOW":
        reasons.append("LOW_BOUNDARY_CONFIDENCE")
    if boundary_assessment in ADJUSTMENT_ASSESSMENTS:
        reasons.append("BOUNDARY_ADJUSTMENT_REQUESTED")
    if boundary_assessment == "BOUNDARY_AMBIGUOUS":
        reasons.append("BOUNDARY_AMBIGUOUS")
    if event.get("review_mode") == "PRECISE":
        reasons.append("RESEARCHER_REQUESTED_PRECISE")
    return list(dict.fromkeys(reasons))


def normalize_event(event: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    value = dict(event)
    inverse_learning = {legacy: current for current, legacy in LEARNING_TO_LEGACY.items()}
    inverse_reference = {legacy: current for current, legacy in REFERENCE_TO_LEGACY.items()}
    inverse_representative = {legacy: current for current, legacy in REPRESENTATIVE_TO_LEGACY.items()}
    inverse_connection = {legacy: current for current, legacy in CONNECTION_TO_LEGACY.items()}
    boundary_assessment = value.get("boundary_assessment") or _legacy_boundary_assessment(value.get("boundary_status"))
    learning = value.get("learning_video_assessment") or inverse_learning.get(value.get("learning_allowed"))
    reference = value.get("reference_assessment") or inverse_reference.get(value.get("reference_allowed"))
    representative = value.get("representative_fit")
    if representative not in REPRESENTATIVE_ASSESSMENTS:
        representative = inverse_representative.get(representative)
    connection = value.get("sentence_connection_effect")
    if connection not in CONNECTION_ASSESSMENTS:
        connection = inverse_connection.get(connection)
    legacy_modified = value.get("boundary_status") == "MODIFIED"
    review_mode = value.get("review_mode") or ("PRECISE" if legacy_modified else "COARSE")
    manual_start = _nullable_int(value.get("manual_start_local_frame", value.get("approved_start_local_frame") if legacy_modified else None))
    manual_end = _nullable_int(value.get("manual_end_local_frame", value.get("approved_end_local_frame") if legacy_modified else None))
    manual_valid = manual_start is not None and manual_end is not None and 0 <= manual_start < manual_end < candidate["frame_count"]
    manual_changed = manual_valid and (manual_start != candidate["annotated_start_local_frame"] or manual_end != candidate["annotated_end_local_frame"])
    reasons = _precise_reasons(value, candidate, boundary_assessment)
    precise_required = str(value.get("precise_review_required", "")).casefold() == "true" or bool(value.get("precise_review_required") is True) or bool(reasons)
    approved_start: int | None = None
    approved_end: int | None = None
    boundary_status: str | None = None
    if boundary_assessment == "BOUNDARY_UNUSABLE":
        boundary_status = "UNUSABLE"
    elif boundary_assessment == "BOUNDARY_AMBIGUOUS":
        boundary_status = "BOUNDARY_UNCERTAIN"
    elif boundary_assessment in ADJUSTMENT_ASSESSMENTS:
        if review_mode == "PRECISE" and manual_valid and manual_changed:
            boundary_status, approved_start, approved_end = "MODIFIED", manual_start, manual_end
        else:
            boundary_status = "NEEDS_REFINEMENT"
    elif boundary_assessment == "BOUNDARY_KEEP_ORIGINAL":
        if review_mode == "PRECISE" and manual_valid:
            approved_start, approved_end = manual_start, manual_end
        else:
            approved_start, approved_end = candidate["annotated_start_local_frame"], candidate["annotated_end_local_frame"]
        boundary_status = "MODIFIED" if manual_valid and manual_changed else "KEEP_ORIGINAL"
    excluded = _excluded_value(value.get("excluded"))
    precise_complete = review_mode == "PRECISE" and approved_start is not None and approved_end is not None and (manual_valid or boundary_assessment == "BOUNDARY_KEEP_ORIGINAL")
    if value.get("review_state") == "REVIEW_ON_HOLD" or excluded is None:
        review_state = "REVIEW_ON_HOLD"
    elif excluded or value.get("target_validation") == "TARGET_MISMATCH" or boundary_assessment == "BOUNDARY_UNUSABLE":
        review_state = "REJECTED"
    elif precise_required and not precise_complete:
        review_state = "PRECISE_REVIEW_REQUIRED"
    elif precise_complete:
        review_state = "PRECISE_REVIEW_COMPLETE"
    else:
        review_state = "COARSE_REVIEW_COMPLETE"
    value.update({
        "review_mode": review_mode, "review_state": review_state,
        "boundary_assessment": boundary_assessment, "precise_review_required": precise_required,
        "precise_review_reason": str(value.get("precise_review_reason") or "; ".join(reasons)),
        "boundary_confidence": value.get("boundary_confidence", candidate.get("boundary_confidence")),
        "auto_proposed_start_local_frame": _nullable_int(value.get("auto_proposed_start_local_frame", candidate.get("auto_proposed_start_local_frame"))),
        "auto_proposed_end_local_frame": _nullable_int(value.get("auto_proposed_end_local_frame", candidate.get("auto_proposed_end_local_frame"))),
        "auto_proposed_start_source_sec": _nullable_number(value.get("auto_proposed_start_source_sec", candidate.get("auto_proposed_start_source_sec"))),
        "auto_proposed_end_source_sec": _nullable_number(value.get("auto_proposed_end_source_sec", candidate.get("auto_proposed_end_source_sec"))),
        "manual_start_local_frame": manual_start if review_mode == "PRECISE" and manual_valid else None,
        "manual_end_local_frame": manual_end if review_mode == "PRECISE" and manual_valid else None,
        "manual_start_source_sec": candidate["source_frame_pts_sec"][manual_start] if review_mode == "PRECISE" and manual_valid else None,
        "manual_end_source_sec": candidate["source_frame_pts_sec"][manual_end] if review_mode == "PRECISE" and manual_valid else None,
        "approved_start_local_frame": approved_start, "approved_end_local_frame": approved_end,
        "approved_start_source_sec": candidate["source_frame_pts_sec"][approved_start] if approved_start is not None else None,
        "approved_end_source_sec": candidate["source_frame_pts_sec"][approved_end] if approved_end is not None else None,
        "boundary_status": boundary_status, "learning_video_assessment": learning,
        "reference_assessment": reference, "learning_allowed": LEARNING_TO_LEGACY.get(learning, value.get("learning_allowed")),
        "reference_allowed": REFERENCE_TO_LEGACY.get(reference, value.get("reference_allowed")),
        "representative_fit": representative, "representative_fit_legacy": REPRESENTATIVE_TO_LEGACY.get(representative),
        "sentence_connection_effect": connection, "sentence_connection_effect_legacy": CONNECTION_TO_LEGACY.get(connection),
        "excluded": excluded, "review_duration_ms": int(_nullable_number(value.get("review_duration_ms")) or 0),
        "interaction_count": int(_nullable_number(value.get("interaction_count")) or 0),
    })
    return value


def validate_event(event: Any, manifest: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(event, dict):
        raise ReviewBlockedError("INVALID_USAGE_COMBINATION", "review event must be an object")
    for field in ("event_id", "batch_id", "candidate_id", "revision", "reviewer_code", "reviewed_at", "client_version", "target_validation", "clip_sha256", "manifest_sha256"):
        if field not in event:
            raise ReviewBlockedError("INVALID_USAGE_COMBINATION", f"event missing {field}")
    if event.get("batch_id") != manifest["batch_id"] or event.get("candidate_id") != candidate["candidate_id"]:
        raise ReviewBlockedError("INVALID_TARGET", "event does not belong to this candidate/batch")
    if event.get("revision") != manifest["revision"]:
        raise ReviewBlockedError("STALE_MANIFEST", f"{candidate['candidate_id']}: stale revision")
    if event.get("clip_sha256") != candidate["clip_sha256"] or event.get("manifest_sha256") != manifest["manifest_sha256"]:
        raise ReviewBlockedError("CLIP_CHANGED", f"{candidate['candidate_id']}: clip or manifest changed")
    value = normalize_event(event, candidate)
    if value.get("target_validation") not in TARGET_VALIDATIONS or value.get("boundary_assessment") not in BOUNDARY_ASSESSMENTS:
        raise ReviewBlockedError("INVALID_TARGET", f"{candidate['candidate_id']}: unsupported target or boundary decision")
    if value.get("learning_video_assessment") not in LEARNING_ASSESSMENTS or value.get("reference_assessment") not in REFERENCE_ASSESSMENTS:
        raise ReviewBlockedError("INVALID_USAGE_COMBINATION", f"{candidate['candidate_id']}: unsupported usage decision")
    if value.get("representative_fit") not in REPRESENTATIVE_ASSESSMENTS or value.get("sentence_connection_effect") not in CONNECTION_ASSESSMENTS:
        raise ReviewBlockedError("INVALID_USAGE_COMBINATION", f"{candidate['candidate_id']}: incomplete representative or connection decision")
    if value.get("review_state") not in REVIEW_STATES or value.get("boundary_status") not in BOUNDARY_STATUSES:
        raise ReviewBlockedError("INVALID_BOUNDARY", f"{candidate['candidate_id']}: invalid derived review state")
    start, end = value.get("approved_start_local_frame"), value.get("approved_end_local_frame")
    if (start is None) != (end is None):
        raise ReviewBlockedError("INVALID_BOUNDARY", f"{candidate['candidate_id']}: incomplete approved boundary")
    if start is not None and not 0 <= start < end < candidate["frame_count"]:
        raise ReviewBlockedError("INVALID_BOUNDARY", f"{candidate['candidate_id']}: invalid approved frame range")
    if value.get("target_validation") == "TARGET_MISMATCH":
        if value.get("learning_video_assessment") == "LEARNING_ALLOWED" or value.get("reference_assessment") == "REFERENCE_ALLOWED" or value.get("representative_fit") not in {"REPRESENTATIVE_UNSUITABLE", "REPRESENTATIVE_UNCERTAIN"} or value.get("excluded") is False:
            raise ReviewBlockedError("INVALID_TARGET", f"{candidate['candidate_id']}: mismatch cannot be approved")
    if value.get("excluded") is True and (value.get("learning_video_assessment") == "LEARNING_ALLOWED" or value.get("reference_assessment") == "REFERENCE_ALLOWED"):
        raise ReviewBlockedError("INVALID_USAGE_COMBINATION", f"{candidate['candidate_id']}: excluded event allows usage")
    if value.get("boundary_assessment") == "BOUNDARY_UNUSABLE" and value.get("excluded") is not True:
        raise ReviewBlockedError("INVALID_USAGE_COMBINATION", f"{candidate['candidate_id']}: unusable must be excluded")
    if value.get("excluded") is True and not str(value.get("exclusion_reason") or "").strip():
        raise ReviewBlockedError("INVALID_USAGE_COMBINATION", f"{candidate['candidate_id']}: exclusion reason is required")
    notes_required = (
        value.get("learning_video_assessment") == "LEARNING_CONDITIONAL" or value.get("reference_assessment") == "REFERENCE_CONDITIONAL" or
        value.get("excluded") is True or value.get("target_validation") == "TARGET_MISMATCH" or
        value.get("boundary_assessment") in {"BOUNDARY_AMBIGUOUS", "BOUNDARY_UNUSABLE"} or
        (value.get("precise_review_required") and value.get("review_state") == "PRECISE_REVIEW_REQUIRED")
    )
    if notes_required and not str(value.get("expert_notes") or "").strip():
        raise ReviewBlockedError("INVALID_USAGE_COMBINATION", f"{candidate['candidate_id']}: this decision needs notes")
    return value


def read_events(path: Path) -> list[dict[str, Any]]:
    if path.suffix.casefold() == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return [dict(row) for row in csv.DictReader(handle)]
    value = read_json(path)
    events = value.get("events") if isinstance(value, dict) else value
    if not isinstance(events, list) or not all(isinstance(event, dict) for event in events):
        raise ReviewBlockedError("INVALID_USAGE_COMBINATION", "review results must contain an event array")
    return events


def reduce_latest_events(events: Iterable[dict[str, Any]], manifest: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    candidates = {candidate["candidate_id"]: candidate for candidate in manifest["candidates"]}
    seen_ids: set[str] = set()
    latest: dict[str, dict[str, Any]] = {}
    issues: list[dict[str, Any]] = []
    for row_number, event in enumerate(events, 2):
        event_id = str(event.get("event_id") or "")
        if event_id in seen_ids:
            issues.append({"row": row_number, "candidate_id": event.get("candidate_id"), "status": "DUPLICATE_EVENT_ID"})
            continue
        seen_ids.add(event_id)
        candidate = candidates.get(str(event.get("candidate_id") or ""))
        if candidate is None:
            issues.append({"row": row_number, "candidate_id": event.get("candidate_id"), "status": "UNKNOWN_CANDIDATE"})
            continue
        try:
            normalized = validate_event(event, manifest, candidate)
        except ReviewBlockedError as exc:
            issues.append({"row": row_number, "candidate_id": candidate["candidate_id"], "status": exc.code, "message": str(exc)})
            continue
        current = latest.get(candidate["candidate_id"])
        event_key = (str(normalized.get("reviewed_at") or ""), event_id)
        current_key = (str(current.get("reviewed_at") or ""), str(current.get("event_id") or "")) if current else ("", "")
        if current is None or event_key > current_key:
            latest[candidate["candidate_id"]] = normalized
    ordered = [latest[candidate["candidate_id"]] for candidate in manifest["candidates"] if candidate["candidate_id"] in latest]
    return ordered, issues


def write_csv(path: Path, rows: Iterable[dict[str, Any]], headers: Iterable[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(headers), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
