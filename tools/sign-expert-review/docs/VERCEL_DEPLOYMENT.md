# Vercel deployment

## Fixed project boundary

Create or reuse only the dedicated project `handsignsfirststep-expert-review`.
Do not link this directory to the existing public learning-app project.

```text
Repository: oops-lobster/handsignsfirststep
Production branch: deploy/expert-review-portal
Root directory: tools/sign-expert-review
Build command: npm run build
Output directory: dist
Node: 20 or newer
```

The repository-root `.vercel/project.json` belongs to another project. Never
copy it into this portal or change it during portal deployment.

## Environment keys

Set the following in Production. Preview may use the same browser-safe IDs only
for a deliberately authorized smoke deployment; otherwise keep Preview at the
logged-out UI/build check.

```text
REVIEW_DATA_MODE=google
REVIEW_GOOGLE_CLIENT_ID=
REVIEW_ALLOWED_EMAIL=
REVIEW_DRIVE_FOLDER_ID=
REVIEW_MANIFEST_FILE_ID=
REVIEW_SPREADSHEET_ID=
REVIEW_SHEET_TAB=review_events
REVIEW_PREFETCH_MEMORY_MB=64
```

These are browser configuration and Restricted resource identifiers, not OAuth
client secrets. Never add a Google password, client secret, refresh token,
Desktop credential, Vercel token, or GitHub token.

## Build boundary

`scripts/build-vercel.mjs` copies only `web/index.html`, `web/styles.css`, and
`web/src/` into `dist/`. The build fails on non-allowlisted extensions, files
larger than 1 MiB, credential patterns, or mounted-volume paths. `.vercelignore`
also excludes fixtures, local state, results, docs, CLI data, MP4, and ZIP files
from the build upload.

## Runtime flow

1. Logged-out browser receives the shell and public `/config.json` values only.
2. Google Identity Services requests `openid email`, `drive.file`, and
   `spreadsheets`; the access token stays in memory.
3. The browser verifies the exact allowed email before it requests the manifest.
4. The Drive Node function repeats the verified-email check, then proxies a
   validated file ID with a 20 MiB ceiling and `no-store` response.
5. The browser verifies every clip SHA-256 before enabling playback or save.
6. Sheets remains append-only and protected by its Restricted ACL.

## Deployment gates

- Preview: build READY, assets 200 with correct MIME, SPA fallback, no console
  errors, shell-only logged-out state, and no media/data in output.
- Production: stable URL, exact OAuth JavaScript origin, shared-account login,
  27/27 batch load, checksum/frame smoke, reload/resume, and logged-out gate.
- Sheet setup: reuse the idempotent `setup_log` audit; do not create an expert
  event merely to prove Production connectivity.

Do not send the researcher link or begin review as part of deployment.
