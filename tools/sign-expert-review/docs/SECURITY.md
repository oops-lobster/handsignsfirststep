# Security and privacy

## Data allowed online

Only expert-selected, derived ±0.3-second-context H.264 review clips, a minimized
review manifest, and append-only review events are in scope.

Never upload source archives, full sessions, `source-members/`, partial browser
downloads, keypoint collections, raw annotation archives, internal gate JSON,
secrets, user captures, landmarks, models, or training artifacts.

## Browser

- Access tokens are memory-only and never logged.
- The Web client requests `openid email`, `drive.file`, and `spreadsheets`.
  `openid email` is limited to verifying the configured shared-account email;
  no profile data is persisted. Drive-wide readonly access is not requested.
- Restricted Drive media is fetched with an Authorization header through the
  loopback-only same-origin proxy. The proxy validates IDs, caps responses at
  20 MiB, and does not persist credentials or bodies.
- Blob SHA-256 must match before player controls or save are enabled.
- Content Security Policy limits script/connect/media origins.
- Camera, microphone, and geolocation are disabled by Permissions Policy.
- The local server binds to `127.0.0.1` by default.
- Reviewer codes must not be personal email addresses.

## Vercel

- The Vercel project is separate from the public learning app and rooted at the
  portal directory.
- The Production build allowlists HTML, CSS, JavaScript, and small UI images;
  MP4, ZIP, manifest, fixture, `.local`, credential, and result files are absent.
- The Drive function verifies the bearer token's email with Google userinfo and
  enforces `REVIEW_ALLOWED_EMAIL` before any Drive response body is returned.
- Required Google configuration fails closed with `BLOCKED_VERCEL_ENV`; a
  configuration failure never falls back to public mock data.
- Security headers deny framing, sniffing, referrers, camera, microphone, and
  geolocation while allowing only the Google endpoints required by OAuth,
  Drive, and Sheets.

## CLI

- Google libraries load only in explicit Google mode.
- Upload requires explicit `--execute`; otherwise synchronization is a dry run.
- Same candidate, revision, and checksum is skipped idempotently.
- Same candidate/revision with a changed checksum is never overwritten.
- Quota is read from `storageQuota`; no free/paid capacity is hardcoded.
- Checkpoints contain candidate IDs, checksums, and Drive file IDs but no token.
- Credential directories and generated checkpoints are excluded from Git.
- CLI token writes set mode `0600`; Desktop secrets and tokens stay outside the
  repository.

## Logs and artifacts

Do not print access tokens, emails, full Drive IDs, complete internal paths, or
corpus member names in shared reports. The mock reports intentionally use fake
IDs. Real operational output belongs in restricted local storage, not Git.

The sanitized actual-27 report may record counts, hashes, byte totals, and
permission results. Private folder/file IDs, account-specific links, OAuth
client IDs, checkpoints, and fetched review results stay under the gitignored
`.local/` directory. The public Drive manifest must exclude source paths and
source-member provenance while retaining only portal-required frame maps,
checksums, and restricted Drive file IDs.
