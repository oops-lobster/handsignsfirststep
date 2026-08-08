# Operator runbook

## 1. Verify a local package

```bash
python3 tools/sign-expert-review/cli/verify_review_batch.py \
  --manifest "$REVIEW_BATCH_MANIFEST" \
  --clips-dir "$REVIEW_CLIPS_DIR" \
  --report "$REVIEW_REPORT_DIR/verify.json"
```

Resolve every block before continuing. VFR, missing maps, changed checksums,
duplicate IDs, non-H.264 media, and non-exact gloss all stop the workflow.
The portal also rejects more than 150 candidates with `REVIEW_BATCH_TOO_LARGE`.
Select 60–120 representative candidates by default; never pass the full pool as
the researcher batch.

## 2. Dry-run synchronization

Mock preflight (safe repository fixture):

```bash
python3 tools/sign-expert-review/cli/sync_review_batch_to_drive.py \
  --manifest tools/sign-expert-review/fixtures/review_batch_manifest.json \
  --clips-dir tools/sign-expert-review/fixtures \
  --drive-parent-folder-id mock-parent \
  --spreadsheet-id mock-sheet \
  --mode mock \
  --dry-run
```

Real preflight reads actual quota but does not upload:

```bash
python3 tools/sign-expert-review/cli/sync_review_batch_to_drive.py \
  --manifest "$REVIEW_BATCH_MANIFEST" \
  --clips-dir "$REVIEW_CLIPS_DIR" \
  --drive-parent-folder-id "$DRIVE_FOLDER_ID" \
  --spreadsheet-id "$SHEET_ID" \
  --credentials-dir "$GOOGLE_CREDENTIALS" \
  --mode google \
  --dry-run
```

Check planned bytes, expected final usage, 10% headroom, trash warning,
duplicate skips, and zero file-change conflicts.

## 3. Upload only after explicit approval

Replace `--dry-run` with `--execute`. The CLI creates/uses the batch and clips
folders, performs resumable uploads, appends appProperties, prepares the exact
Sheet header, and writes a checkpoint. Rerun after interruption: remote
candidate/revision/checksum matching skips completed files.

The uploaded manifest is always the generated minimized
`review_batch_manifest.public.json`, never the internal manifest. Use
`--public-manifest-output` to keep a local audit copy. It contains Drive file IDs
for all candidates, a recomputed canonical manifest hash, and no private source
path/member fields.

## 4. Run portal

```bash
REVIEW_DATA_MODE=mock npm run sign-review:dev
```

Use Google mode only after `GOOGLE_SETUP.md` checks pass. Provide the Web client,
manifest, Sheet, and folder IDs through uncommitted environment variables. Do
not expose the local server beyond `127.0.0.1`.

For an actual-data smoke, verify in order: 27 candidates load, candidates 1–3
download with `체크섬 확인`, `+1F` advances by exactly one manifest frame,
annotation-range playback stops at the annotated end, eight sequential and four
rapid annotation-play clicks keep the same candidate, Drive MP4 source, and
annotation range without `FRAME_SEEK_UNVERIFIED`, and reload plus OAuth reconnect
restores the last candidate. Do not save a judgment during setup.

## 5. Retrieve results

Mock fixture:

```bash
python3 tools/sign-expert-review/cli/fetch_review_results.py \
  --manifest tools/sign-expert-review/fixtures/review_batch_manifest.json \
  --events-file tools/sign-expert-review/fixtures/mock_review_events.json \
  --mode mock \
  --output-dir /tmp/good1-review-results
```

Google mode uses `--spreadsheet-id`, `--credentials-dir`, `--sheet-tab
review_events`, and `--mode google`. It reuses the Desktop client's full Sheets
grant so a shared token file does not trigger a conflicting readonly-scope OAuth
flow. A header-only Sheet is valid and produces zero raw/current events with all
candidates incomplete.
Inspect `validation_report.md`, `review_progress.md`,
`precise-review-required.{json,csv,md}`, and `review_statistics.json`. The latter
separates coarse completion, precise pending/completion, target and boundary
quality rates, usage rates, exclusion, signer completion, review time, clicks,
and unsynced events.

## 6. Export approved candidates

```bash
python3 tools/sign-expert-review/cli/export_approved_manifest.py \
  --review-manifest "$REVIEW_BATCH_MANIFEST" \
  --review-current "$RESULTS/review_current.json" \
  --output-dir "$APPROVED_OUTPUT"
```

Only confirmed, non-excluded candidates with unconditional use approval and a
valid approved boundary enter the training manifest. If precise review is
required, `PRECISE_REVIEW_COMPLETE` is mandatory. `NEEDS_REFINEMENT`, hold,
conditional, uncertain, mismatched, stale, and incomplete decisions remain in
`rejected-candidates.csv`.

Optional, non-destructive MASTER workbook copy:

```bash
python3 tools/sign-expert-review/cli/export_reviews_to_excel.py \
  --workbook "$MASTER_XLSX" \
  --review-manifest "$REVIEW_BATCH_MANIFEST" \
  --review-current "$RESULTS/review_current.json" \
  --output-dir "$EXCEL_EXPORT_DIR"
```

This adds a timestamped portal-result sheet to a timestamped copy and writes a
change report; it never overwrites the source workbook.

## 7. External steps

Cut final clips from the mounted original using approved source coordinates,
verify their hashes, then run the existing pipeline separately. Never infer
training or public readiness from portal completion.

## 8. Actual-27 archive rule

The current archive is one ZIP containing 27 videos. Preserve it in place. Do
not create an `uploaded-zips/` copy, materialize portal media from the Drive ZIP
in the browser, or report 27 ZIP files. The independently verified local package
is the portal-ready source. `da7` and `da8` remain out of scope until the
separate final archive integration step.

## 9. Vercel Production

Use a separate Vercel project rooted at `tools/sign-expert-review`. The build
command is `npm run build` and the output directory is `dist`. Configure Google
mode with the keys in `.env.example`; never copy the repository-root `.vercel`
link because that belongs to the public learning app.

The current actual-27 path remains individual mode: one preserved ZIP contains
27 videos, while the portal reads the separately validated public manifest and
27 Restricted Drive MP4 files. Do not add a ZIP browser adapter.

Before sharing, verify logged-out shell-only behavior, allowlisted shared-account
login, 27/27 load, checksum/frame navigation, repeated annotation playback,
reload/resume, and the existing idempotent `setup_log` audit. Do not create an
expert decision during setup and do not send the link automatically.
