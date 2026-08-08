#!/usr/bin/env python3
"""Fetch append-only review events and export a validated current-state snapshot."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

from review_common import (
    REVIEW_EVENT_HEADERS,
    ReviewBlockedError,
    read_events,
    read_json,
    reduce_latest_events,
    utc_now,
    validate_manifest,
    write_csv,
    write_json,
)


# Reuse the same Sheets grant as the desktop sync client. Requesting the
# separate readonly scope from the shared token file would force a second OAuth
# grant even when the existing full Sheets grant is already sufficient.
SHEETS_SCOPES = ("https://www.googleapis.com/auth/spreadsheets",)


def google_events(credentials_dir: Path, spreadsheet_id: str, tab: str) -> list[dict[str, Any]]:
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise ReviewBlockedError("BLOCKED_GOOGLE_AUTH", "Google client libraries are not installed") from exc
    credentials_dir.mkdir(parents=True, exist_ok=True)
    secrets_path = credentials_dir / "client_secrets.json"
    token_path = credentials_dir / "token.json"
    if not secrets_path.exists():
        raise ReviewBlockedError("BLOCKED_GOOGLE_AUTH", "client_secrets.json is missing")
    credentials = Credentials.from_authorized_user_file(str(token_path), SHEETS_SCOPES) if token_path.exists() else None
    if credentials and credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
    if not credentials or not credentials.valid:
        credentials = InstalledAppFlow.from_client_secrets_file(str(secrets_path), SHEETS_SCOPES).run_local_server(port=0)
        token_path.write_text(credentials.to_json(), encoding="utf-8")
        token_path.chmod(0o600)
    sheets = build("sheets", "v4", credentials=credentials, cache_discovery=False)
    escaped = tab.replace("'", "''")
    try:
        rows = sheets.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=f"'{escaped}'!A:AT").execute().get("values") or []
    except Exception as exc:
        raise ReviewBlockedError("GOOGLE_ACCOUNT_NOT_AUTHORIZED", "cannot read review_events") from exc
    if not rows:
        return []
    headers = rows[0]
    if headers != list(REVIEW_EVENT_HEADERS):
        raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", "review_events headers do not match the required contract")
    return [dict(zip(headers, row + [""] * (len(headers) - len(row)))) for row in rows[1:]]


def build_reports(manifest: dict[str, Any], events: list[dict[str, Any]], output_dir: Path) -> dict[str, Any]:
    current, issues = reduce_latest_events(events, manifest)
    current_by_id = {event["candidate_id"]: event for event in current}
    completed_ids = {event["candidate_id"] for event in current}
    incomplete = [candidate["candidate_id"] for candidate in manifest["candidates"] if candidate["candidate_id"] not in completed_ids]
    reviewers = Counter(str(event.get("reviewer_code") or "UNKNOWN") for event in current)
    coarse_states = {"COARSE_REVIEW_COMPLETE", "PRECISE_REVIEW_REQUIRED", "PRECISE_REVIEW_COMPLETE", "REJECTED"}
    coarse_completed = [event for event in current if event.get("review_state") in coarse_states]
    precise_pending: list[dict[str, Any]] = []
    for candidate in manifest["candidates"]:
        event = current_by_id.get(candidate["candidate_id"])
        confidence = candidate.get("boundary_confidence")
        operator_required = bool(candidate.get("precise_review_required") or candidate.get("representative_final_candidate") or (isinstance(confidence, (int, float)) and confidence < 0.7) or str(confidence or "").upper() == "LOW")
        if event and event.get("review_state") == "PRECISE_REVIEW_REQUIRED" or not event and operator_required:
            precise_pending.append({
                "candidate_id": candidate["candidate_id"], "signer_id": candidate["signer_id"],
                "review_state": event.get("review_state") if event else "PRECISE_REVIEW_REQUIRED",
                "boundary_assessment": event.get("boundary_assessment") if event else "NOT_REVIEWED",
                "precise_review_reason": event.get("precise_review_reason") if event else candidate.get("precise_review_reason") or "OPERATOR_REQUIRED",
                "reviewer_code": event.get("reviewer_code") if event else "",
            })
    output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(output_dir / "review_events_raw.csv", events, REVIEW_EVENT_HEADERS)
    current_document = {
        "schema_version": "sign-expert-review-current-v1",
        "batch_id": manifest["batch_id"],
        "revision": manifest["revision"],
        "generated_at": utc_now(),
        "events": current,
    }
    write_json(output_dir / "review_current.json", current_document)
    write_csv(output_dir / "review_current.csv", current, REVIEW_EVENT_HEADERS)
    precise_headers = ("candidate_id", "signer_id", "review_state", "boundary_assessment", "precise_review_reason", "reviewer_code")
    write_json(output_dir / "precise-review-required.json", {
        "schema_version": "sign-expert-review-precise-required-v1", "batch_id": manifest["batch_id"],
        "revision": manifest["revision"], "generated_at": utc_now(), "candidates": precise_pending,
    })
    write_csv(output_dir / "precise-review-required.csv", precise_pending, precise_headers)
    precise_lines = ["# Precise review required", "", f"- Count: `{len(precise_pending)}`", ""]
    precise_lines.extend(f"- `{row['candidate_id']}` · `{row['boundary_assessment']}` · {row['precise_review_reason']}" for row in precise_pending)
    if not precise_pending:
        precise_lines.append("- None")
    (output_dir / "precise-review-required.md").write_text("\n".join(precise_lines) + "\n", encoding="utf-8")

    def count(field: str, value: Any) -> int:
        return sum(1 for event in current if event.get(field) == value)

    reviewed_count = len(current)
    ratio = lambda numerator: round(numerator / reviewed_count * 100, 2) if reviewed_count else 0.0
    durations = [int(event.get("review_duration_ms") or 0) for event in current if int(event.get("review_duration_ms") or 0) > 0]
    clicks = [int(event.get("interaction_count") or 0) for event in current if int(event.get("interaction_count") or 0) > 0]
    signer_totals = Counter(candidate["signer_id"] for candidate in manifest["candidates"])
    signer_completed = Counter(next(candidate["signer_id"] for candidate in manifest["candidates"] if candidate["candidate_id"] == event["candidate_id"]) for event in coarse_completed)
    statistics = {
        "batch_total": len(manifest["candidates"]), "coarse_review_completed": len(coarse_completed),
        "precise_review_required": len(precise_pending), "precise_review_completed": count("review_state", "PRECISE_REVIEW_COMPLETE"),
        "target_confirmed_percent": ratio(count("target_validation", "TARGET_CONFIRMED")),
        "target_mismatch_percent": ratio(count("target_validation", "TARGET_MISMATCH")),
        "boundary_keep_original_percent": ratio(count("boundary_assessment", "BOUNDARY_KEEP_ORIGINAL")),
        "boundary_adjustment_percent": ratio(sum(1 for event in current if event.get("boundary_status") in {"NEEDS_REFINEMENT", "MODIFIED"})),
        "boundary_ambiguous_percent": ratio(count("boundary_assessment", "BOUNDARY_AMBIGUOUS")),
        "learning_allowed_percent": ratio(count("learning_video_assessment", "LEARNING_ALLOWED")),
        "reference_allowed_percent": ratio(count("reference_assessment", "REFERENCE_ALLOWED")),
        "excluded_percent": ratio(sum(1 for event in current if event.get("excluded") is True)),
        "average_review_seconds": round(sum(durations) / len(durations) / 1000, 2) if durations else None,
        "average_interaction_count": round(sum(clicks) / len(clicks), 2) if clicks else None,
        "unsynced_event_count": sum(1 for event in events if event.get("save_status") == "SYNC_PENDING"),
        "signer_completion": {signer: {"completed": signer_completed[signer], "total": total, "percent": round(signer_completed[signer] / total * 100, 2)} for signer, total in sorted(signer_totals.items())},
    }
    write_json(output_dir / "review_statistics.json", statistics)
    progress_lines = [
        "# Expert review progress", "",
        f"- Batch: `{manifest['batch_id']}`", f"- Revision: `{manifest['revision']}`",
        f"- Coarse complete: `{len(coarse_completed)} / {len(manifest['candidates'])}`", f"- Precise pending: `{len(precise_pending)}`",
        f"- Precise complete: `{statistics['precise_review_completed']}`", f"- Remaining without event: `{len(incomplete)}`", "",
        "## Reviewer totals", "",
    ]
    progress_lines.extend(f"- `{reviewer}`: {count}" for reviewer, count in sorted(reviewers.items()))
    progress_lines.extend(["", "## Incomplete candidates", ""])
    progress_lines.extend(f"- `{candidate_id}`" for candidate_id in incomplete)
    if not incomplete:
        progress_lines.append("- None")
    (output_dir / "review_progress.md").write_text("\n".join(progress_lines) + "\n", encoding="utf-8")
    validation_lines = [
        "# Review validation report", "",
        f"- Raw events: `{len(events)}`", f"- Latest valid events: `{len(current)}`",
        f"- Validation issues: `{len(issues)}`", "",
    ]
    for issue in issues:
        validation_lines.append(f"- row `{issue.get('row')}` · `{issue.get('candidate_id')}` · `{issue.get('status')}` {issue.get('message', '')}")
    if not issues:
        validation_lines.append("- No invalid, duplicate, unknown, or stale events found.")
    (output_dir / "validation_report.md").write_text("\n".join(validation_lines) + "\n", encoding="utf-8")
    return {
        "status": "REVIEW_RESULTS_FETCHED",
        "batch_id": manifest["batch_id"],
        "raw_event_count": len(events),
        "current_event_count": len(current),
        "incomplete_count": len(incomplete),
        "coarse_completed_count": len(coarse_completed),
        "precise_required_count": len(precise_pending),
        "precise_completed_count": statistics["precise_review_completed"],
        "validation_issue_count": len(issues),
        "output_dir": str(output_dir),
        "external_mutations_executed": False,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--manifest", type=Path, required=True)
    value.add_argument("--mode", choices=("mock", "google"), default="mock")
    value.add_argument("--events-file", type=Path)
    value.add_argument("--spreadsheet-id")
    value.add_argument("--credentials-dir", type=Path)
    value.add_argument("--sheet-tab", default="review_events")
    value.add_argument("--output-dir", type=Path, required=True)
    return value


def main() -> int:
    args = parser().parse_args()
    try:
        manifest = validate_manifest(read_json(args.manifest))
        if args.mode == "mock":
            if args.events_file is None:
                raise ReviewBlockedError("INVALID_USAGE_COMBINATION", "--events-file is required in mock mode")
            events = read_events(args.events_file)
        else:
            if args.credentials_dir is None or not args.spreadsheet_id:
                raise ReviewBlockedError("BLOCKED_GOOGLE_AUTH", "--credentials-dir and --spreadsheet-id are required in google mode")
            events = google_events(args.credentials_dir, args.spreadsheet_id, args.sheet_tab)
        report = build_reports(manifest, events, args.output_dir)
    except ReviewBlockedError as exc:
        print(json.dumps(exc.as_dict(), ensure_ascii=False, indent=2))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
