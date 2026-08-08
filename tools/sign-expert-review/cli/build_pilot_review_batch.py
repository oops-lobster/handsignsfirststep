#!/usr/bin/env python3
"""Build a fail-closed 27-clip `[좋다1]` pilot review package.

Only front-view members named by an existing proposal are read from archives
that already have a matching verified checkpoint.  The command never reads an
active da7/da8 download, never expands a ZIP, and keeps only one source member
staged at a time.
"""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import zlib
from collections import Counter, defaultdict
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path
from typing import Any, Iterable, Mapping
from zipfile import BadZipFile, ZipFile, ZipInfo

from review_common import manifest_content_sha256


TARGET_GLOSS_ID = "좋다1"
BATCH_ID = "good1-pilot-review-01"
REVISION = "REVIEW_V1_0P3_PILOT"
REVIEW_PADDING_SEC = 0.3
SOURCE_ARCHIVES = ("da1", "da2", "da3", "da4", "da5", "da6", "da9", "me1", "me2")
MISSING_ARCHIVES = ("da7", "da8")
ACTIVE_DOWNLOAD_NAMES = (
    "NIKL_Sign_Language_Parallel_Corpus_2025_v1.0_da7.zip.irx",
    "NIKL_Sign_Language_Parallel_Corpus_2025_v1.0_da8.zip.irx",
)
CHECKPOINT_VERSION = 1
CHUNK_SIZE = 4 * 1024 * 1024
MIN_STAGING_FREE_BYTES = 2 * 1024 * 1024 * 1024


class PilotError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PilotError("PILOT_METADATA_INVALID", f"cannot read JSON: {path}") from exc


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def write_json(path: Path, value: Any) -> None:
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_directory(path: Path, label: str, *, create: bool = False) -> Path:
    expanded = path.expanduser()
    if create:
        expanded.mkdir(parents=True, exist_ok=True)
    if not expanded.exists() or not expanded.is_dir() or expanded.is_symlink():
        raise PilotError("DATA_ROOT_NOT_MOUNTED", f"{label} is unavailable or unsafe: {expanded}")
    resolved = expanded.resolve(strict=True)
    if resolved in (Path("/"), Path.home().resolve()):
        raise PilotError("PATH_NOT_ALLOWED", f"unsafe {label}: {resolved}")
    return resolved


def safe_filename(candidate_id: str, rank: int) -> str:
    safe_id = re.sub(r"[^A-Za-z0-9_-]+", "_", candidate_id).strip("_")
    if not safe_id:
        raise PilotError("PILOT_CANDIDATE_INVALID", f"unsafe candidate ID: {candidate_id!r}")
    return f"GOOD1_PILOT_{rank:03d}_{safe_id}.mp4"


