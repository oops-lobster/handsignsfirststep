# Actual-27 Drive folder structure

`27`은 ZIP 개수가 아니라 보존 ZIP **1개에 들어 있는 MP4 수**다. 사용자가
업로드한 ZIP은 My Drive root에서 그대로 보존하며 workspace로 이동하거나
복제하지 않았다.

```text
My Drive/
├─ good1-pilot-review-01-clips-27.zip
│  └─ archive copy only; contains 27 videos; restricted; unchanged
│
└─ 손말첫걸음_전문가검토/
   └─ 좋다1/
      └─ provisional_9archives_batch_01/
         ├─ portal-assets/
         │  └─ good1-pilot-review-01/
         │     ├─ review_batch_manifest.public.json
         │     └─ clips/
         │        └─ 27 restricted H.264 MP4 files
         ├─ docs/
         └─ 손말첫걸음_좋다1_전문가검토_이벤트
            ├─ review_events  # 46-column header; 0 review rows
            └─ setup_log      # 1 setup audit row
```

## 역할 경계

| 위치 | 역할 | 포털 입력 | 변경 정책 |
|---|---|---:|---|
| archive ZIP | provenance·보존·수동 백업 | 아니오 | 이동·리네임·삭제 금지 |
| public manifest | 후보·frame/PTS·checksum·Drive ID | 예 | canonical hash로 재생성 |
| `clips/` MP4 27개 | 실제 제한 검토 영상 | 예 | candidate/revision/SHA dedupe |
| `review_events` | append-only 전문가 event | 예 | setup 단계에서는 header-only |
| `setup_log` | 운영 setup audit | 아니오 | 전문가 판정과 분리 |

## 공개 manifest 경계

포함:

- candidate/revision/gloss/signer/archive code
- clip filename, SHA-256, restricted `drive_file_id`
- CFR frame count와 local/source PTS map
- annotation과 coarse/precise 정책 필드

제외:

- absolute/relative filesystem path
- raw archive path와 `source_member`
- credentials, tokens, checkpoints
- internal validation logs와 source corpus metadata

별도 `frame-maps/` 폴더는 만들지 않았다. public manifest가 포털에서
필요한 27개 frame map을 완전하게 포함하기 때문이다.

실제 Drive/Sheet ID와 account-specific 링크는
`tools/sign-expert-review/.local/google-actual-27-workspace.json`에만 있으며
Git에 포함되지 않는다.
