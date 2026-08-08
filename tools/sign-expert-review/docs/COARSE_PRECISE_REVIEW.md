# Coarse and precise review contract

## Coarse is the default

Every candidate opens in `COARSE`. Annotation frames are available as the
initial boundary, but the researcher must explicitly choose a
`boundary_assessment`; the UI does not preselect “keep original.” Frame controls
and source timestamps remain inside a closed disclosure.

`BOUNDARY_KEEP_ORIGINAL` produces annotation-based approved coordinates. A
directional adjustment or ambiguous decision produces
`PRECISE_REVIEW_REQUIRED`; its approved coordinates are null. Unusable decisions
are rejected and also have no approved boundary.

## Precise is exceptional

`PRECISE` is appropriate for operator-required candidates, low-confidence
boundaries, final representative candidates, audit samples, directional or
ambiguous coarse findings, and a researcher’s explicit request. Frames are set
only through the verified player controls. Valid manual frames outrank the
annotation and become source timestamps through the manifest PTS map.

The states are intentionally independent:

- `COARSE_REVIEW_COMPLETE`: semantic review complete; no precise work required.
- `PRECISE_REVIEW_REQUIRED`: semantic review complete; final cutting blocked.
- `PRECISE_REVIEW_COMPLETE`: exact boundary complete.
- `REVIEW_ON_HOLD`: unresolved decision; exports blocked.
- `REJECTED`: excluded, mismatched, or unusable.

Legacy `boundary_status`, `learning_allowed`, and `reference_allowed` aliases are
still stored and older events are normalized during reduction. Existing Sheet
rows stay immutable.