def run_command(command: list[str], code: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(command, check=True, capture_output=True, text=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        diagnostic = ""
        if isinstance(exc, subprocess.CalledProcessError):
            diagnostic = (exc.stderr or exc.stdout or "")[-2000:]
        raise PilotError(code, f"command failed: {command[0]} {diagnostic}".strip()) from exc


def parse_rate(value: Any) -> float:
    try:
        rate = float(Fraction(str(value)))
    except (ValueError, ZeroDivisionError) as exc:
        raise PilotError("PILOT_CLIP_METADATA_MISMATCH", f"invalid frame rate: {value}") from exc
    if not math.isfinite(rate) or rate <= 0 or rate > 240:
        raise PilotError("PILOT_CLIP_METADATA_MISMATCH", f"invalid frame rate: {value}")
    return rate


def probe_video(path: Path, ffprobe: str) -> dict[str, Any]:
    completed = run_command([
        ffprobe, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,pix_fmt,r_frame_rate,avg_frame_rate,nb_frames,duration",
        "-show_entries", "format=duration", "-of", "json", str(path),
    ], "PILOT_CLIP_DECODE_FAILED")
    try:
        payload = json.loads(completed.stdout)
        stream = (payload.get("streams") or [])[0]
        duration = float((payload.get("format") or {}).get("duration") or stream.get("duration"))
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise PilotError("PILOT_CLIP_METADATA_MISMATCH", f"invalid ffprobe metadata: {path.name}") from exc
    return {"stream": stream, "duration": duration}


def probe_frame_pts(path: Path, ffprobe: str) -> list[float]:
    completed = run_command([
        ffprobe, "-v", "error", "-select_streams", "v:0", "-show_frames",
        "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(path),
    ], "PILOT_CLIP_DECODE_FAILED")
    try:
        frames = json.loads(completed.stdout).get("frames") or []
        values = [float(frame["best_effort_timestamp_time"]) for frame in frames]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise PilotError("PILOT_CLIP_FRAME_MAP_MISMATCH", f"invalid frame PTS: {path.name}") from exc
    if len(values) < 2 or any(
        not math.isfinite(value) or value < 0 or (index and value <= values[index - 1])
        for index, value in enumerate(values)
    ):
        raise PilotError("PILOT_CLIP_FRAME_MAP_MISMATCH", f"non-monotonic frame PTS: {path.name}")
    return values


def cfr_metadata(metadata: Mapping[str, Any], pts: list[float]) -> tuple[bool, float, float]:
    stream = metadata["stream"]
    nominal = parse_rate(stream.get("avg_frame_rate"))
    reported = parse_rate(stream.get("r_frame_rate"))
    deltas = [right - left for left, right in zip(pts, pts[1:])]
    step = statistics.median(deltas)
    tolerance = max(1e-4, step * 0.01)
    is_cfr = (
        abs(nominal - reported) <= max(1e-6, nominal * 1e-5)
        and all(abs(delta - step) <= tolerance for delta in deltas)
    )
    return is_cfr, nominal, step


def decode_video(path: Path, ffmpeg: str) -> None:
    run_command([
        ffmpeg, "-v", "error", "-i", str(path), "-map", "0:v:0", "-f", "null", "-",
    ], "PILOT_CLIP_DECODE_FAILED")


def choose_frame_range(
    source_pts: list[float], source_duration: float,
    annotated_start: float, annotated_end: float,
) -> dict[str, Any]:
    if not 0 <= annotated_start < annotated_end <= source_duration + 1e-6:
        raise PilotError("PILOT_CLIP_BOUNDARY_OUT_OF_RANGE", "annotation boundary leaves source duration")
    desired_start = max(0.0, annotated_start - REVIEW_PADDING_SEC)
    desired_end = min(source_duration, annotated_end + REVIEW_PADDING_SEC)
    start_index = max(0, bisect.bisect_right(source_pts, desired_start) - 1)
    end_exclusive = min(len(source_pts), bisect.bisect_left(source_pts, desired_end) + 1)
    if end_exclusive - start_index < 2:
        raise PilotError("PILOT_CLIP_BOUNDARY_OUT_OF_RANGE", "review range contains fewer than two frames")
    selected_pts = source_pts[start_index:end_exclusive]
    step = statistics.median([b - a for a, b in zip(source_pts, source_pts[1:])])
    review_start = selected_pts[0]
    review_end = min(source_duration, selected_pts[-1] + step)
    annotated_start_frame = bisect.bisect_left(selected_pts, annotated_start)
    annotated_end_frame = bisect.bisect_left(selected_pts, annotated_end)
    if not 0 <= annotated_start_frame < annotated_end_frame < len(selected_pts):
        raise PilotError("PILOT_CLIP_BOUNDARY_OUT_OF_RANGE", "annotated frames do not fit inside review clip")
    return {
        "start_index": start_index,
        "end_exclusive": end_exclusive,
        "source_pts": selected_pts,
        "review_start": review_start,
        "review_end": review_end,
        "annotated_start_frame": annotated_start_frame,
        "annotated_end_frame": annotated_end_frame,
        "desired_review_start": desired_start,
        "desired_review_end": desired_end,
    }


def extract_member(archive: ZipFile, info: ZipInfo, staging: Path) -> dict[str, Any]:
    if info.is_dir() or info.flag_bits & 0x1:
        raise PilotError("PILOT_CLIP_METADATA_MISMATCH", f"unsafe or encrypted source member: {info.filename}")
    temporary = staging.with_suffix(staging.suffix + ".tmp")
    digest = hashlib.sha256()
    crc = 0
    size = 0
    try:
        with archive.open(info, "r") as source, temporary.open("wb") as target:
            while True:
                chunk = source.read(CHUNK_SIZE)
                if not chunk:
                    break
                target.write(chunk)
                digest.update(chunk)
                crc = zlib.crc32(chunk, crc)
                size += len(chunk)
            target.flush()
            os.fsync(target.fileno())
        if size != info.file_size or (crc & 0xFFFFFFFF) != info.CRC:
            raise PilotError("PILOT_CLIP_SOURCE_MEMBER_CRC_FAILED", f"source member CRC/size mismatch: {info.filename}")
        os.replace(temporary, staging)
    except (BadZipFile, OSError) as exc:
        raise PilotError("PILOT_CLIP_SOURCE_MEMBER_CRC_FAILED", f"cannot extract verified member: {info.filename}") from exc
    finally:
        if temporary.exists():
            temporary.unlink()
    return {
        "member": info.filename,
        "zip_crc32": f"{info.CRC:08x}",
        "extracted_crc32": f"{crc & 0xFFFFFFFF:08x}",
        "size_bytes": size,
        "compressed_size_bytes": info.compress_size,
        "sha256": digest.hexdigest(),
        "crc_status": "PASS",
    }


def create_clip(
    source: Path, destination: Path, frame_range: Mapping[str, Any],
    ffmpeg: str,
) -> None:
    temporary = destination.with_name(f".{destination.stem}.tmp.mp4")
    filter_value = (
        f"trim=start_frame={frame_range['start_index']}:"
        f"end_frame={frame_range['end_exclusive']},setpts=PTS-STARTPTS"
    )
    try:
        run_command([
            ffmpeg, "-v", "error", "-i", str(source), "-map", "0:v:0",
            "-vf", filter_value, "-an", "-c:v", "libx264", "-preset", "medium",
            "-crf", "18", "-pix_fmt", "yuv420p", "-tag:v", "avc1",
            "-fps_mode", "passthrough", "-movflags", "+faststart", "-y", str(temporary),
        ], "PILOT_CLIP_DECODE_FAILED")
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink()


def rounded(values: Iterable[float]) -> list[float]:
    return [round(value, 6) for value in values]


def download_snapshot(download_root: Path) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name in ACTIVE_DOWNLOAD_NAMES:
        path = download_root / name
        try:
            info = path.stat()
            result[name] = {"present": True, "size_bytes": info.st_size, "mtime_ns": info.st_mtime_ns}
        except FileNotFoundError:
            result[name] = {"present": False, "size_bytes": None, "mtime_ns": None}
        except OSError as exc:
            raise PilotError("EXTERNAL_DRIVE_IO_ERROR", f"cannot stat active download metadata: {name}") from exc
    return result


def monitor_downloads(download_root: Path, sample_seconds: float) -> dict[str, Any]:
    before = download_snapshot(download_root)
    time.sleep(sample_seconds)
    after = download_snapshot(download_root)
    growth: dict[str, int | None] = {}
    for name in ACTIVE_DOWNLOAD_NAMES:
        left = before[name]
        right = after[name]
        growth[name] = (
            int(right["size_bytes"]) - int(left["size_bytes"])
            if left["present"] and right["present"] else None
        )
    active_before = [name for name, value in before.items() if value["present"]]
    grew = any((value or 0) > 0 for value in growth.values())
    return {
        "checked_at": now_iso(), "sample_seconds": sample_seconds,
        "before": before, "after": after, "growth_bytes": growth,
        "active_temp_count": len(active_before),
        "status": "DOWNLOAD_WRITE_ACTIVE" if grew else (
            "NO_ACTIVE_TEMP_FILES" if not active_before else "DOWNLOAD_WRITE_STALLED_DURING_PILOT"
        ),
    }


def archive_identity_ok(validation: Mapping[str, Any], download_root: Path) -> bool:
    path = Path(str(validation.get("source_path") or ""))
    try:
        info = path.stat()
        resolved = path.resolve(strict=True)
    except OSError:
        return False
    return (
        validation.get("status") == "ARCHIVE_VERIFIED"
        and validation.get("zip_crc_status") == "PASS"
        and resolved.parent == download_root
        and not path.is_symlink()
        and info.st_size == validation.get("size")
        and info.st_mtime_ns == validation.get("mtime_ns")
        and isinstance(validation.get("sha256"), str)
        and len(validation["sha256"]) == 64
    )


def validate_inputs(index_root: Path, download_root: Path) -> dict[str, Any]:
    proposal = read_json(index_root / "good1-review-batch-01-proposal.json")
    all_manifest = read_json(index_root / "good1-all-candidates.json")
    checkpoint = read_json(index_root / "checkpoint.json")
    if checkpoint.get("version") != CHECKPOINT_VERSION:
        raise PilotError("PILOT_METADATA_INVALID", "unsupported source checkpoint")
    validations: dict[str, Mapping[str, Any]] = {}
    for archive_id in SOURCE_ARCHIVES:
        validation = checkpoint.get("archives", {}).get(archive_id, {}).get("validation", {})
        if not archive_identity_ok(validation, download_root):
            raise PilotError("PILOT_METADATA_INVALID", f"verified archive identity mismatch: {archive_id}")
        validations[archive_id] = validation
    if proposal.get("candidate_count") != 27 or len(proposal.get("candidates") or []) != 27:
        raise PilotError("PILOT_METADATA_INVALID", "pilot input must preserve exactly 27 proposal candidates")
    by_id = {row["candidate_id"]: row for row in all_manifest.get("candidates") or []}
    valid: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    for proposal_row in proposal["candidates"]:
        candidate_id = proposal_row.get("candidate_id")
        row = by_id.get(candidate_id)
        reasons: list[str] = []
        if not row:
            reasons.append("candidate missing from full manifest")
        else:
            checks = [
                (row.get("exact_gloss_id") == TARGET_GLOSS_ID, "gloss_id is not exact 좋다1"),
                (row.get("archive_id") in SOURCE_ARCHIVES, "source archive is outside verified pilot set"),
                (row.get("signer_id") not in (None, "", "NOT_RESOLVED"), "signer unresolved"),
                (row.get("timecode_unit") == "seconds", "timecode unit is not seconds"),
                (isinstance(row.get("annotated_start"), (int, float)), "annotated start not numeric"),
                (isinstance(row.get("annotated_end"), (int, float)), "annotated end not numeric"),
                (bool(row.get("front_video_member")), "front member missing"),
                (row.get("front_connection") == "CONNECTED", "front member not connected"),
                (row.get("duplicate_status") == "UNIQUE", "candidate is duplicate"),
                (row.get("review_eligibility") == "ELIGIBLE_FOR_REVIEW_SELECTION", "review eligibility failed"),
                (proposal_row.get("signer_id") == row.get("signer_id"), "proposal signer mismatch"),
                (proposal_row.get("archive_id") == row.get("archive_id"), "proposal archive mismatch"),
                (proposal_row.get("annotated_start") == row.get("annotated_start"), "proposal start mismatch"),
                (proposal_row.get("annotated_end") == row.get("annotated_end"), "proposal end mismatch"),
                (proposal_row.get("front_video_member") == row.get("front_video_member"), "proposal member mismatch"),
            ]
            reasons.extend(message for passed, message in checks if not passed)
            if isinstance(row.get("annotated_start"), (int, float)) and isinstance(row.get("annotated_end"), (int, float)):
                if row["annotated_start"] >= row["annotated_end"]:
                    reasons.append("annotation range is invalid")
        if reasons:
            invalid.append({"candidate_id": candidate_id, "status": "PILOT_CANDIDATE_INVALID", "reasons": reasons})
        else:
            valid.append({**row, **{
                "selection_rank": proposal_row["selection_rank"],
                "selection_category": proposal_row["selection_category"],
                "selection_reason": proposal_row["selection_reason"],
            }})
    return {
        "proposal": proposal, "checkpoint": checkpoint, "validations": validations,
        "valid_candidates": valid, "invalid_candidates": invalid,
    }


def package_bytes(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def report_markdown(final: Mapping[str, Any], results: list[Mapping[str, Any]]) -> str:
    signer_counts = Counter(
        item["signer_id"] for item in results if item.get("status") == "PILOT_CLIP_VERIFIED"
    )
    lines = [
        "# `[좋다1]` pilot 전문가 검토 batch", "",
        f"- batch: `{BATCH_ID}` / `{REVISION}`",
        f"- 상태: `{final['primary_status']}`",
        "- corpus 전체 상태: `CORPUS_ARCHIVE_SET_INCOMPLETE`",
        f"- 검증 clip: {final['verified_clip_count']} / 27",
        f"- package bytes: {final['package_size_bytes']}",
        "- da7·da8은 읽거나 검증하지 않았으며 다운로드 임시 파일에는 stat만 수행했다.",
        "", "## Signer별 clip", "",
    ]
    for signer, count in sorted(signer_counts.items()):
        lines.append(f"- `{signer}`: {count}")
    lines.extend([
        "", "## 범위", "",
        "이 batch는 검증된 9개 archive에서 선정된 초기 UX·언어 품질 검토용 pilot이다. "
        "전체 corpus 대표성, 최종 variation coverage, 학습 set, held-out 평가 또는 gate 승격을 의미하지 않는다.",
    ])
    return "\n".join(lines) + "\n"


def validation_markdown(results: list[Mapping[str, Any]]) -> str:
    lines = [
        "# Pilot clip 검증", "",
        "| rank | candidate | signer | archive | 상태 | source CRC | clip decode | frame map |",
        "| ---: | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in sorted(results, key=lambda value: value.get("selection_rank", 10**9)):
        lines.append(
            f"| {row.get('selection_rank', '')} | {row.get('candidate_id', '')} | "
            f"{row.get('signer_id', '')} | {row.get('archive_id', '')} | `{row.get('status')}` | "
            f"{row.get('source', {}).get('crc_status', '')} | {row.get('clip_decode_status', '')} | "
            f"{row.get('frame_map_status', '')} |"
        )
    return "\n".join(lines) + "\n"


def limitations_markdown() -> str:
    return """# Pilot 한계

- da7·da8이 아직 corpus 범위에 포함되지 않았다.
- pilot 27개는 9 signer의 metadata 기반 대표·변이·감사 표본이며 최종 대표 batch가 아니다.
- `session_id`는 주석에서 문서화된 식별자를 확정할 수 없어 `NOT_RESOLVED`다.
- landmark, DTW, 모델 학습, threshold calibration을 수행하지 않았다.
- 전문가 검토 전 학습 영상 또는 내부 reference로 승인되지 않는다.
- `INTERNAL_EVAL_ONLY`, `PUBLIC_PRACTICE_READY`, 배포 준비 상태로 승격하지 않는다.
- da7·da8 검증 후 신규 signer/coverage gap을 candidate ID 기준으로 후속 batch에 추가해야 한다.
"""


def coexistence_markdown(samples: list[Mapping[str, Any]], start_free: int, end_free: int) -> str:
    lines = [
        "# da7·da8 다운로드 병행 보고", "",
        "- active download 파일은 열거나 해시·ZIP 검사하지 않고 크기·mtime만 확인했다.",
        f"- 시작 여유 공간: {start_free} bytes",
        f"- 종료 여유 공간: {end_free} bytes",
        f"- monitoring samples: {len(samples)}", "",
        "| 시각 | 상태 | da7 증가 | da8 증가 |",
        "| --- | --- | ---: | ---: |",
    ]
    for sample in samples:
        growth = sample.get("growth_bytes", {})
        lines.append(
            f"| {sample.get('checked_at')} | `{sample.get('status')}` | "
            f"{growth.get(ACTIVE_DOWNLOAD_NAMES[0])} | {growth.get(ACTIVE_DOWNLOAD_NAMES[1])} |"
        )
    return "\n".join(lines) + "\n"


def process_candidate(
    candidate: Mapping[str, Any], archive: ZipFile, member_info: ZipInfo,
    directories: Mapping[str, Path], ffmpeg: str, ffprobe: str,
) -> dict[str, Any]:
    rank = int(candidate["selection_rank"])
    candidate_id = str(candidate["candidate_id"])
    staging = directories["source"] / "current-source.mp4"
    clip_filename = safe_filename(candidate_id, rank)
    clip_path = directories["clips"] / clip_filename
    if staging.exists():
        staging.unlink()
    try:
        source_result = extract_member(archive, member_info, staging)
        source_metadata = probe_video(staging, ffprobe)
        source_pts = probe_frame_pts(staging, ffprobe)
        source_is_cfr, nominal_fps, source_step = cfr_metadata(source_metadata, source_pts)
        if not source_is_cfr:
            raise PilotError("PILOT_CLIP_BLOCKED_VFR", f"source is VFR: {candidate_id}")
        decode_video(staging, ffmpeg)
        frame_range = choose_frame_range(
            source_pts, float(source_metadata["duration"]),
            float(candidate["annotated_start"]), float(candidate["annotated_end"]),
        )
        create_clip(staging, clip_path, frame_range, ffmpeg)
        clip_metadata = probe_video(clip_path, ffprobe)
        clip_pts = probe_frame_pts(clip_path, ffprobe)
        clip_is_cfr, clip_fps, _ = cfr_metadata(clip_metadata, clip_pts)
        if not clip_is_cfr or abs(clip_fps - nominal_fps) > max(1e-4, nominal_fps * 1e-4):
            raise PilotError("PILOT_CLIP_BLOCKED_VFR", f"output is not source-rate CFR: {candidate_id}")
        expected_count = int(frame_range["end_exclusive"]) - int(frame_range["start_index"])
        if len(clip_pts) != expected_count or len(frame_range["source_pts"]) != expected_count:
            raise PilotError("PILOT_CLIP_FRAME_MAP_MISMATCH", f"output/source frame count mismatch: {candidate_id}")
        if clip_metadata["stream"].get("codec_name") != "h264":
            raise PilotError("PILOT_CLIP_METADATA_MISMATCH", f"output codec is not H.264: {candidate_id}")
        decode_video(clip_path, ffmpeg)
        clip_sha = sha256_file(clip_path)
        local_pts = rounded(clip_pts)
        mapped_source_pts = rounded(frame_range["source_pts"])
        review_start = round(float(frame_range["review_start"]), 6)
        review_end = round(float(frame_range["review_end"]), 6)
        clip_duration = float(clip_metadata["duration"])
        expected_duration = review_end - review_start
        if abs(clip_duration - expected_duration) > max(0.05, 1.5 * source_step):
            raise PilotError("PILOT_CLIP_METADATA_MISMATCH", f"clip duration mismatch: {candidate_id}")
        manifest_candidate = {
            "candidate_id": candidate_id,
            "gloss_id": TARGET_GLOSS_ID,
            "signer_id": candidate["signer_id"],
            "session_id": candidate["session_id"],
            "source_archive_id": candidate["archive_id"],
            "batch_id": BATCH_ID,
            "revision": REVISION,
            "camera_view": "FRONT",
            "clip_filename": clip_filename,
            "clip_sha256": clip_sha,
            "clip_size_bytes": clip_path.stat().st_size,
            "clip_duration_sec": round(clip_duration, 6),
            "fps_mode": "CFR",
            "nominal_fps": round(nominal_fps, 6),
            "frame_count": len(clip_pts),
            "frame_pts_sec": local_pts,
            "source_frame_pts_sec": mapped_source_pts,
            "annotated_start_local_frame": int(frame_range["annotated_start_frame"]),
            "annotated_end_local_frame": int(frame_range["annotated_end_frame"]),
            "annotated_start_source_sec": candidate["annotated_start"],
            "annotated_end_source_sec": candidate["annotated_end"],
            "review_start_source_sec": review_start,
            "review_end_source_sec": review_end,
            "review_mode": "COARSE",
            "precise_review_required": False,
            "precise_review_reason": "pilot default is coarse review",
            "selection_category": candidate["selection_category"],
            "selection_reason": candidate["selection_reason"],
            "target_status": "PENDING_EXPERT_REVIEW",
        }
        internal_map = {
            **manifest_candidate,
            "source_member": candidate["front_video_member"],
            "source_sha256": source_result["sha256"],
            "source_zip_crc32": source_result["zip_crc32"],
            "source_size_bytes": source_result["size_bytes"],
            "source_codec": source_metadata["stream"].get("codec_name"),
            "source_duration_sec": source_metadata["duration"],
            "desired_review_start_source_sec": frame_range["desired_review_start"],
            "desired_review_end_source_sec": frame_range["desired_review_end"],
        }
        write_json(directories["maps"] / f"{candidate_id}.json", internal_map)
        write_json(directories["checksums"] / f"{candidate_id}.json", {
            "candidate_id": candidate_id, "source": source_result,
            "clip": {"filename": clip_filename, "size_bytes": clip_path.stat().st_size, "sha256": clip_sha},
        })
        return {
            "selection_rank": rank, "candidate_id": candidate_id,
            "signer_id": candidate["signer_id"], "archive_id": candidate["archive_id"],
            "status": "PILOT_CLIP_VERIFIED", "source": source_result,
            "clip_decode_status": "PASS", "frame_map_status": "PASS",
            "clip_checksum_status": "PASS", "manifest_candidate": manifest_candidate,
        }
    finally:
        if staging.exists():
            staging.unlink()


def run(args: argparse.Namespace) -> dict[str, Any]:
    index_root = safe_directory(args.index_root, "INDEX_ROOT")
    download_root = safe_directory(args.download_root, "DOWNLOAD_ROOT")
    package_root = safe_directory(args.output, "OUTPUT_ROOT", create=True)
    if package_root == index_root or package_root == download_root:
        raise PilotError("PATH_NOT_ALLOWED", "output must be separate from source roots")
    directories = {
        "clips": package_root / "upload" / "clips",
        "source": package_root / "internal" / "source-members",
        "maps": package_root / "internal" / "frame-maps",
        "checksums": package_root / "internal" / "checksums",
        "reports": package_root / "reports",
    }
    for directory in directories.values():
        directory.mkdir(parents=True, exist_ok=True)
    free_start = shutil.disk_usage(package_root).free
    if free_start < MIN_STAGING_FREE_BYTES:
        raise PilotError("INSUFFICIENT_STAGING_SPACE", "less than 2 GiB free for safe staging")

    inputs = validate_inputs(index_root, download_root)
    checkpoint_path = package_root / "checkpoint.json"
    checkpoint = read_json(checkpoint_path) if checkpoint_path.exists() else {
        "version": CHECKPOINT_VERSION, "batch_id": BATCH_ID, "revision": REVISION,
        "created_at": now_iso(), "updated_at": now_iso(), "candidates": {},
        "invalid_candidates": inputs["invalid_candidates"], "download_samples": [],
    }
    start_sample = monitor_downloads(download_root, args.download_sample_seconds)
    checkpoint["download_samples"].append(start_sample)
    write_json(checkpoint_path, checkpoint)
    if start_sample["status"] == "DOWNLOAD_WRITE_STALLED_DURING_PILOT":
        raise PilotError("DOWNLOAD_WRITE_STALLED_DURING_PILOT", "active downloads did not grow before pilot")

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in inputs["valid_candidates"]:
        grouped[candidate["archive_id"]].append(candidate)
    stop_for_download = False
    for archive_id in SOURCE_ARCHIVES:
        candidates = sorted(grouped.get(archive_id, []), key=lambda row: row["selection_rank"])
        if not candidates or stop_for_download:
            continue
        archive_path = Path(inputs["validations"][archive_id]["source_path"])
        try:
            with ZipFile(archive_path) as archive:
                member_infos = {info.filename: info for info in archive.infolist()}
                for candidate in candidates:
                    candidate_id = candidate["candidate_id"]
                    prior = checkpoint["candidates"].get(candidate_id, {})
                    if prior.get("status") == "PILOT_CLIP_VERIFIED":
                        manifest_candidate = prior.get("manifest_candidate", {})
                        clip = directories["clips"] / str(manifest_candidate.get("clip_filename") or "")
                        if clip.is_file() and sha256_file(clip) == manifest_candidate.get("clip_sha256"):
                            continue
                    info = member_infos.get(candidate["front_video_member"])
                    if info is None:
                        result = {
                            "selection_rank": candidate["selection_rank"], "candidate_id": candidate_id,
                            "signer_id": candidate["signer_id"], "archive_id": archive_id,
                            "status": "PILOT_CLIP_METADATA_MISMATCH", "error": "front member missing from central directory",
                        }
                    else:
                        try:
                            result = process_candidate(
                                candidate, archive, info, directories, args.ffmpeg, args.ffprobe,
                            )
                        except PilotError as exc:
                            result = {
                                "selection_rank": candidate["selection_rank"], "candidate_id": candidate_id,
                                "signer_id": candidate["signer_id"], "archive_id": archive_id,
                                "status": exc.code, "error": str(exc),
                            }
                    checkpoint["candidates"][candidate_id] = result
                    checkpoint["updated_at"] = now_iso()
                    write_json(checkpoint_path, checkpoint)
                    sample = monitor_downloads(download_root, args.download_sample_seconds)
                    checkpoint["download_samples"].append(sample)
                    write_json(checkpoint_path, checkpoint)
                    if sample["status"] == "DOWNLOAD_WRITE_STALLED_DURING_PILOT":
                        stop_for_download = True
                        break
        except (BadZipFile, OSError) as exc:
            raise PilotError("EXTERNAL_DRIVE_IO_ERROR", f"archive I/O failed: {archive_id}") from exc

    for candidate in inputs["valid_candidates"]:
        if candidate["candidate_id"] not in checkpoint["candidates"]:
            checkpoint["candidates"][candidate["candidate_id"]] = {
                "selection_rank": candidate["selection_rank"], "candidate_id": candidate["candidate_id"],
                "signer_id": candidate["signer_id"], "archive_id": candidate["archive_id"],
                "status": "PILOT_CLIPS_DEFERRED_ACTIVE_DOWNLOAD",
            }
    results = list(checkpoint["candidates"].values()) + inputs["invalid_candidates"]
    completed = sorted(
        (row for row in checkpoint["candidates"].values() if row.get("status") == "PILOT_CLIP_VERIFIED"),
        key=lambda row: row["selection_rank"],
    )
    manifest = {
        "schema_version": "sign-expert-review-batch-v1",
        "batch_id": BATCH_ID,
        "batch_name": "손말첫걸음 전문가 검토 - 좋다1 pilot 01",
        "gloss_id": TARGET_GLOSS_ID,
        "revision": REVISION,
        "created_at": now_iso(),
        "review_padding_sec": REVIEW_PADDING_SEC,
        "batch_type": "PILOT",
        "corpus_complete": False,
        "missing_archives": list(MISSING_ARCHIVES),
        "source_archive_count": len(SOURCE_ARCHIVES),
        "expert_review_scope": "INITIAL_VALIDATION",
        "manifest_sha256": "0" * 64,
        "candidates": [row["manifest_candidate"] for row in completed],
    }
    manifest["manifest_sha256"] = manifest_content_sha256(manifest)
    manifest_path = package_root / "upload" / "review_batch_manifest.json"
    if completed:
        write_json(manifest_path, manifest)

    cli_verification = "NOT_RUN_INCOMPLETE_CLIP_SET"
    if len(completed) == 27:
        verify_report = directories["reports"] / "PORTAL_MANIFEST_VERIFICATION.json"
        process = subprocess.run([
            sys.executable, str(Path(__file__).with_name("verify_review_batch.py")),
            "--manifest", str(manifest_path), "--clips-dir", str(directories["clips"]),
            "--report", str(verify_report),
        ], check=False, capture_output=True, text=True)
        try:
            verification_payload = json.loads(process.stdout)
            cli_verification = str(verification_payload.get("status") or "INVALID")
        except json.JSONDecodeError:
            cli_verification = "INVALID_VERIFIER_OUTPUT"
        if process.returncode != 0:
            cli_verification = f"FAILED:{cli_verification}"

    primary = (
        "PILOT_REVIEW_BATCH_READY"
        if len(completed) == 27 and not stop_for_download and cli_verification == "VALID"
        else "PILOT_METADATA_READY" if stop_for_download and not completed
        else "PILOT_REVIEW_BATCH_PARTIAL"
    )
    free_end = shutil.disk_usage(package_root).free
    upload_size = package_bytes(package_root / "upload")
    final = {
        "primary_status": primary,
        "statuses": [
            primary, "CORPUS_ARCHIVE_SET_INCOMPLETE", "DA7_DA8_DOWNLOAD_IN_PROGRESS",
            "GOOGLE_UPLOAD_NOT_EXECUTED",
        ],
        "generated_at": now_iso(), "batch_id": BATCH_ID, "revision": REVISION,
        "source_archive_ids": list(SOURCE_ARCHIVES), "missing_archives": list(MISSING_ARCHIVES),
        "input_candidate_count": 27, "valid_input_candidate_count": len(inputs["valid_candidates"]),
        "invalid_input_candidates": inputs["invalid_candidates"],
        "verified_clip_count": len(completed),
        "blocked_candidate_count": 27 - len(completed),
        "signer_clip_counts": dict(sorted(Counter(row["signer_id"] for row in completed).items())),
        "review_padding_sec": REVIEW_PADDING_SEC,
        "package_size_bytes": 0,
        "upload_package_size_bytes": upload_size,
        "google_drive_estimated_bytes": upload_size,
        "download_stall_detected": stop_for_download,
        "download_samples": len(checkpoint["download_samples"]),
        "local_cli_verification": cli_verification,
        "local_portal_smoke": "NOT_RUN_NO_EXTERNAL_PACKAGE_ADAPTER",
        "clips_uploaded": 0, "training_executed": False, "gate_changed": False,
        "next_action": (
            "resume pilot clip generation after download write recovery" if stop_for_download
            else "operator review of the local pilot package; no upload until separately authorized"
        ),
    }
    final["package_size_bytes"] = package_bytes(package_root)
    write_json(package_root / "final-status.json", final)
    atomic_write_text(directories["reports"] / "PILOT_BATCH_REPORT.md", report_markdown(final, results))
    atomic_write_text(directories["reports"] / "PILOT_LIMITATIONS.md", limitations_markdown())
    atomic_write_text(directories["reports"] / "CLIP_VALIDATION_REPORT.md", validation_markdown(results))
    atomic_write_text(
        directories["reports"] / "DOWNLOAD_COEXISTENCE_REPORT.md",
        coexistence_markdown(checkpoint["download_samples"], free_start, free_end),
    )
    checkpoint["final_status"] = primary
    checkpoint["updated_at"] = now_iso()
    write_json(checkpoint_path, checkpoint)
    final["package_size_bytes"] = package_bytes(package_root)
    write_json(package_root / "final-status.json", final)
    atomic_write_text(directories["reports"] / "PILOT_BATCH_REPORT.md", report_markdown(final, results))
    return final


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--index-root", type=Path, required=True)
    value.add_argument("--download-root", type=Path, required=True)
    value.add_argument("--output", type=Path, required=True)
    value.add_argument("--ffmpeg", default="ffmpeg")
    value.add_argument("--ffprobe", default="ffprobe")
    value.add_argument("--download-sample-seconds", type=float, default=10.0)
    return value


def main() -> int:
    args = parser().parse_args()
    try:
        result = run(args)
    except PilotError as exc:
        print(json.dumps({"status": exc.code, "message": str(exc)}, ensure_ascii=False, indent=2))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
