from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path


TOOL_ROOT = Path(__file__).resolve().parents[1]
CLI_ROOT = TOOL_ROOT / "cli"
PROJECT_ROOT = TOOL_ROOT.parents[1]
sys.path.insert(0, str(CLI_ROOT))

from export_approved_manifest import export as export_approved  # noqa: E402
from fetch_review_results import build_reports  # noqa: E402
from review_common import (  # noqa: E402
    ReviewBlockedError,
    manifest_content_sha256,
    quota_plan,
    read_json,
    reduce_latest_events,
    validate_manifest,
    verify_clip,
)
from sync_review_batch_to_drive import build_public_manifest, build_sync_plan, sync  # noqa: E402


class ReviewCliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest_path = TOOL_ROOT / "fixtures" / "review_batch_manifest.json"
        cls.clips_dir = TOOL_ROOT / "fixtures"
        cls.manifest = read_json(cls.manifest_path)
        cls.events = read_json(TOOL_ROOT / "fixtures" / "mock_review_events.json")["events"]

    def test_manifest_is_exact_good1_and_canonical_hash_matches(self) -> None:
        validated = validate_manifest(self.manifest)
        self.assertEqual(validated["gloss_id"], "좋다1")
        self.assertEqual(validated["manifest_sha256"], manifest_content_sha256(validated))
        changed = copy.deepcopy(validated)
        changed["gloss_id"] = "좋다"
        with self.assertRaisesRegex(ReviewBlockedError, "exact gloss_id"):
            validate_manifest(changed)

    def test_review_batch_absolute_limit_is_150(self) -> None:
        allowed = copy.deepcopy(self.manifest)
        allowed["candidates"] = [
            {**copy.deepcopy(self.manifest["candidates"][0]), "candidate_id": f"GOOD1_LIMIT_{index:03d}"}
            for index in range(150)
        ]
        self.assertEqual(len(validate_manifest(allowed, verify_manifest_hash=False)["candidates"]), 150)
        blocked = copy.deepcopy(allowed)
        blocked["candidates"].append({**copy.deepcopy(blocked["candidates"][0]), "candidate_id": "GOOD1_LIMIT_150"})
        with self.assertRaises(ReviewBlockedError) as context:
            validate_manifest(blocked, verify_manifest_hash=False)
        self.assertEqual(context.exception.code, "REVIEW_BATCH_TOO_LARGE")

    def test_clip_checksum_h264_cfr_and_frame_count(self) -> None:
        result = verify_clip(self.manifest["candidates"][0], self.clips_dir)
        self.assertEqual(result["sha256"], self.manifest["candidates"][0]["clip_sha256"])
        self.assertEqual(result["probe"]["codec_name"], "h264")
        self.assertEqual(result["probe"]["nb_frames"], "24")

    def test_quota_applies_headroom_and_reports_excess(self) -> None:
        fits = quota_plan({"limit": "1000", "usage": "500", "usageInDrive": "450", "usageInDriveTrash": "50"}, 300, 10)
        self.assertTrue(fits.fits)
        self.assertEqual(fits.headroom_bytes, 100)
        blocked = quota_plan({"limit": "1000", "usage": "800", "usageInDrive": "700", "usageInDriveTrash": "100"}, 150, 10)
        self.assertFalse(blocked.fits)
        self.assertEqual(blocked.excess_bytes, 50)

    def test_duplicate_remote_upload_is_skipped_and_changed_file_blocks(self) -> None:
        candidate = self.manifest["candidates"][0]
        verified = [verify_clip(item, self.clips_dir, probe=False) for item in self.manifest["candidates"]]
        properties = {"candidate_id": candidate["candidate_id"], "revision": self.manifest["revision"], "sha256": candidate["clip_sha256"]}
        exact = build_sync_plan(self.manifest, verified, [{"id": "remote-1", "appProperties": properties}])
        self.assertEqual(exact["skipped"][0]["candidate_id"], candidate["candidate_id"])
        changed = build_sync_plan(self.manifest, verified, [{"id": "remote-2", "appProperties": {**properties, "sha256": "0" * 64}}])
        self.assertEqual(changed["conflicts"][0]["status"], "BLOCKED_FILE_CHANGED")

    def test_public_manifest_has_drive_ids_and_strips_local_source_fields(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["candidates"][0]["source_member"] = "private/archive/member.mp4"
        drive_file_ids = {
            candidate["candidate_id"]: f"drive-{index:04d}"
            for index, candidate in enumerate(manifest["candidates"], start=1)
        }
        public_manifest = build_public_manifest(manifest, drive_file_ids)
        self.assertEqual(public_manifest["manifest_sha256"], manifest_content_sha256(public_manifest))
        self.assertNotIn("source_member", public_manifest["candidates"][0])
        self.assertEqual(public_manifest["candidates"][0]["drive_file_id"], "drive-0001")

    def test_mock_sync_dry_run_and_resumable_execute_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "drive.json"
            shutil.copyfile(TOOL_ROOT / "fixtures" / "mock_drive_state.json", state)
            common = dict(
                manifest=self.manifest_path, clips_dir=self.clips_dir,
                drive_parent_folder_id="restricted-parent", spreadsheet_id="sheet",
                credentials_dir=None, mode="mock", mock_state=state, sheet_tab="review_events",
                headroom_percent=10.0, checkpoint=root / "checkpoint.json", report=None,
            )
            dry_run = sync(Namespace(**common, dry_run=True, execute=False))
            self.assertEqual(dry_run["status"], "DRY_RUN_READY")
            self.assertFalse(dry_run["external_mutations_executed"])
            executed = sync(Namespace(**common, dry_run=False, execute=True))
            self.assertEqual(executed["status"], "SYNC_COMPLETE")
            self.assertTrue((root / "checkpoint.json").exists())
            public_manifest_path = Path(executed["public_manifest"])
            self.assertTrue(public_manifest_path.exists())
            public_manifest = read_json(public_manifest_path)
            self.assertEqual(public_manifest["manifest_sha256"], manifest_content_sha256(public_manifest))
            self.assertTrue(all(candidate.get("drive_file_id") for candidate in public_manifest["candidates"]))
            uploaded_manifest = next(item for item in read_json(state)["files"] if item["id"] == executed["manifest_file_id"])
            self.assertEqual(uploaded_manifest["name"], "review_batch_manifest.public.json")
            second = sync(Namespace(**common, dry_run=True, execute=False))
            self.assertEqual(second["upload_count"], 0)
            self.assertEqual(second["skip_count"], 5)

    def test_latest_event_reduction_fetch_outputs_and_training_export(self) -> None:
        current, issues = reduce_latest_events(self.events, self.manifest)
        self.assertEqual(len(current), 3)
        self.assertEqual(issues, [])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fetched = build_reports(self.manifest, self.events, root / "results")
            self.assertEqual(fetched["current_event_count"], 3)
            current_document = json.loads((root / "results" / "review_current.json").read_text(encoding="utf-8"))
            report = export_approved(self.manifest, current_document, root / "approved", "approved-clips")
            self.assertEqual(report["approved_count"], 2)
            self.assertEqual(report["learning_video_count"], 2)
            self.assertEqual(report["reference_count"], 1)
            exported = json.loads((root / "approved" / "approved-good1-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(exported["schema_version"], "sign-training-manifest-v2")
            self.assertEqual({record["gloss_id"] for record in exported["records"]}, {"좋다1"})

    def test_fetch_accepts_a_header_only_event_store(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "results"
            fetched = build_reports(self.manifest, [], output)
            self.assertEqual(fetched["raw_event_count"], 0)
            self.assertEqual(fetched["current_event_count"], 0)
            self.assertEqual(fetched["incomplete_count"], len(self.manifest["candidates"]))
            self.assertEqual(fetched["validation_issue_count"], 0)
            self.assertTrue((output / "review_events_raw.csv").exists())
            self.assertEqual(json.loads((output / "review_current.json").read_text(encoding="utf-8"))["events"], [])

    def test_needs_refinement_exports_precise_pending_and_blocks_approval(self) -> None:
        directional = copy.deepcopy(self.events[0])
        directional.update(
            event_id="GOOD1_MOCK_KEEP:REVIEW_V1_0P3_MOCK:coarse-directional",
            reviewed_at="2026-08-08T01:00:00Z",
            client_version="sign-expert-review-web/2.0.0",
            review_mode="COARSE",
            review_state="PRECISE_REVIEW_REQUIRED",
            boundary_assessment="BOUNDARY_START_TOO_EARLY",
            precise_review_required=True,
            precise_review_reason="BOUNDARY_ADJUSTMENT_REQUESTED",
            boundary_status="NEEDS_REFINEMENT",
            learning_video_assessment="LEARNING_ALLOWED",
            reference_assessment="REFERENCE_ALLOWED",
            representative_fit="REPRESENTATIVE_MEDIUM",
            sentence_connection_effect="CONNECTION_NONE",
            expert_notes="정밀 시작 경계 확인 필요",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fetched = build_reports(self.manifest, [*self.events, directional], root / "results")
            self.assertEqual(fetched["precise_required_count"], 1)
            pending = json.loads((root / "results" / "precise-review-required.json").read_text(encoding="utf-8"))
            self.assertEqual(pending["candidates"][0]["candidate_id"], "GOOD1_MOCK_KEEP")
            current_document = json.loads((root / "results" / "review_current.json").read_text(encoding="utf-8"))
            report = export_approved(self.manifest, current_document, root / "approved", "approved-clips")
            self.assertEqual(report["approved_count"], 1)
            rejected = (root / "approved" / "rejected-candidates.csv").read_text(encoding="utf-8-sig")
            self.assertIn("PRECISE_REVIEW_REQUIRED", rejected)


if __name__ == "__main__":
    unittest.main()
