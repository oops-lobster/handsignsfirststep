# Reviewer guide

This review does not ask you to relabel every start and end frame. First decide
whether `[좋다1]` is present, whether the existing corpus boundary is broadly
appropriate, and whether the clip can support learning or an internal
reference. Exact frame work is reserved for a small precise-review subset.

## Coarse review

1. Play the annotation range, then the full ±0.3-second review window if needed.
2. Explicitly select target validation and one boundary-direction assessment.
3. Judge learning use, reference use, representative fit, connection effect,
   and keep/exclude/hold.
4. Add notes only for conditional, ambiguous, unusable, excluded, mismatch, or
   precise-pending decisions.
5. Save, or use `Ctrl+Enter` to save and move to the next coarse-incomplete item.

The quick action applies only `[좋다1] confirmed + original boundary appropriate
+ reference allowed + keep`. Learning use, representative fit, and connection
effect remain explicit.

## Precise review

The precise panel is collapsed by default. Open it when a boundary needs
adjustment, the operator or low confidence flags the candidate, the candidate is
a final representative candidate, an audit sample is requested, or you decide
that exact frames are necessary. Use the visible ±1/±5 controls and start/end
buttons; never type frame numbers or seconds.

A directional coarse decision saved without precise frames becomes
`PRECISE_REVIEW_REQUIRED`. It counts as semantic/coarse completion but cannot be
exported for final cutting. A valid precise decision becomes
`PRECISE_REVIEW_COMPLETE`.

## Shortcuts

- `1/2/3`: confirmed, mismatch, uncertain.
- `K/A/D/Z/C/B/U/X`: the eight boundary assessments.
- `L`, `R`: learning allowed, reference allowed.
- In the open precise panel: arrows move one frame, Shift+arrows five, `S` sets
  start, `E` sets end, Space toggles playback.
- Shortcuts do not run while an input, select, or textarea has focus.

## Save and resume

`저장됨` means an append-only event was written. `로컬 저장됨, 동기화 대기`
means IndexedDB holds it until reconnect. Do not clear site data while events are
pending. Reopening restores the last unfinished or precise-pending candidate and
its revision-scoped draft.
