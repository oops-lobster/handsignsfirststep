import { frameTolerance, frameToLocalTime, nearestFrame, stepFrame, validateFrameMap } from "./frameMap.js";

export class FramePlayer extends EventTarget {
  constructor(video) {
    super();
    this.video = video;
    this.candidate = null;
    this.currentFrame = 0;
    this.objectUrl = null;
    this.selectionStopFrame = null;
    this.actionController = null;
    this.actionPromise = null;
    this.trackingGeneration = 0;
    this.trackingCallbackId = null;
    this.#bindVideoEvents();
  }

  static browserSupport() {
    const video = document.createElement("video");
    const chromium = /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/OPR\//.test(navigator.userAgent);
    if (!chromium) return { ok: false, code: "UNSUPPORTED_BROWSER" };
    if (typeof video.requestVideoFrameCallback !== "function") return { ok: false, code: "UNSUPPORTED_BROWSER" };
    return { ok: true, code: "SUPPORTED_BROWSER" };
  }

  async load(candidate, blob) {
    const map = validateFrameMap(candidate);
    if (!map.ok) throw new Error(map.code);
    this.release();
    this.candidate = candidate;
    this.currentFrame = candidate.annotated_start_local_frame;
    this.objectUrl = URL.createObjectURL(blob);
    this.video.muted = true;
    this.video.preload = "auto";
    const metadataLoaded = once(this.video, "loadedmetadata", 8000, "VIDEO_DECODE_FAILED");
    this.video.src = this.objectUrl;
    this.video.load();
    await metadataLoaded;
    if (!Number.isFinite(this.video.duration) || this.video.duration <= 0) throw new Error("VIDEO_DECODE_FAILED");
    await this.#runAction(signal => this.#seekFrame(this.currentFrame, signal));
  }

  seekFrame(frame) {
    return this.#runAction(signal => this.#seekFrame(frame, signal));
  }

  async #seekFrame(frame, signal) {
    if (!this.candidate) throw new Error("FRAME_MAP_MISSING");
    throwIfAborted(signal);
    const targetFrame = stepFrame(this.candidate, 0, frame);
    const targetTime = frameToLocalTime(this.candidate, targetFrame);
    const seekTime = presentationSeekTime(this.candidate, targetFrame, this.video.duration);
    const tolerance = frameTolerance(this.candidate, targetFrame);
    this.video.pause();
    const seeked = once(this.video, "seeked", 3000, "FRAME_SEEK_UNVERIFIED", signal);
    // Chromium may deliver one already-queued callback for the frame displayed
    // before a paused seek. Subscribe before changing currentTime, ignore any
    // stale callback, and require the compositor to present the target PTS.
    const decodedFrame = videoFrameAt(this.video, targetTime, tolerance, 3000, signal);
    this.video.currentTime = seekTime;
    const [, metadata] = await Promise.all([seeked, decodedFrame]);
    throwIfAborted(signal);
    const observed = metadata.mediaTime ?? this.video.currentTime;
    if (Math.abs(observed - targetTime) > tolerance) {
      throw new Error("FRAME_SEEK_UNVERIFIED");
    }
    this.currentFrame = targetFrame;
    this.#emitFrame();
    return targetFrame;
  }

  step(delta) {
    if (!this.candidate) return Promise.reject(new Error("FRAME_MAP_MISSING"));
    return this.seekFrame(stepFrame(this.candidate, this.currentFrame, delta));
  }

  togglePlayback() {
    if (this.actionPromise) return this.actionPromise;
    if (this.video.paused) return this.video.play();
    this.video.pause();
    return Promise.resolve();
  }

  playSelection(startFrame, endFrame) {
    return this.#runAction(async signal => {
      this.selectionStopFrame = null;
      await this.#seekFrame(startFrame, signal);
      throwIfAborted(signal);
      this.selectionStopFrame = endFrame;
      await this.video.play();
    });
  }

  cancelAction() {
    this.#abortAction();
    this.selectionStopFrame = null;
    this.video.pause();
  }

  release() {
    this.cancelAction();
    this.#stopTracking();
    this.video.removeAttribute("src");
    this.video.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.candidate = null;
    this.selectionStopFrame = null;
  }

  #runAction(action) {
    this.#abortAction();
    const controller = new AbortController();
    this.actionController = controller;
    const promise = Promise.resolve().then(() => action(controller.signal));
    this.actionPromise = promise;
    promise.finally(() => {
      if (this.actionController !== controller) return;
      this.actionController = null;
      this.actionPromise = null;
    }).catch(() => {});
    return promise;
  }

  #abortAction() {
    this.actionController?.abort();
    this.actionController = null;
    this.actionPromise = null;
  }

  #startTracking() {
    this.#stopTracking();
    const generation = this.trackingGeneration;
    const track = (_now, metadata) => {
      this.trackingCallbackId = null;
      if (!this.candidate || generation !== this.trackingGeneration) return;
      this.currentFrame = nearestFrame(this.candidate, metadata.mediaTime ?? this.video.currentTime);
      this.#emitFrame();
      if (this.selectionStopFrame != null && this.currentFrame >= this.selectionStopFrame) {
        this.selectionStopFrame = null;
        this.video.pause();
        return;
      }
      if (!this.video.paused && generation === this.trackingGeneration) {
        this.trackingCallbackId = this.video.requestVideoFrameCallback(track);
      }
    };
    this.trackingCallbackId = this.video.requestVideoFrameCallback(track);
  }

  #stopTracking() {
    this.trackingGeneration += 1;
    if (this.trackingCallbackId != null && typeof this.video.cancelVideoFrameCallback === "function") {
      this.video.cancelVideoFrameCallback(this.trackingCallbackId);
    }
    this.trackingCallbackId = null;
  }

  #bindVideoEvents() {
    this.video.addEventListener("play", () => this.#startTracking());
    this.video.addEventListener("pause", () => {
      this.#stopTracking();
      this.dispatchEvent(new CustomEvent("playstate", { detail: { playing: false } }));
    });
    this.video.addEventListener("playing", () => this.dispatchEvent(new CustomEvent("playstate", { detail: { playing: true } })));
  }

  #emitFrame() {
    this.dispatchEvent(new CustomEvent("framechange", {
      detail: {
        frame: this.currentFrame,
        localTime: this.candidate.frame_pts_sec[this.currentFrame],
        sourceTime: this.candidate.source_frame_pts_sec[this.currentFrame]
      }
    }));
  }
}

