# Architecture and gap decisions

## Repository audit

The host project is a Node 18 ES-module application served by `server.js`, with
plain HTML/CSS/JavaScript and Node's built-in test runner. The expert portal
therefore uses the same lightweight platform, but its server and asset root are
separate under `tools/sign-expert-review`. No new frontend framework or runtime
dependency was introduced.

The existing sign-training harness accepts `sign-training-manifest-v2`, exact
`gloss_id == "좋다1"`, source-coordinate approved seconds, independent learning
and reference flags, review provenance, and a relative `source_video_path`. The
portal exporter writes that contract and points at future locally cut files
under `approved-clips/`; it does not cut those files or run training.

## Component boundaries

```text
restricted derived MP4 + external review manifest
        │
        ├── mockDriveAdapter ── local synthetic fixture
        └── googleDriveAdapter ── Drive files.get(alt=media), token in memory
                     │
          SHA-256 + CFR frame/PTS validation
                     │
       coarse ReviewModel ── optional PRECISE disclosure
                     │
               FramePlayer + BoundaryController
                     │
              validateReview (fail closed)
                     │
       append-only store ── failure ── IndexedDB queue
          │                              │
          ├── mockReviewStore            └── reconnect flush
          └── googleSheetsReviewStore
                     │
             fetch/reduce/audit CLI
                     │
       approved sign-training v2 manifest
```

## Trust boundaries

- The web manifest contains review codes only; a production batch should omit
  full archive/member and mounted-volume paths.
- Browser access tokens exist in memory only. They are never passed to
  localStorage, IndexedDB, URL parameters, or logs.
- Python Desktop OAuth state is confined to an operator-provided credentials
  directory excluded by repository ignore rules.
- Drive remains storage. Its native player is not the review interface.
- Sheet rows are immutable events. Current state is a deterministic reduction of
  latest valid events scoped to batch and revision.

## Gaps closed

- Adapter-based mock/Google data access.
- H.264/CFR/frame-count/checksum batch verification.
- PTS-based local-frame to source-time mapping.
- Keyboard and visible frame controls, annotation reset, selection playback.
- Coarse-first form, explicit boundary direction, and collapsed precise panel.
- 150-candidate fail-closed batch limit and full-pool separation.
- Derived coarse/precise/rejected/hold states with legacy-event normalization.
- Fail-closed target, boundary, usage, stale-revision, and clip-change rules.
- Local draft, last-candidate resume, append idempotency, offline retry queue.
- Quota/headroom preflight, remote duplicate detection, checkpointed sync.
- Raw/current/audit/progress result exports and training-manifest v2 export.
- Precise-pending exports and workload/quality statistics.

## Boundary derivation

New events keep legacy aliases for downstream compatibility. Authoritative
approved coordinates are derived in this order: valid PRECISE manual frames,
explicit coarse approval of the annotation, a future explicitly approved auto
proposal, or no boundary for ambiguous/unusable decisions. This implementation
does not calculate or approve automatic proposals. Direction-only coarse events
use `NEEDS_REFINEMENT` and null approved coordinates, so no exporter can mistake
them for cut-ready data.

## Gaps intentionally still open

- Vercel Production OAuth-origin registration and remote deployment smoke.
- Actual expert decisions and source cutting.
- Final 11-archive batch selection after `da7` and `da8` integration.
- Any training, score, release gate, or public-app activation.

The restricted local actual-27 Google smoke is recorded separately. It does not
make the provisional batch final or authorize expert review/public use.
