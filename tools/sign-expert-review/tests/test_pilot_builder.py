import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


CLI_ROOT = Path(__file__).parents[1] / "cli"
sys.path.insert(0, str(CLI_ROOT))
SCRIPT = CLI_ROOT / "build_pilot_review_batch.py"
SPEC = importlib.util.spec_from_file_location("pilot_builder", SCRIPT)
assert SPEC and SPEC.loader
pilot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pilot)


class PilotBuilderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_frame_range_uses_point_three_padding_and_source_pts(self) -> None:
        pts = [index / 30 for index in range(300)]
        result = pilot.choose_frame_range(pts, 10.0, 3.0, 3.5)
        self.assertLessEqual(result["review_start"], 2.7)
        self.assertGreaterEqual(result["review_end"], 3.8)
        selected = result["source_pts"]
        self.assertEqual(selected[0], result["review_start"])
        self.assertTrue(
            0 <= result["annotated_start_frame"]
            < result["annotated_end_frame"] < len(selected)
        )

    def test_cfr_detection_uses_actual_pts(self) -> None:
        metadata = {"stream": {"avg_frame_rate": "30/1", "r_frame_rate": "30/1"}}
        values = [index / 30 for index in range(60)]
        is_cfr, fps, _ = pilot.cfr_metadata(metadata, values)
        self.assertTrue(is_cfr)
        self.assertEqual(fps, 30.0)
        values[30] += 0.01
        is_cfr, _, _ = pilot.cfr_metadata(metadata, values)
        self.assertFalse(is_cfr)

    def test_member_extraction_verifies_crc_size_and_sha(self) -> None:
        archive_path = self.root / "source.zip"
        payload = b"verified-source-member" * 1000
        with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
            archive.writestr("front.mp4", payload)
        staging = self.root / "staging.mp4"
        with ZipFile(archive_path) as archive:
            info = archive.getinfo("front.mp4")
            result = pilot.extract_member(archive, info, staging)
        self.assertEqual(result["crc_status"], "PASS")
        self.assertEqual(result["size_bytes"], len(payload))
        self.assertEqual(result["sha256"], hashlib.sha256(payload).hexdigest())
        self.assertEqual(staging.read_bytes(), payload)

    def test_candidate_validation_preserves_exact_27(self) -> None:
        index_root = self.root / "index"
        download_root = self.root / "downloads"
        index_root.mkdir()
        download_root.mkdir()
        archives = {}
        for archive_id in pilot.SOURCE_ARCHIVES:
            path = download_root / f"{archive_id}.zip"
            path.write_bytes(b"identity")
            info = path.stat()
            archives[archive_id] = {"validation": {
                "status": "ARCHIVE_VERIFIED", "zip_crc_status": "PASS",
                "source_path": str(path), "size": info.st_size, "mtime_ns": info.st_mtime_ns,
                "sha256": "a" * 64,
            }}
        rows = []
        proposal = []
        for index in range(27):
            archive_id = pilot.SOURCE_ARCHIVES[index % len(pilot.SOURCE_ARCHIVES)]
            candidate_id = f"GOOD1-{index:02d}"
            row = {
                "candidate_id": candidate_id, "exact_gloss_id": "좋다1",
                "archive_id": archive_id, "signer_id": f"S{index % 9}",
                "session_id": "NOT_RESOLVED", "timecode_unit": "seconds",
                "annotated_start": 1.0, "annotated_end": 1.5,
                "front_video_member": f"{candidate_id}.mp4", "front_connection": "CONNECTED",
                "duplicate_status": "UNIQUE", "review_eligibility": "ELIGIBLE_FOR_REVIEW_SELECTION",
            }
            rows.append(row)
            proposal.append({
                "selection_rank": index + 1, "candidate_id": candidate_id,
                "signer_id": row["signer_id"], "archive_id": archive_id,
                "annotated_start": 1.0, "annotated_end": 1.5,
                "front_video_member": row["front_video_member"],
                "selection_category": "SIGNER_REPRESENTATIVE", "selection_reason": "test",
            })
        (index_root / "checkpoint.json").write_text(json.dumps({"version": 1, "archives": archives}))
        (index_root / "good1-all-candidates.json").write_text(json.dumps({"candidates": rows}))
        (index_root / "good1-review-batch-01-proposal.json").write_text(json.dumps({
            "candidate_count": 27, "candidates": proposal,
        }))
        result = pilot.validate_inputs(index_root, download_root.resolve())
        self.assertEqual(len(result["valid_candidates"]), 27)
        self.assertEqual(result["invalid_candidates"], [])


if __name__ == "__main__":
    unittest.main()
