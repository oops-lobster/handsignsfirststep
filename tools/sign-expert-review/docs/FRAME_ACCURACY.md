# Frame accuracy contract

The approved unit is a local decoded frame index mapped to a source timestamp.
The browser never derives the final source boundary with `frame / fps`.

Each candidate supplies equal-length, strictly ascending arrays:

```text
frame_pts_sec[local_frame]
source_frame_pts_sec[local_frame]
```

`frame_count` must equal both lengths and the review clip must be CFR H.264. The
batch verifier compares ffprobe codec, rate, decoded frame count, and SHA-256 to
the manifest.

The browser seeks to an interior presentation point within the target frame's
PTS interval, waits for `seeked`, obtains decoded media time from
`requestVideoFrameCallback`, and requires that decoded observation to match the
target PTS within half the adjacent frame interval. Failure produces
`FRAME_SEEK_UNVERIFIED` and disables save.

Fail-closed codes:

```text
FRAME_MAP_MISSING
FRAME_COUNT_MISMATCH
FRAME_SEEK_UNVERIFIED
UNSUPPORTED_BROWSER
VARIABLE_FRAME_RATE_UNSUPPORTED
VIDEO_DECODE_FAILED
CLIP_CHECKSUM_MISMATCH
```

The repository fixture is 24 frames at 30 fps, H.264/yuv420p, no B-frames. It
tests frame 0, frame 1, final frame, ±1, ±5, annotation jumps, boundary edits,
source timestamp mapping, event reload, and state reduction. It is not evidence
that any real corpus clip has correct frame timing.

If a real Chrome/codec combination cannot reliably satisfy this contract, keep
`FRAME_ACCURATE_READY=false` and replace the player with a tested WebCodecs plus
MP4-demux implementation before expert review.