function once(target, eventName, timeoutMs, errorCode, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(errorCode));
    }, timeoutMs);
    const handle = event => {
      cleanup();
      resolve(event);
    };
    const abort = () => {
      cleanup();
      reject(actionSupersededError());
    };
    const cleanup = () => {
      clearTimeout(timeout);
      target.removeEventListener(eventName, handle);
      signal?.removeEventListener("abort", abort);
    };
    target.addEventListener(eventName, handle, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function videoFrameAt(video, targetTime, tolerance, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let callbackId = null;
    const timeout = setTimeout(() => {
      fail(new Error("FRAME_SEEK_UNVERIFIED"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (callbackId != null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(callbackId);
      }
      callbackId = null;
    };
    const finish = metadata => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(metadata);
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(actionSupersededError());
    const inspect = (_now, metadata) => {
      callbackId = null;
      if (settled) return;
      if (signal?.aborted) return abort();
      const observed = metadata.mediaTime ?? video.currentTime;
      if (Number.isFinite(observed) && Math.abs(observed - targetTime) <= tolerance) {
        finish(metadata);
        return;
      }
      callbackId = video.requestVideoFrameCallback(inspect);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    callbackId = video.requestVideoFrameCallback(inspect);
  });
}

function actionSupersededError() {
  return new Error("FRAME_ACTION_SUPERSEDED");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw actionSupersededError();
}

function presentationSeekTime(candidate, frame, duration) {
  const targetFrame = stepFrame(candidate, 0, frame);
  const start = frameToLocalTime(candidate, targetFrame);
  const next = candidate.frame_pts_sec[targetFrame + 1];
  const fallbackEnd = start + (1 / candidate.nominal_fps);
  const end = Number.isFinite(next)
    ? next
    : Number.isFinite(duration) && duration > start
      ? duration
      : fallbackEnd;
  // Seeking exactly on a media timestamp boundary can nondeterministically
  // present the previous decoded frame in Chromium. Stay well inside this
  // frame's display interval, then verify the decoded mediaTime against PTS.
  return start + Math.max(0, end - start) * 0.25;
}
