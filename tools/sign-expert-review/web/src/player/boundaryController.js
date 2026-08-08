import { clampFrame, frameToSourceTime } from "./frameMap.js";

export class BoundaryController {
  constructor(candidate, saved = null) {
    this.candidate = candidate;
    this.reset(saved);
  }

  reset(saved = null) {
    this.startFrame = saved?.manual_start_local_frame ?? saved?.approved_start_local_frame ?? this.candidate.annotated_start_local_frame;
    this.endFrame = saved?.manual_end_local_frame ?? saved?.approved_end_local_frame ?? this.candidate.annotated_end_local_frame;
    this.status = saved?.boundary_status ?? "KEEP_ORIGINAL";
  }

  resetToAnnotation() {
    this.startFrame = this.candidate.annotated_start_local_frame;
    this.endFrame = this.candidate.annotated_end_local_frame;
    this.status = "KEEP_ORIGINAL";
    return this.snapshot();
  }

  setStart(frame) {
    this.startFrame = clampFrame(this.candidate, frame);
    this.#refreshStatus();
    return this.snapshot();
  }

  setEnd(frame) {
    this.endFrame = clampFrame(this.candidate, frame);
    this.#refreshStatus();
    return this.snapshot();
  }

  #refreshStatus() {
    this.status = this.startFrame === this.candidate.annotated_start_local_frame &&
      this.endFrame === this.candidate.annotated_end_local_frame
      ? "KEEP_ORIGINAL"
      : "MODIFIED";
  }

  snapshot() {
    return {
      boundary_status: this.status,
      manual_start_local_frame: this.startFrame,
      manual_end_local_frame: this.endFrame,
      manual_start_source_sec: frameToSourceTime(this.candidate, this.startFrame),
      manual_end_source_sec: frameToSourceTime(this.candidate, this.endFrame),
      approved_start_local_frame: this.startFrame,
      approved_end_local_frame: this.endFrame,
      approved_start_source_sec: frameToSourceTime(this.candidate, this.startFrame),
      approved_end_source_sec: frameToSourceTime(this.candidate, this.endFrame)
    };
  }
}
