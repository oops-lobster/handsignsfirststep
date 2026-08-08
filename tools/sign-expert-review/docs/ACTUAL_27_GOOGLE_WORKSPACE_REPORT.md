# 실제 27개 `[좋다1]` provisional batch의 Google Workspace 연동 보고서

기준일: 2026-08-08 (KST)

이 보고서의 `27개`는 **ZIP 1개 안의 MP4 영상 27개**를 뜻한다. ZIP이
27개라는 이전 가정은 폐기했다. 실제 Drive ID, OAuth client ID, 계정별
링크와 결과 산출물은 Git에서 제외된 `.local/` 설정에만 보관한다.

## 1. 최종 상태

```text
GOOGLE_ACCOUNT_MATCHED=true
ACTUAL_27_ZIP_FOLDER_CONFIRMED=true  # legacy status name; one ZIP file confirmed
ACTUAL_27_PORTAL_ASSETS_READY=true
GOOGLE_WORKSPACE_FOR_ACTUAL_27_READY=true
GOOGLE_SHEETS_EVENT_STORE_READY=true
PORTAL_GOOGLE_MODE_FOR_ACTUAL_27_READY=true
EXPERT_REVIEW_STARTED=false

FINAL_11_ARCHIVE_REVIEW_BATCH_READY=false
TRAINING_DATA_READY=false
INTERNAL_EVAL_ONLY=false
PUBLIC_PRACTICE_READY=false
```

`da7`·`da8`은 의도적으로 미포함이며, 이 batch는 9개 archive 기반
provisional batch다.

## 2. Drive 구조

- 보존 archive: `good1-pilot-review-01-clips-27.zip` 1개
- ZIP 내부 영상: 27개
- ZIP 처리: 이동·리네임·삭제·공유·포털 직접 입력 모두 없음
- portal-ready MP4: 27개, signer 9명 × 3개
- public manifest: `review_batch_manifest.public.json`
- manifest SHA-256:
  `0e8f8be29db1fdcc169597dce4af164a81ddb1cb839595da6329501a5d53a95d`
- 별도 frame-map 파일: 0개; 동등한 frame/PTS map이 public manifest에 내장
- 재실행 검증: 동일 candidate/revision/SHA 27개 모두 skip

public manifest의 27개 `drive_file_id`는 실제 MP4 ID와 일치한다. 내부
경로와 `source_member` 계열 필드는 업로드본에서 제거했다.

## 3. Spreadsheet

- 제목: `손말첫걸음_좋다1_전문가검토_이벤트`
- tabs: `review_events`, `setup_log`
- `review_events`: 46개 필수 header, 실제 event 0건
- `setup_log`: header 외 setup audit 1건
- 실제 review event 작성: 없음
- setup smoke review event: 없음

시트는 append-only event store로 준비했지만 전문가 판단을 만들지 않았다.

## 4. 포털 actual Google mode

- Web origin: `http://127.0.0.1:4311`
- batch load: 27 / 27
- Drive manifest/blob load: 통과
- SHA-256: `체크섬 확인`
- 후보 이동: 후보 1·2·3 통과
- reload/resume: OAuth 재연결 후 마지막 후보 위치 복원 통과
- frame stepping: 후보 3에서 `+1F`, frame 10 → 11 통과
- annotation playback: annotation 끝 frame 16에서 정지 통과
- repeated annotation playback: 후보 2에서 8회 순차 재생 및 4회 빠른 연속
  클릭 모두 같은 candidate·같은 Drive MP4·같은 annotation 구간 유지
- final frame state: `FRAME_ACCURATE_READY`
- final smoke에서 관찰된 blocking/runtime error: 0

초기 Chromium paused-seek smoke에서 중첩된 비동기 재생과 누적된 stale
video-frame callback 때문에 `FRAME_SEEK_UNVERIFIED`가 재현됐고, 빠르게
누르면 이전 작업이 현재 영상을 덮을 수 있었다. 플레이어 동작을 latest-wins
single-flight로 묶고 이전 작업·callback을 취소했으며, blob metadata 구독
순서와 PTS 내부 seek 지점을 안정화했다. 실제 Drive MP4에서 같은 후보의
주석 재생을 순차 8회와 빠른 연속 4회 실행해 같은 blob source가 유지되고
blocking/decode error가 0건임을 재검증했다.

## 5. event store와 결과 회수

실제 Google Sheet를 대상으로 fetch CLI를 실행했다.

```text
status=REVIEW_RESULTS_FETCHED
raw_event_count=0
current_event_count=0
incomplete_count=27
coarse_completed_count=0
precise_required_count=0
validation_issue_count=0
external_mutations_executed=false
```

실제 판정을 쓰지 않은 header-only event store를 정상 상태로 처리한다.

## 6. 용량

- archive ZIP 1개: 8,592,796 bytes (설정 당시 단일 archive 기준 Drive usage)
- MP4 27개 합계: 8,598,627 bytes
- public manifest: 62,729 bytes
- 별도 frame-map: 0 bytes
- portal-assets 합계: 8,661,356 bytes
- 최종 Drive usage: 17,256,005 / 16,106,127,360 bytes
- 남은 headroom: 16,088,871,355 bytes
- Drive trash: 0 bytes

## 7. 보안

- 검사 대상 32개(folder, Sheet, manifest, clips): owner-only
- 공개/anyone/anyone-with-link/domain-wide 권한: 없음
- 예상 밖 제3자 권한: 없음
- Web scopes: `drive.file`, `spreadsheets`
- browser token: memory-only
- Desktop credential/token: 저장소 밖, mode `0600`
- 포털 미디어: loopback-only same-origin proxy, 20 MiB 제한, `no-store`
- 실제 corpus 전체, 원본 archive 경로, landmarks, 학습 산출물 업로드: 없음

## 8. 생성·수정 범위

- public manifest 생성과 원격 중복 검사 보강
- 실제 Google Drive nested batch idempotency 보강
- 브라우저 OAuth scope 최소화
- restricted Drive same-origin media proxy 추가
- frame seek·주석 재생 single-flight, stale callback 취소와 반복 회귀 테스트 추가
- 포털 색상을 중립적 navy/slate 체계로 정리하고 초록색을 성공 상태로 제한
- fetch CLI의 실제 46열 `A:AT` 범위와 shared Sheets scope 정렬
- 실제 운영 문서와 gitignored local config 추가

## 9. local-only config

`tools/sign-expert-review/.local/google-actual-27-workspace.json`에 실제 계정,
Cloud project, OAuth client, private Drive/Sheet ID와 링크를 저장했다. 이
디렉터리는 `.gitignore`에 포함된다. 결과 회수 산출물과 sync checkpoint도
같은 local-only 영역에 있다.

## 10. 아직 하지 않은 작업

- `da7`·`da8` 통합과 최종 11-archive batch 재선정
- 연구원 초대, 링크 발송, 실제 검토
- 학습, MediaPipe, DTW, threshold calibration
- 공개 링크, 배포, commit, push
- Cloud Console에 남아 있을 수 있는 미사용 Desktop client secret 정리
  (정확한 생성 시각·사용 여부 확인 후 별도 수행; 추측 삭제하지 않음)

## 11. 다음 단일 작업

운영자가 이 보고서와 연구원 접근 정책을 확인한 뒤, 별도 명시적 승인으로
제한된 연구원 공유 단계를 시작한다. 현재는 공유하지 않고 멈춘다.
