# Google setup (operator-controlled)

## Web OAuth client

Create a Google Identity Services Web application client for the review portal's
exact origin. The current local origin is `http://127.0.0.1:4311`; do not add a
wildcard or a public origin for local testing. The portal asks only for:

```text
openid
email
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/spreadsheets
```

`openid email` is used only to compare the verified email with the configured
shared-account allowlist. `drive.file` reads files created or opened by this app
without granting a broad Drive-wide readonly scope. Sheets access appends review
events. The token and verified email stay in JavaScript memory and expire with
the page/session; the browser stores no refresh token. Reload therefore requires
reconnecting Google OAuth.

Drive media is fetched through the restricted same-origin local endpoint
`/google-drive/files/<file-id>`. The endpoint accepts only validated IDs and a
Bearer token, never logs the token, caps each asset at 20 MiB, and returns
`no-store` responses. This avoids browser cross-origin media failures while the
checksum gate remains in the browser adapter.

On Vercel the equivalent endpoint is a Node function. It calls Google userinfo
with the presented access token and rejects a non-allowlisted account before it
proxies any Drive body. This server-side check supplements, but does not replace,
the Restricted Drive and Sheets ACLs.

Set local, uncommitted configuration:

```text
REVIEW_DATA_MODE=google
REVIEW_GOOGLE_CLIENT_ID=
REVIEW_ALLOWED_EMAIL=
REVIEW_DRIVE_FOLDER_ID=
REVIEW_MANIFEST_FILE_ID=
REVIEW_SPREADSHEET_ID=
REVIEW_SHEET_TAB=review_events
```

The account is authorized only when its verified email matches the configured
allowlist and the APIs can read the restricted file and Sheet. The email is an
environment value, not a source-code constant.

For Production, add only the exact HTTPS Vercel origin to the Web client. Do not
add wildcard or transient Preview origins. The shared account must remain the
OAuth consent test user while the consent screen is in Testing.

## Desktop OAuth client for CLI

The sync CLI requires Drive file creation plus Sheets access. Put the Desktop
OAuth JSON at `<credentials-dir>/client_secrets.json`. The CLI may create
`<credentials-dir>/token.json`; both names are ignored by Git. Store them outside
the repository, for example under
`~/Library/Application Support/HandsSignsFirstStep/google/`, and keep both files
mode `0600`.

Install Google client libraries in an operator-owned virtual environment only:

```bash
python -m pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib
```

Do not put passwords, OTP values, recovery codes, service-account keys, or
frontend client secrets in this repository. The OAuth browser belongs to the
operator; the CLI never automates account login.

## Restricted actual-27 Drive layout

```text
My Drive/
├─ good1-pilot-review-01-clips-27.zip  # one preserved ZIP; contains 27 videos
└─ 손말첫걸음_전문가검토/
   └─ 좋다1/
      └─ provisional_9archives_batch_01/
         ├─ portal-assets/
         │  └─ good1-pilot-review-01/
         │     ├─ review_batch_manifest.public.json
         │     └─ clips/                # 27 individual MP4 files
         ├─ docs/
         └─ 손말첫걸음_좋다1_전문가검토_이벤트
```

Keep general access `Restricted`. Do not create public or anyone-with-link
permissions. The sync code never creates a sharing permission. The original ZIP
is intentionally not moved, renamed, deleted, or used as portal input. Separate
frame-map files are unnecessary when the public manifest contains the complete
validated frame/PTS arrays.

## Real-data readiness check

Before real review, manually verify one non-sensitive test file end to end:

1. Correct reviewer account can consent.
2. Wrong account receives `GOOGLE_ACCOUNT_NOT_AUTHORIZED`.
3. Restricted MP4 loads through Drive API and checksum matches.
4. One event appends once to `review_events` and duplicate resend is ignored.
5. Token expiry requests consent again without persisted browser credentials.

For setup without a real decision, keep `review_events` header-only and write the
setup audit to `setup_log`. An empty event store must pass the result fetch CLI.
Store private IDs and links only in the gitignored
`tools/sign-expert-review/.local/google-actual-27-workspace.json`.
