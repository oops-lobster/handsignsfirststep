#!/usr/bin/env python3
"""Export validated portal decisions into the existing sign-training v2 contract."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from review_common import (
    ReviewBlockedError,
    read_json,
    reduce_latest_events,
    utc_now,
    validate_manifest,
    write_csv,
    write_json,
)


TRAINING_FIELDS = (
    "candidate_id", "word", "gloss_id", "signer_id", "session_id", "source_archive",
    "source_member", "source_video_path", "camera_view", "handedness",
    "annotated_start_sec", "annotated_end_sec", "approved_start_sec", "approved_end_sec",
    "expert_status", "learning_video_allowed", "reference_allowed", "expert_reviewer_code",
    "expert_reviewed_at", "expert_review_revision", "split", "notes",
)
CANDIDATE_EXPORT_FIELDS = (
    "candidate_id", "signer_id", "approved_start_local_frame", "approved_end_local_frame",
    "approved_start_source_sec", "approved_end_source_sec", "learning_video_assessment",
    "reference_assessment", "representative_fit", "review_state", "reviewer_code", "reviewed_at",
)
REJECTED_FIELDS = ("candidate_id", "signer_id", "status", "reason", "target_validation", "boundary_assessment", "boundary_status", "review_state")


def _excluded(event: dict[str, Any]) -> bool:
    return event.get("excluded") is True or str(event.get("excluded")).casefold() == "true"


def _status(learning: bool, reference: bool) -> str:
    if learning and reference:
        return "APPROVED_BOTH"
    if learning:
        return "APPROVED_LEARNING_VIDEO"
    if reference:
        return "APPROVED_REFERENCE"
    return "REJECTED"


def _training_record(candidate: dict[str, Any], event: dict[str, Any], clips_prefix: str) -> dict[str, Any]:
    learning = event["learning_video_assessment"] == "LEARNING_ALLOWED"
    reference = event["reference_assessment"] == "REFERENCE_ALLOWED"
    prefix = clips_prefix.rstrip("/")
    return {
        "candidate_id": candidate["candidate_id"],
        "word": "좋다1",
        "gloss_id": "좋다1",
        "signer_id": candidate["signer_id"],
        "session_id": candidate["session_id"],
        "source_archive": candidate["source_archive_id"],
        "source_member": candidate.get("source_member") or "INTERNAL_ONLY",
        "source_video_path": f"{prefix}/{candidate['candidate_id']}.mp4",
        "camera_view": candidate.get("camera_view") or "NOT_RESOLVED",
        "handedness": candidate.get("handedness") or "NOT_RESOLVED",
        "annotated_start_sec": candidate["annotated_start_source_sec"],
        "annotated_end_sec": candidate["annotated_end_source_sec"],
        "approved_start_sec": float(event["approved_start_source_sec"]),
        "approved_end_sec": float(event["approved_end_source_sec"]),
        "expert_status": _status(learning, reference),
        "learning_video_allowed": learning,
        "reference_allowed": reference,
        "expert_reviewer_code": event["reviewer_code"],
        "expert_reviewed_at": event["reviewed_at"],
        "expert_review_revision": event["revision"],
        "split": "",
        "notes": str(event.get("expert_notes") or ""),
    }


def export(manifest: dict[str, Any], current_document: dict[str, Any], output_dir: Path, clips_prefix: str) -> dict[str, Any]:
    if current_document.get("batch_id") != manifest["batch_id"] or current_document.get("revision") != manifest["revision"]:
        raise ReviewBlockedError("STALE_MANIFEST", "review_current batch/revision does not match the review manifest")
    current, issues = reduce_latest_events(current_document.get("events") or [], manifest)
    if issues:
        raise ReviewBlockedError("INVALID_USAGE_COMBINATION", "review_current contains invalid events", details={"issues": issues})
    events = {event["candidate_id"]: event for event in current}
    approved: list[dict[str, Any]] = []
    learning_candidates: list[dict[str, Any]] = []
    reference_candidates: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for candidate in manifest["candidates"]:
        event = events.get(candidate["candidate_id"])
        reason = ""
        if event is None:
            reason = "REVIEW_INCOMPLETE"
        elif event["target_validation"] != "TARGET_CONFIRMED":
            reason = event["target_validation"]
        elif _excluded(event):
            reason = event.get("exclusion_reason") or "EXCLUDED"
        elif event.get("review_state") in {"PRECISE_REVIEW_REQUIRED", "REVIEW_ON_HOLD"}:
            reason = event["review_state"]
        elif event.get("precise_review_required") and event.get("review_state") != "PRECISE_REVIEW_COMPLETE":
            reason = "PRECISE_REVIEW_REQUIRED"
        elif event["boundary_status"] not in {"KEEP_ORIGINAL", "MODIFIED"}:
            reason = event["boundary_status"]
        elif event.get("approved_start_local_frame") is None or event.get("approved_end_local_frame") is None:
            reason = "APPROVED_BOUNDARY_MISSING"
        elif event["learning_video_assessment"] != "LEARNING_ALLOWED" and event["reference_assessment"] != "REFERENCE_ALLOWED":
            reason = "NO_UNCONDITIONAL_USAGE_APPROVAL"
        if reason:
            rejected.append({
                "candidate_id": candidate["candidate_id"], "signer_id": candidate["signer_id"],
                "status": "REJECTED", "reason": reason,
                "target_validation": event.get("target_validation", "NOT_REVIEWED") if event else "NOT_REVIEWED",
                "boundary_assessment": event.get("boundary_assessment", "NOT_REVIEWED") if event else "NOT_REVIEWED",
                "boundary_status": event.get("boundary_status", "NOT_REVIEWED") if event else "NOT_REVIEWED",
                "review_state": event.get("review_state", "NOT_REVIEWED") if event else "NOT_REVIEWED",
            })
            continue
        record = _training_record(candidate, event, clips_prefix)
        approved.append(record)
        portal_row = {"candidate_id": candidate["candidate_id"], "signer_id": candidate["signer_id"], **event}
        if record["learning_video_allowed"]:
            learning_candidates.append(portal_row)
        if record["reference_allowed"]:
            reference_candidates.append(portal_row)
    output_dir.mkdir(parents=True, exist_ok=True)
    approved_document = {
        "schema_version": "sign-training-manifest-v2",
        "exported_at": utc_now(),
        "source_review_batch": manifest["batch_id"],
        "source_review_revision": manifest["revision"],
        "records": approved,
    }
    write_json(output_dir / "approved-good1-manifest.json", approved_document)
    write_csv(output_dir / "approved-good1-manifest.csv", approved, TRAINING_FIELDS)
    write_csv(output_dir / "learning-video-candidates.csv", learning_candidates, CANDIDATE_EXPORT_FIELDS)
    write_csv(output_dir / "reference-candidates.csv", reference_candidates, CANDIDATE_EXPORT_FIELDS)
    write_csv(output_dir / "rejected-candidates.csv", rejected, REJECTED_FIELDS)
    return {
        "status": "APPROVED_MANIFEST_EXPORTED",
        "approved_count": len(approved),
        "learning_video_count": len(learning_candidates),
        "reference_count": len(reference_candidates),
        "rejected_count": len(rejected),
        "output_dir": str(output_dir),
        "training_executed": False,
        "final_clips_cut": False,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--review-manifest", type=Path, required=True)
    value.add_argument("--review-current", type=Path, required=True)
    value.add_argument("--output-dir", type=Path, required=True)
    value.add_argument("--approved-clips-prefix", default="approved-clips")
    return value


def main() -> int:
    args = parser().parse_args()
    try:
        manifest = validate_manifest(read_json(args.review_manifest))
        current = read_json(args.review_current)
        report = export(manifest, current, args.output_dir, args.approved_clips_prefix)
    except ReviewBlockedError as exc:
        print(json.dumps(exc.as_dict(), ensure_ascii=False, indent=2))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
