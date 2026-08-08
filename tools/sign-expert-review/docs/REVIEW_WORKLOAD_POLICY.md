# Researcher workload policy

## Batch boundary

The full exact `[좋다1]` pool is an operator-analysis asset, not portal input.
Researchers receive a separately approved representative batch:

- recommended: 60–120 candidates;
- default operational maximum: 120;
- absolute technical maximum: 150;
- 151 or more: `REVIEW_BATCH_TOO_LARGE`, portal and sync validation blocked.

Batch manifests should have a human-readable batch name, stable revision, and
only the metadata necessary for review. This portal never creates the full pool
or chooses the representative sample.

## Expected precise work

Precise review should normally cover only 1–3 final learning-video candidates,
directional boundary problems, ambiguous or low-confidence boundaries, and a
small audit sample. Coarse completion is reported separately from precise
completion and export readiness.

## Workload evidence

`review_statistics.json` reports batch totals, coarse/precise counts, target and
boundary quality rates, learning/reference suitability, exclusions, signer
completion, average review time, interaction count, and unsynced events. These
metrics evaluate annotation quality and researcher workload; they are not model
scores and do not activate any public or training gate.
