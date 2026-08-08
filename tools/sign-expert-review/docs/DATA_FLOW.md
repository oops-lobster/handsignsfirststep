# Data flow

## Before review

```text
exact gloss_id == "좋다1" internal candidate manifest
→ source annotation ±0.3 seconds
→ local CFR H.264 review MP4 + local/source PTS arrays + SHA-256
→ verify_review_batch.py
→ sync dry-run: remote duplicates + current storageQuota + 10% headroom
→ explicit --mode google --execute
→ restricted Drive batch and review_events header
```

The web-facing manifest should contain candidate/signer/archive codes and Drive
file IDs, not mounted-volume paths or complete source-member paths.

## During review

```text
Drive files.get(alt=media) → Blob → SHA-256 → Object URL → FramePlayer
FramePlayer + PTS map → approved local frames → approved source seconds
decision validation → append Sheet event
                           └─ network failure → IndexedDB → reconnect retry
```

At most the current and one prefetched blob are retained. Object URLs are
revoked during navigation.

## After review

```text
review_events → fetch_review_results.py
→ raw CSV + latest valid state + progress + validation audit
→ export_approved_manifest.py
→ approved training v2 manifest + learning/reference/rejected CSVs
→ operator cuts final MP4 from external original
→ existing sign-training pipeline (separate, not automatic)
```

No result in this flow toggles public practice or deployment gates.
