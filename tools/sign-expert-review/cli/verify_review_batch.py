#!/usr/bin/env python3
"""Fail-closed review-batch verification without any external API calls."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from review_common import ReviewBlockedError, read_json, utc_now, validate_manifest, verify_clip, write_json


def verify_batch(manifest_path: Path, clips_dir: Path, *, probe: bool = True) -> dict:
    manifest = validate_manifest(read_json(manifest_path))
    clips = [verify_clip(candidate, clips_dir, probe=probe) for candidate in manifest["candidates"]]
    return {
        "status": "VALID",
        "verified_at": utc_now(),
        "batch_id": manifest["batch_id"],
        "revision": manifest["revision"],
        "gloss_id": manifest["gloss_id"],
        "candidate_count": len(clips),
        "planned_upload_bytes": sum(item["size_bytes"] for item in clips),
        "clips": clips,
        "external_calls_executed": False,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--manifest", type=Path, required=True)
    value.add_argument("--clips-dir", type=Path, required=True)
    value.add_argument("--report", type=Path)
    value.add_argument("--skip-ffprobe", action="store_true")
    return value


def main() -> int:
    args = parser().parse_args()
    try:
        report = verify_batch(args.manifest, args.clips_dir, probe=not args.skip_ffprobe)
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
