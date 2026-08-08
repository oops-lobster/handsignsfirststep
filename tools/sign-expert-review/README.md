# `[좋다1]` expert frame review portal

This isolated research tool reviews restricted, derived H.264 MP4 clips with a
manifest-provided frame/PTS map. It never cuts video in the browser and it does
not alter the public learning app or any release gate.

Current status:

```text
EXPERT_REVIEW_PORTAL_IMPLEMENTATION_COMPLETE=true
EXPERT_REVIEW_LOW_BURDEN_FORM_COMPLETE=true
ACTUAL_27_PORTAL_ASSETS_READY=true
PORTAL_GOOGLE_MODE_FOR_ACTUAL_27_READY=true
VERCEL_PRODUCTION_CONFIGURATION_READY=true
EXPERT_REVIEW_STARTED=false
FINAL_11_ARCHIVE_REVIEW_BATCH_READY=false
```

The actual-27 readiness status refers to a restricted, operator-owned Google
Workspace and local package outside Git. Git contains only synthetic fixture
metadata; generated mock MP4 files are local and ignored. No corpus clip, expert
decision, OAuth token, private Drive identifier, external path, landmark, or user
capture is committed.
See `docs/ACTUAL_27_GOOGLE_WORKSPACE_REPORT.md` for the sanitized setup record.

## Quick start

```bash
cd tools/sign-expert-review
REVIEW_DATA_MODE=mock npm run dev
# open http://127.0.0.1:4311 in current Chrome

npm test
npm run e2e
npm run build
```

Mock browser playback expects locally generated synthetic fixture clips; those
MP4 files are intentionally gitignored. Unit and workflow tests do not require
committed video files.

## Vercel deployment

The Vercel project is intentionally rooted at `tools/sign-expert-review`, not
the repository root and not the existing public learning-app project. Its
`npm run build` creates an allowlisted `dist/` containing only the portal HTML,
CSS, and JavaScript. Restricted media, ZIPs, manifests, fixtures, local config,
credentials, and review results are excluded.

Production uses two small Node functions: `/api/config` publishes browser-safe
configuration and `/api/google-drive` validates the short-lived Google token's
verified email before proxying a bounded Drive file. The browser independently
checks the same allowlist before loading the manifest or Sheet. See
`docs/VERCEL_DEPLOYMENT.md`.

The portal is coarse-first. Researchers explicitly judge the target, boundary
direction, learning/reference use, representative fit, connection effect, and
exclusion state. Annotation coordinates remain the initial boundary, but frame
controls stay collapsed unless precise review is requested. A coarse direction
judgment can be saved as `PRECISE_REVIEW_REQUIRED` without inventing approved
frames. See `docs/COARSE_PRECISE_REVIEW.md`.

Only an operator-approved batch is accepted. The recommended workload is
60–120 candidates and a batch over 150 fails closed with
`REVIEW_BATCH_TOO_LARGE`; the full candidate pool is never the reviewer UI input.

## CLI smoke flow

```bash
python3 tools/sign-expert-review/cli/verify_review_batch.py \
  --manifest tools/sign-expert-review/fixtures/review_batch_manifest.json \
  --clips-dir tools/sign-expert-review/fixtures

python3 tools/sign-expert-review/cli/sync_review_batch_to_drive.py \
  --manifest tools/sign-expert-review/fixtures/review_batch_manifest.json \
  --clips-dir tools/sign-expert-review/fixtures \
  --drive-parent-folder-id mock-parent \
  --spreadsheet-id mock-sheet \
  --mode mock \
  --dry-run
```

Results retrieval and training-manifest export are described in
`docs/OPERATOR_RUNBOOK.md`. Google mode and `--execute` are intentionally absent
from the quick start.

The actual provisional package consists of one preserved archive ZIP containing
27 MP4 clips. It is not 27 ZIP files. Portal playback uses a separate minimized
public manifest and 27 individual Drive MP4 files; the browser never treats the
ZIP as playable input.

## Modules

- `web/`: separate static SPA, local server, frame player, adapters, queue.
- `cli/`: verification, quota-aware synchronization, event retrieval, export.
- `schemas/`: review batch, append event, current state, approved export.
- `fixtures/`: synthetic CFR videos and mock Drive/Sheet state.
- `tests/`: dependency-free Python CLI tests; `web/tests/` contains JS tests.
- `docs/`: architecture, setup, security, accuracy, and operator guidance.

Result retrieval also writes `precise-review-required.{json,csv,md}` and
`review_statistics.json`. The approved exporter blocks `NEEDS_REFINEMENT`, hold,
ambiguous, and incomplete precise decisions.

## Explicit non-claims

The actual-27 smoke validates the restricted operator account, manifest and
Drive blob reads, checksums, candidate navigation, frame stepping, annotation
range playback (including repeated and rapid clicks that preserve the same
candidate/source), reload/resume, and an empty Sheet result fetch. It does not
constitute expert review, final 11-archive readiness, model accuracy,
`INTERNAL_EVAL_ONLY`, `PUBLIC_PRACTICE_READY`, or deployment readiness.
