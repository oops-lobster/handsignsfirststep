import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FramePlayer } from "../src/player/framePlayer.js";

const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../../fixtures/review_batch_manifest.json", import.meta.url)), "utf8"));
const candidate = manifest.candidates[0];

class PausedSeekVideo extends EventTarget {
  constructor() {
    super();
    this.paused = true;
    this._currentTime = candidate.frame_pts_sec[9];
    this.src = "blob:stable-candidate";
    this.callbacks = new Map();
    this.nextCallbackId = 1;
    this.maxActiveCallbacks = 0;
    this.seekTargets = [];
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  play() {
    if (!this.paused) return Promise.resolve();
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    this.dispatchEvent(new Event("playing"));
    queueMicrotask(() => this.present(this._currentTime));
    return Promise.resolve();
  }

  requestVideoFrameCallback(callback) {
    const id = this.nextCallbackId++;
    this.callbacks.set(id, callback);
    this.maxActiveCallbacks = Math.max(this.maxActiveCallbacks, this.callbacks.size);
    return id;
  }

  cancelVideoFrameCallback(id) {
    this.callbacks.delete(id);
  }

  present(mediaTime) {
    this._currentTime = mediaTime;
    this.flush(mediaTime);
  }

  flush(mediaTime) {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach(callback => callback(0, { mediaTime }));
  }

  set currentTime(value) {
    const staleTime = this._currentTime;
    this._currentTime = value;
    this.seekTargets.push(value);
    queueMicrotask(() => {
      this.flush(staleTime);
      this.dispatchEvent(new Event("seeked"));
      const presentedTime = [...candidate.frame_pts_sec].reverse().find(time => time <= value) ?? 0;
      this.flush(presentedTime);
    });
  }

  get currentTime() {
    return this._currentTime;
  }
}

class ImmediateMetadataVideo extends PausedSeekVideo {
  constructor() {
    super();
    this.duration = candidate.frame_pts_sec.at(-1) + (1 / candidate.nominal_fps);
  }

  set src(value) {
    this._src = value;
    if (value) this.dispatchEvent(new Event("loadedmetadata"));
  }

  get src() {
    return this._src;
  }

  removeAttribute(name) {
    if (name === "src") this._src = "";
  }

  load() {}
}

class NoOpSeekVideo extends PausedSeekVideo {
  set currentTime(value) {
    this.seekTargets.push(value);
    if (Math.abs(value - this._currentTime) < 1e-9) return;
    super.currentTime = value;
  }

  get currentTime() {
    return super.currentTime;
  }
}

test("load subscribes to metadata before assigning a fast blob source", async () => {
  const video = new ImmediateMetadataVideo();
  const player = new FramePlayer(video);

  await player.load(candidate, new Blob(["synthetic"], { type: "video/mp4" }));

  assert.equal(player.candidate.candidate_id, candidate.candidate_id);
  assert.equal(player.currentFrame, candidate.annotated_start_local_frame);
});

test("paused frame seek ignores a stale requestVideoFrameCallback", async () => {
  const video = new PausedSeekVideo();
  const player = new FramePlayer(video);
  player.candidate = candidate;
  player.currentFrame = 9;

  const frame = await player.step(1);

  assert.equal(frame, 10);
  assert.equal(player.currentFrame, 10);
  assert.ok(video.currentTime > candidate.frame_pts_sec[10]);
  assert.ok(video.currentTime < candidate.frame_pts_sec[11]);
});

test("a newer seek supersedes an overlapping seek without blocking the candidate", async () => {
  const video = new PausedSeekVideo();
  const player = new FramePlayer(video);
  player.candidate = candidate;
  player.currentFrame = 9;

  const firstResult = player.seekFrame(10).catch(error => error);
  const second = player.seekFrame(11);

  assert.equal((await firstResult).message, "FRAME_ACTION_SUPERSEDED");
  assert.equal(await second, 11);
  assert.equal(player.currentFrame, 11);
  assert.equal(video.callbacks.size, 0);
});

test("repeated annotation playback keeps the same source and exact frame range", async () => {
  const video = new PausedSeekVideo();
  const player = new FramePlayer(video);
  player.candidate = candidate;
  player.currentFrame = candidate.annotated_start_local_frame;
  const source = video.src;
  const start = candidate.annotated_start_local_frame;
  const end = candidate.annotated_end_local_frame;
  const expectedSeekTime = candidate.frame_pts_sec[start]
    + (candidate.frame_pts_sec[start + 1] - candidate.frame_pts_sec[start]) * 0.25;

  for (let count = 0; count < 8; count += 1) {
    await player.playSelection(start, end);
    video.present(candidate.frame_pts_sec[end]);
    await Promise.resolve();
    assert.equal(player.currentFrame, end);
    assert.equal(video.paused, true);
  }

  assert.equal(player.candidate.candidate_id, candidate.candidate_id);
  assert.equal(video.src, source);
  assert.deepEqual(video.seekTargets.slice(-8), Array(8).fill(expectedSeekTime));
  assert.equal(video.callbacks.size, 0);
  assert.ok(video.maxActiveCallbacks <= 2);
});

test("immediate annotation replay does not require a no-op seek event", async () => {
  const video = new NoOpSeekVideo();
  const player = new FramePlayer(video);
  player.candidate = candidate;
  player.currentFrame = candidate.annotated_start_local_frame;
  const start = candidate.annotated_start_local_frame;
  const end = candidate.annotated_end_local_frame;

  await player.playSelection(start, end);
  await player.playSelection(start, end);

  assert.equal(player.candidate.candidate_id, candidate.candidate_id);
  assert.equal(player.currentFrame, start);
  assert.equal(video.paused, false);
});
