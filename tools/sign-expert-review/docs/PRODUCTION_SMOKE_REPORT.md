# 손말첫걸음 전문가 검토 포털 Vercel Production 배포 보고서

기준일: 2026-08-08 (KST)

## 1. 최종 상태

```text
VERCEL_EXPERT_REVIEW_PORTAL_DEPLOYMENT_COMPLETE=true
VERCEL_PRODUCTION_DEPLOYED=true
GOOGLE_SHARED_ACCOUNT_LOGIN_READY=true
ACTUAL_PROVISIONAL_BATCH_LOAD_READY=true
GOOGLE_SHEETS_WRITE_READY=true
EXPERT_REVIEW_STARTED=false
RESEARCHER_LINK_SENT=false
```

별도 Vercel 프로젝트의 Production 배포와 실제 Restricted Google 자료
smoke를 완료했다. 연구원 링크는 발송하지 않았고 실제 판정도 저장하지 않았다.

## 2. 계정

- GitHub repository: `oops-lobster/handsignsfirststep`
- Vercel team: 사용자의 기존 `gwasuwontv-9969` team
- Google Cloud·Drive·Sheets 공동 계정: `handsignfirststep@gmail.com`
- Google Cloud Console 활성 계정과 포털 allowed email 일치: 통과
- Vercel과 Google 계정 역할 분리: 유지

비밀번호, OTP, 복구코드, access/refresh token, client secret은 요구하거나
저장소·Vercel 환경변수·보고서에 기록하지 않았다.

## 3. Git

- branch: `deploy/expert-review-portal`
- deployed commit: `512ba6465daa4aa100af47f0529ceefe6c7acd88`
- commit message: `feat(expert-review): prepare restricted Google portal for Vercel`
- remote push: `origin/deploy/expert-review-portal`과 일치
- 배포 범위: `tools/sign-expert-review`의 포털 코드·테스트·문서와 최소 배포 설정

기존 dirty worktree의 공개 앱·데이터 파이프라인 변경은 이 배포 commit에
포함하지 않았다.

## 4. Vercel

- project: `handsignsfirststep-expert-review`
- project ID: `prj_NMB05emSZ2olC6CkNsFdC0i1AOfi`
- 기존 공개 학습 앱 프로젝트와 분리: 통과
- root directory: `tools/sign-expert-review`
- framework preset: `Other`
- build command: `npm run build`
- output directory: `dist`
- production branch: `deploy/expert-review-portal`
- Production URL: <https://handsignsfirststep-expert-review.vercel.app>
- Production deployment: `dpl_2xm48eMdRiHr6oqggWKjpp4Nm9n3`
- Production state: `READY`
- Production source commit 연결: `512ba64`, 통과
- validated Preview: `dpl_3aEwc6mrd3avNuYKWBzog5mAc7iB`, `READY`

초기 자동 생성 임시 domain은 새 프로젝트에서 제거했고, 정식 Production
domain만 프로젝트의 custom Production domain으로 유지했다.

## 5. Environment variables

Production과 Preview에 다음 8개 key를 Sensitive로 설정했다.

```text
REVIEW_DATA_MODE
REVIEW_GOOGLE_CLIENT_ID
REVIEW_ALLOWED_EMAIL
REVIEW_DRIVE_FOLDER_ID
REVIEW_MANIFEST_FILE_ID
REVIEW_SPREADSHEET_ID
REVIEW_SHEET_TAB
REVIEW_PREFETCH_MEMORY_MB
```

Google 비밀번호, OAuth client secret, Desktop credential, token, ZIP, MP4,
manifest 본문, review result는 Vercel 환경변수에 넣지 않았다.

## 6. Google OAuth

- Web client: `HandsSigns Expert Review Portal Web`
- Authorized JavaScript Origin:
  `https://handsignsfirststep-expert-review.vercel.app`
- wildcard·Preview origin·Production HTTP origin 추가: 없음
- redirect URI 추가: 없음
- 공동 계정 OAuth 로그인과 consent: 통과
- 브라우저 access token: memory-only; 새로고침 후 재연결 필요

## 7. Drive 자료

- 실제 업로드 원본 해석: ZIP 1개 안의 MP4 27개
- Production adapter: ZIP 직접 해제 대신 portal-ready individual Drive MP4
- Drive 구조: `portal-assets/good1-pilot-review-01/clips/`
- manifest: `review_batch_manifest.public.json`
- 후보 수: 27
- 개별 MP4 수: 27 (`GOOD1_PILOT_001`부터 `GOOD1_PILOT_027`까지)
- Production 첫 MP4 다운로드·SHA-256 확인: 통과
- Drive function 응답: manifest와 MP4 요청 모두 HTTP 200
- `clips` 폴더 공유 상태: `비공개`
- 전체 corpus·ZIP·원본 경로·landmark·학습 산출물 공개 배포: 없음

