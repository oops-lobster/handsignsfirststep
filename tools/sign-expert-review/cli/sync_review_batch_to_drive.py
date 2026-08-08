#!/usr/bin/env python3
"""Verify and synchronize one restricted review batch to Drive and Sheets."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

from review_common import (
    REVIEW_EVENT_HEADERS,
    ReviewBlockedError,
    manifest_content_sha256,
    quota_plan,
    read_json,
    utc_now,
    validate_manifest,
    verify_clip,
    write_json,
)


DRIVE_SCOPES = (
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets",
)


class MockGoogleClient:
    def __init__(self, state_path: Path):
        self.state_path = state_path
        self.state = read_json(state_path)

    def storage_quota(self) -> dict[str, Any]:
        return dict(self.state.get("storageQuota") or {})

    def list_files(self, _parent_folder_id: str) -> list[dict[str, Any]]:
        return list(self.state.get("files") or [])

    def list_review_files(self, _parent_folder_id: str, _batch_id: str) -> list[dict[str, Any]]:
        return self.list_files(_parent_folder_id)

    def ensure_batch_folder(self, _parent_id: str, batch_id: str) -> str:
        return f"mock-folder-{batch_id}"

    def ensure_clips_folder(self, batch_folder_id: str) -> str:
        return f"{batch_folder_id}-clips"

    def upload(self, path: Path, parent_id: str, name: str, properties: dict[str, str], mime_type: str) -> str:
        file_id = f"mock-{len(self.state.setdefault('files', [])) + 1:04d}"
        self.state["files"].append({
            "id": file_id, "name": name, "parents": [parent_id], "mimeType": mime_type,
            "size": str(path.stat().st_size), "appProperties": properties,
        })
        return file_id

    def prepare_sheet(self, _spreadsheet_id: str, _tab: str) -> None:
        self.state["sheetHeaders"] = list(REVIEW_EVENT_HEADERS)

    def persist(self) -> None:
        write_json(self.state_path, self.state)


class GoogleApiClient:
    def __init__(self, credentials_dir: Path):
        try:
            from google.auth.transport.requests import Request
            from google.oauth2.credentials import Credentials
            from google_auth_oauthlib.flow import InstalledAppFlow
            from googleapiclient.discovery import build
            from googleapiclient.http import MediaFileUpload
        except ImportError as exc:
            raise ReviewBlockedError(
                "BLOCKED_GOOGLE_AUTH",
                "Google client libraries are not installed; see GOOGLE_SETUP.md",
            ) from exc
        credentials_dir.mkdir(parents=True, exist_ok=True)
        secrets_path = credentials_dir / "client_secrets.json"
        token_path = credentials_dir / "token.json"
        if not secrets_path.exists():
            raise ReviewBlockedError("BLOCKED_GOOGLE_AUTH", "client_secrets.json is missing")
        credentials = Credentials.from_authorized_user_file(str(token_path), DRIVE_SCOPES) if token_path.exists() else None
        if credentials and credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
        if not credentials or not credentials.valid:
            flow = InstalledAppFlow.from_client_secrets_file(str(secrets_path), DRIVE_SCOPES)
            credentials = flow.run_local_server(port=0)
        token_path.write_text(credentials.to_json(), encoding="utf-8")
        token_path.chmod(0o600)
        self.drive = build("drive", "v3", credentials=credentials, cache_discovery=False)
        self.sheets = build("sheets", "v4", credentials=credentials, cache_discovery=False)
        self.MediaFileUpload = MediaFileUpload

    def storage_quota(self) -> dict[str, Any]:
        return self.drive.about().get(fields="storageQuota").execute()["storageQuota"]

    def list_files(self, parent_folder_id: str) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        page_token = None
        while True:
            response = self.drive.files().list(
                q=f"'{parent_folder_id}' in parents and trashed = false",
                fields="nextPageToken,files(id,name,size,mimeType,appProperties,parents)",
                pageToken=page_token,
            ).execute()
            result.extend(response.get("files") or [])
            page_token = response.get("nextPageToken")
            if not page_token:
                return result

    def list_review_files(self, parent_folder_id: str, batch_id: str) -> list[dict[str, Any]]:
        folders = [
            item for item in self.list_files(parent_folder_id)
            if item.get("mimeType") == "application/vnd.google-apps.folder" and item.get("name") == batch_id
        ]
        if not folders:
            return []
        clips_folders = [
            item for item in self.list_files(folders[0]["id"])
            if item.get("mimeType") == "application/vnd.google-apps.folder" and item.get("name") == "clips"
        ]
        if not clips_folders:
            return []
        return self.list_files(clips_folders[0]["id"])

    def _folder(self, parent_id: str, name: str, properties: dict[str, str]) -> str:
        matches = [item for item in self.list_files(parent_id) if item.get("mimeType") == "application/vnd.google-apps.folder" and item.get("name") == name]
        if matches:
            return matches[0]["id"]
        body = {"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent_id], "appProperties": properties}
        return self.drive.files().create(body=body, fields="id").execute()["id"]

    def ensure_batch_folder(self, parent_id: str, batch_id: str) -> str:
        return self._folder(parent_id, batch_id, {"batch_id": batch_id, "restricted_review": "true"})

    def ensure_clips_folder(self, batch_folder_id: str) -> str:
        return self._folder(batch_folder_id, "clips", {"restricted_review": "true"})

    def upload(self, path: Path, parent_id: str, name: str, properties: dict[str, str], mime_type: str) -> str:
        media = self.MediaFileUpload(str(path), mimetype=mime_type, resumable=True, chunksize=5 * 1024 * 1024)
        request = self.drive.files().create(
            body={"name": name, "parents": [parent_id], "appProperties": properties},
            media_body=media,
            fields="id",
        )
        response = None
        while response is None:
            _status, response = request.next_chunk()
        return response["id"]

    def prepare_sheet(self, spreadsheet_id: str, tab: str) -> None:
        escaped_tab = tab.replace("'", "''")
        range_name = f"'{escaped_tab}'!A1:AZ1"
        try:
            values = self.sheets.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=range_name).execute().get("values") or []
        except Exception as exc:
            raise ReviewBlockedError("GOOGLE_ACCOUNT_NOT_AUTHORIZED", "cannot access review spreadsheet/tab") from exc
        if values and values[0] != list(REVIEW_EVENT_HEADERS):
            raise ReviewBlockedError("BLOCKED_MANIFEST_INVALID", "review_events header differs from required append-only contract")
        if not values:
            self.sheets.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id, range=range_name, valueInputOption="RAW",
                body={"values": [list(REVIEW_EVENT_HEADERS)]},
            ).execute()

    def persist(self) -> None:
        return None


def _existing_index(files: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    index: dict[str, list[dict[str, Any]]] = {}
    for item in files:
        candidate_id = str((item.get("appProperties") or {}).get("candidate_id") or "")
        if candidate_id:
            index.setdefault(candidate_id, []).append(item)
    return index


def build_sync_plan(manifest: dict[str, Any], verified: list[dict[str, Any]], remote_files: list[dict[str, Any]]) -> dict[str, Any]:
    by_id = _existing_index(remote_files)
    upload: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    verified_by_id = {item["candidate_id"]: item for item in verified}
    for candidate in manifest["candidates"]:
        properties = {
            "candidate_id": candidate["candidate_id"], "batch_id": manifest["batch_id"],
            "gloss_id": manifest["gloss_id"], "revision": manifest["revision"],
            "sha256": candidate["clip_sha256"], "review_status": "PENDING_EXPERT_REVIEW",
        }
        matches = by_id.get(candidate["candidate_id"], [])
        exact = [item for item in matches if (item.get("appProperties") or {}).get("revision") == manifest["revision"] and (item.get("appProperties") or {}).get("sha256") == candidate["clip_sha256"]]
        changed = [item for item in matches if (item.get("appProperties") or {}).get("revision") == manifest["revision"] and (item.get("appProperties") or {}).get("sha256") != candidate["clip_sha256"]]
        if changed:
            conflicts.append({"candidate_id": candidate["candidate_id"], "status": "BLOCKED_FILE_CHANGED"})
        elif exact:
            skipped.append({"candidate_id": candidate["candidate_id"], "file_id": exact[0].get("id"), "reason": "same revision and SHA-256"})
        else:
            upload.append({"candidate": candidate, "verified": verified_by_id[candidate["candidate_id"]], "properties": properties})
    return {"upload": upload, "skipped": skipped, "conflicts": conflicts}


PRIVATE_CANDIDATE_FIELDS = {
    "absolute_path",
    "filesystem_path",
    "relative_path",
    "source_file",
    "source_member",
    "source_path",
    "source_video_file",
    "source_video_path",
}


def build_public_manifest(manifest: dict[str, Any], drive_file_ids: dict[str, str]) -> dict[str, Any]:
    """Return the portal manifest without local source paths and with Drive clip IDs."""
    public_manifest = copy.deepcopy(manifest)
    for candidate in public_manifest["candidates"]:
        candidate_id = candidate["candidate_id"]
        drive_file_id = str(drive_file_ids.get(candidate_id) or "").strip()
        if not drive_file_id:
            raise ReviewBlockedError(
                "BLOCKED_CLIP_MISSING",
                f"Drive file ID is missing for public manifest candidate: {candidate_id}",
            )
        for field in PRIVATE_CANDIDATE_FIELDS:
            candidate.pop(field, None)
        candidate["drive_file_id"] = drive_file_id
    public_manifest["manifest_sha256"] = manifest_content_sha256(public_manifest)
    return validate_manifest(public_manifest)


def sync(args: argparse.Namespace) -> dict[str, Any]:
    manifest = validate_manifest(read_json(args.manifest))
    verified = [verify_clip(candidate, args.clips_dir) for candidate in manifest["candidates"]]
    if args.mode == "mock":
        client: Any = MockGoogleClient(args.mock_state)
    else:
        if args.credentials_dir is None:
            raise ReviewBlockedError("BLOCKED_GOOGLE_AUTH", "--credentials-dir is required in google mode")
        client = GoogleApiClient(args.credentials_dir)
    quota = client.storage_quota()
    existing = client.list_review_files(args.drive_parent_folder_id, manifest["batch_id"])
    plan = build_sync_plan(manifest, verified, existing)
    if plan["conflicts"]:
        raise ReviewBlockedError("BLOCKED_FILE_CHANGED", "remote candidate has the same revision with a different SHA-256", details={"conflicts": plan["conflicts"]})
    manifest_bytes = args.manifest.stat().st_size
    public_manifest_estimated_bytes = manifest_bytes + (len(manifest["candidates"]) * 256)
    planned_bytes = sum(item["verified"]["size_bytes"] for item in plan["upload"]) + public_manifest_estimated_bytes
    quota_result = quota_plan(quota, planned_bytes, args.headroom_percent)
    if not quota_result.fits:
        raise ReviewBlockedError("BLOCKED_INSUFFICIENT_DRIVE_SPACE", "Drive quota plus configured headroom cannot fit this upload", details=quota_result.as_dict())
    report: dict[str, Any] = {
        "status": "DRY_RUN_READY" if not args.execute else "SYNC_COMPLETE",
        "mode": args.mode,
        "batch_id": manifest["batch_id"],
        "revision": manifest["revision"],
        "candidate_count": len(manifest["candidates"]),
        "upload_count": len(plan["upload"]),
        "skip_count": len(plan["skipped"]),
        "skipped": plan["skipped"],
        "quota": quota_result.as_dict(),
        "trash_warning": int(quota.get("usageInDriveTrash", 0)) > 0,
        "external_mutations_executed": bool(args.execute),
        "public_manifest_estimated_bytes": public_manifest_estimated_bytes,
        "completed_at": utc_now(),
    }
    if not args.execute:
        return report
    batch_folder_id = client.ensure_batch_folder(args.drive_parent_folder_id, manifest["batch_id"])
    clips_folder_id = client.ensure_clips_folder(batch_folder_id)
    uploaded: list[dict[str, Any]] = []
    for item in plan["upload"]:
        candidate = item["candidate"]
        path = args.clips_dir / candidate["clip_filename"]
        file_id = client.upload(path, clips_folder_id, candidate["clip_filename"], item["properties"], "video/mp4")
        uploaded.append({"candidate_id": candidate["candidate_id"], "file_id": file_id, "sha256": candidate["clip_sha256"]})
        write_json(args.checkpoint, {"batch_id": manifest["batch_id"], "revision": manifest["revision"], "uploaded": uploaded, "updated_at": utc_now()})
    drive_file_ids = {
        item["candidate_id"]: item["file_id"]
        for item in [*plan["skipped"], *uploaded]
    }
    public_manifest = build_public_manifest(manifest, drive_file_ids)
    public_manifest_output = getattr(args, "public_manifest_output", None) or args.checkpoint.parent / "review_batch_manifest.public.json"
    write_json(public_manifest_output, public_manifest)
    manifest_id = client.upload(
        public_manifest_output, batch_folder_id, "review_batch_manifest.public.json",
        {"batch_id": manifest["batch_id"], "gloss_id": manifest["gloss_id"], "revision": manifest["revision"], "sha256": public_manifest["manifest_sha256"], "review_status": "BATCH_MANIFEST"},
        "application/json",
    )
    client.prepare_sheet(args.spreadsheet_id, args.sheet_tab)
    client.persist()
    report.update({
        "uploaded": uploaded,
        "manifest_file_id": manifest_id,
        "public_manifest": str(public_manifest_output),
        "public_manifest_sha256": public_manifest["manifest_sha256"],
        "checkpoint": str(args.checkpoint),
    })
    return report


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--manifest", type=Path, required=True)
    value.add_argument("--clips-dir", type=Path, required=True)
    value.add_argument("--drive-parent-folder-id", required=True)
    value.add_argument("--spreadsheet-id", required=True)
    value.add_argument("--credentials-dir", type=Path)
    value.add_argument("--mode", choices=("mock", "google"), default="mock")
    value.add_argument("--mock-state", type=Path, default=Path(__file__).resolve().parents[1] / "fixtures" / "mock_drive_state.json")
    value.add_argument("--sheet-tab", default="review_events")
    value.add_argument("--headroom-percent", type=float, default=10.0)
    value.add_argument("--checkpoint", type=Path, default=Path("review-sync-checkpoint.json"))
    value.add_argument("--public-manifest-output", type=Path)
    action = value.add_mutually_exclusive_group()
    action.add_argument("--dry-run", action="store_true")
    action.add_argument("--execute", action="store_true")
    value.add_argument("--report", type=Path)
    return value


def main() -> int:
    args = parser().parse_args()
    try:
        report = sync(args)
    except ReviewBlockedError as exc:
        report = exc.as_dict()
        if args.report:
            write_json(args.report, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2
    if args.report:
        write_json(args.report, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