## 8. Portal Production smoke

- 로그아웃: shell과 Google 연결 버튼만 표시; 후보·signer·manifest·영상 없음
- 공동 계정 로그인: 통과
- batch load: 27 / 27
- 상태: `FRAME_ACCURATE_READY`
- 첫 영상: checksum 확인, blob readyState 4
- `주석 구간만 재생`: 같은 후보에서 3회 반복 실행
- 반복 재생 source: 동일 blob URL 유지
- 반복 재생 candidate: `GOOD1-DA1-VXPAKOKS250349100-03` 유지
- 다른 영상으로 교체되는 현상: 재현되지 않음
- `FRAME_SEEK_UNVERIFIED`: 재현되지 않음
- frame stepping: frame 18에서 `+1F` 후 frame 19, source 유지
- 새로고침: 저장하지 않은 정밀 draft가 폐기되고 로그아웃 shell로 복귀
- 실제 review 저장: 없음
- Production function 요청: 관찰된 9건 모두 HTTP 200
- blocking client/runtime error: 0

잘못된 개인 계정으로 실제 OAuth scope를 새로 부여하는 smoke는 하지 않았다.
대신 client token revoke와 server-side allowlisted-email gate의 자동 테스트를
통과시켰다. 서버는 검증된 email이 일치하기 전에 Drive proxy를 열지 않는다.

Vercel runtime error 집계에는 Node 내부 `url.parse()` deprecation warning이
1건 표시됐다. 저장소 포털 코드에는 `url.parse()` 사용이 없고 같은 시점의
모든 function 요청은 200이어서 배포 차단 오류로 보지 않았다.

## 9. Google Sheets

- spreadsheet: `손말첫걸음_좋다1_전문가검토_이벤트`
- tabs: `review_events`, `setup_log`
- `setup_log`: `WORKBOOK_TEMPLATE_CREATED`, `READY_FOR_IMPORT` audit 1건
- audit detail: append-only contract 초기화, review event 미생성 명시
- `review_events`: 46개 header만 존재
- actual expert event: 0건
- 이번 Production smoke가 만든 event: 0건

기존 idempotent setup audit를 재사용했으며 연결 확인을 위해 가짜 전문가
판정을 만들지 않았다.

## 10. Security와 build output

- Vercel build: allowlisted 정적 파일 19개
- build output의 media/archive/data: 0개
- MP4·ZIP·manifest 본문·frame-map 원본: 미포함
- credential·token·client secret: 미포함
- Drive·Sheets ACL: Restricted owner-only 구조 유지
- token 저장: memory-only
- media proxy: verified email gate, file allowlist, 20 MiB 제한, `no-store`
- headers: CSP, HSTS, `nosniff`, `DENY`, `no-referrer`, camera/mic/location 차단
- robots: `noindex`

## 11. 테스트

배포 직후 재실행:

```text
portal lint: pass, 27 modules
portal JavaScript: 42 / 42 pass
portal Python: 14 / 14 pass
portal E2E: 7 / 7 pass
portal Vercel build: pass, 19 files, no media/archive/data
```

배포 전 전체 회귀 기록:

```text
root Node: 147 / 147 pass
root Python: 134 pass
responsive logged-out smoke: 375 / 1200 / 1440 pass
```

## 12. 아직 하지 않은 작업

- 연구원에게 Production URL과 공동 계정 로그인 정보 전달
- 실제 전문가 검토와 review event 저장
- `da7`·`da8` 통합 최종 batch
- 학습·threshold calibration·공개 학습 앱 연결

## 13. 사용자가 연구원님께 별도로 전달할 것

1. Production URL
2. 공동 Google 계정 `handsignfirststep@gmail.com`
3. 비밀번호는 저장소·Vercel·메시지 자동화가 아닌 별도 비공개 경로로 전달

Codex는 연구원에게 링크나 메시지를 보내지 않았다.

## 14. 다음 단일 작업

사용자가 실제 공유 시점을 승인한 뒤 Production URL과 공동 계정 로그인
정보를 연구원에게 비공개로 전달한다. 그 전까지 실제 검토는 시작하지 않는다.
