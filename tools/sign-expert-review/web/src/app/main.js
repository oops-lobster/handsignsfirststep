import { MockDriveAdapter } from "../adapters/mockDriveAdapter.js";
import { GoogleDriveAdapter } from "../adapters/googleDriveAdapter.js";
import { MockReviewStore } from "../adapters/mockReviewStore.js";
import { GoogleSheetsReviewStore } from "../adapters/googleSheetsReviewStore.js";
import { GoogleIdentityAuth } from "../auth/googleIdentity.js";
import { FramePlayer } from "../player/framePlayer.js";
import { BoundaryController } from "../player/boundaryController.js";
import { createReviewEvent } from "../review/eventFactory.js";
import { latestEvents, progressFor } from "../review/eventReducer.js";
import { candidateReviewState, normalizeReviewInput } from "../review/reviewModel.js";
import { OfflineEventQueue } from "../storage/offlineQueue.js";
import { ReviewSession } from "../storage/reviewSession.js";
import { validateReview } from "../validation/reviewValidation.js";
import { validateReviewManifest } from "../validation/manifestValidation.js";

const elements = Object.fromEntries([
  "app", "mode-label", "batch-name", "frame-ready", "sync-count", "google-connect", "progress-percent", "progress-bar",
  "progress-summary", "progress-detail", "candidate-search", "status-filter", "signer-filter", "candidate-list", "blocking-banner",
  "candidate-position", "candidate-title", "candidate-meta", "previous-candidate", "next-pending", "next-precise", "review-video",
  "video-status", "video-loading", "play-annotation", "play-review-window", "precise-panel", "precise-mode-status",
  "current-frame", "frame-total", "local-time", "source-time", "annotation-range", "approved-range", "playhead", "play-toggle",
  "set-start", "set-end", "play-selection", "reset-boundaries", "annotation-summary", "approved-summary", "review-form",
  "reviewer-code", "quick-action", "quick-summary", "representative-fit", "sentence-effect", "exclusion-reason", "expert-notes",
  "validation-message", "save-status", "hold-review", "save-only", "toast"
].map(id => [id.replaceAll("-", "_"), document.getElementById(id)]));

const state = {
  config: null,
  manifest: null,
  drive: null,
  store: null,
  auth: null,
  queue: new OfflineEventQueue(),
  session: new ReviewSession(),
  events: [],
  current: new Map(),
  candidateIndex: -1,
  boundary: null,
  player: new FramePlayer(elements.review_video),
  verified: false,
  dirty: false,
  blobCache: new Map(),
  cacheBytes: 0,
  memoryBudgetBytes: 64 * 1024 * 1024,
  loadingId: 0,
  playerActionPromise: null,
  openedAt: 0,
  interactionCount: 0
};

bootstrap().catch(error => block(error.message || "PORTAL_BOOT_FAILED"));

async function bootstrap() {
  state.config = await loadConfig();
  elements.mode_label.textContent = state.config.mode.toUpperCase();
  state.memoryBudgetBytes = Number(state.config.prefetchMemoryBudgetMb || 64) * 1024 * 1024;
  if (state.config.mode === "google") await configureGoogleMode();
  else configureMockMode();
  state.manifest = await state.drive.loadManifest(state.config.manifestFileId);
  const manifestValidation = validateReviewManifest(state.manifest);
  if (!manifestValidation.ok) throw new Error(manifestValidation.code);
  elements.batch_name.textContent = state.manifest.batch_name || state.manifest.batch_id;
  if (manifestValidation.code === "REVIEW_BATCH_ABOVE_RECOMMENDED") {
    elements.blocking_banner.textContent = "권장 검토량 120개를 넘었습니다. 절대 상한 150개 안에서 운영자 승인을 확인해 주세요.";
    elements.blocking_banner.hidden = false;
  }
  state.events = await state.store.listEvents();
  state.current = latestEvents(state.events, { batchId: state.manifest.batch_id, revision: state.manifest.revision });
  populateSignerFilter();
  bindEvents();
  renderProgress();
  renderCandidateList();
  refreshQueueCount();
  const resumeId = state.session.lastCandidate(state.manifest.batch_id);
  const resumeIndex = state.manifest.candidates.findIndex(candidate => candidate.candidate_id === resumeId && !isFullyComplete(candidate));
  const pendingIndex = state.manifest.candidates.findIndex(candidate => candidateReviewState(state.current.get(candidate.candidate_id), candidate) === "NOT_REVIEWED");
  const preciseIndex = state.manifest.candidates.findIndex(candidate => candidateReviewState(state.current.get(candidate.candidate_id), candidate) === "PRECISE_REVIEW_REQUIRED");
  await openCandidate(resumeIndex >= 0 ? resumeIndex : pendingIndex >= 0 ? pendingIndex : Math.max(0, preciseIndex));
  elements.app.setAttribute("aria-busy", "false");
  window.addEventListener("online", flushQueue);
  window.addEventListener("beforeunload", event => {
    if (!state.dirty && Number(elements.sync_count.dataset.count || 0) === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function loadConfig() {
  const response = await fetch("/config.json", { cache: "no-store" });
  const config = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(config.code || "BLOCKED_PORTAL_CONFIG");
  if (!['google', 'mock'].includes(config.mode)) throw new Error("BLOCKED_PORTAL_CONFIG");
  if (config.mode === "google" && ["googleClientId", "allowedEmail", "driveFolderId", "manifestFileId", "spreadsheetId"].some(key => !config[key])) {
    throw new Error("BLOCKED_VERCEL_ENV");
  }
  return config;
}

function configureMockMode() {
  state.drive = new MockDriveAdapter();
  state.store = new MockReviewStore();
}

async function configureGoogleMode() {
  await loadGoogleIdentityScript();
  state.auth = new GoogleIdentityAuth(state.config.googleClientId, { allowedEmail: state.config.allowedEmail });
  state.drive = new GoogleDriveAdapter({ tokenProvider: () => state.auth.token() });
  state.store = new GoogleSheetsReviewStore({ spreadsheetId: state.config.spreadsheetId, sheetTab: state.config.sheetTab, tokenProvider: () => state.auth.token() });
  elements.google_connect.hidden = false;
  await new Promise(resolve => {
    elements.google_connect.addEventListener("click", async () => {
      elements.google_connect.disabled = true;
      elements.google_connect.textContent = "연결 중…";
      try {
        await state.auth.connect();
        elements.google_connect.textContent = "Google 연결됨";
        resolve();
      } catch (error) {
        elements.google_connect.disabled = false;
        elements.google_connect.textContent = "Google 다시 연결";
        const code = ["GOOGLE_ACCOUNT_NOT_AUTHORIZED", "BLOCKED_GOOGLE_AUTH", "BLOCKED_VERCEL_ENV"].includes(error.message)
          ? error.message
          : "BLOCKED_GOOGLE_AUTH";
        elements.blocking_banner.textContent = `${code}: 허용된 공동 Google 계정으로 다시 연결해 주세요.`;
        elements.blocking_banner.hidden = false;
      }
    });
  });
}

function loadGoogleIdentityScript() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("BLOCKED_GOOGLE_AUTH"));
    document.head.append(script);
  });
}

function bindEvents() {
  elements.candidate_search.addEventListener("input", renderCandidateList);
  elements.status_filter.addEventListener("change", renderCandidateList);
  elements.signer_filter.addEventListener("change", renderCandidateList);
  elements.previous_candidate.addEventListener("click", () => openCandidate(Math.max(0, state.candidateIndex - 1)));
  elements.next_pending.addEventListener("click", goToNextPending);
  elements.next_precise.addEventListener("click", goToNextPrecise);
  document.querySelectorAll("[data-step]").forEach(button => button.addEventListener("click", () => preciseAction(() => state.player.step(Number(button.dataset.step)))));
  elements.play_toggle.addEventListener("click", () => preciseAction(() => state.player.togglePlayback()));
  elements.play_annotation.addEventListener("click", () => playerAction(() => state.player.playSelection(currentCandidate().annotated_start_local_frame, currentCandidate().annotated_end_local_frame)));
  elements.play_review_window.addEventListener("click", () => playerAction(() => state.player.playSelection(0, currentCandidate().frame_count - 1)));
  elements.set_start.addEventListener("click", () => updateBoundary("start"));
  elements.set_end.addEventListener("click", () => updateBoundary("end"));
  elements.play_selection.addEventListener("click", () => preciseAction(() => state.player.playSelection(state.boundary.startFrame, state.boundary.endFrame)));
  elements.reset_boundaries.addEventListener("click", resetBoundaries);
  elements.precise_panel.addEventListener("toggle", () => {
    renderPreciseMode();
    if (elements.precise_panel.open) {
      recordInteraction();
      markDirty();
      saveDraft();
    }
  });
  state.player.addEventListener("framechange", event => renderFrame(event.detail));
  state.player.addEventListener("playstate", event => { elements.play_toggle.textContent = event.detail.playing ? "일시정지" : "재생"; });
  elements.quick_action.addEventListener("click", applyQuickAction);
  elements.review_form.addEventListener("input", event => {
    recordInteraction();
    applyAutomaticRules(event.target);
    markDirty();
    saveDraft();
    renderPreciseMode();
  });
  elements.review_form.addEventListener("submit", event => { event.preventDefault(); saveReview(true); });
  elements.save_only.addEventListener("click", () => saveReview(false));
  elements.hold_review.addEventListener("click", holdReview);
  document.addEventListener("keydown", handleKeyboard);
}

async function openCandidate(index) {
  if (!state.manifest?.candidates.length) return;
  if (state.dirty) saveDraft();
  const loadId = ++state.loadingId;
  state.player.cancelAction();
  state.candidateIndex = Math.max(0, Math.min(state.manifest.candidates.length - 1, index));
  const candidate = currentCandidate();
  state.session.saveLastCandidate(state.manifest.batch_id, candidate.candidate_id);
  state.verified = false;
  state.openedAt = performance.now();
  state.interactionCount = 0;
  elements.precise_panel.open = false;
  setControlsDisabled(true);
  setPill(elements.video_status, "영상 검증 중", "neutral");
  setPill(elements.frame_ready, "프레임 검증 중", "neutral");
  elements.video_loading.hidden = false;
  elements.blocking_banner.hidden = true;
  renderCandidateHeader();
  renderCandidateList();
  const draft = state.session.loadDraft(state.manifest.batch_id, state.manifest.revision, candidate.candidate_id);
  restoreForm(candidate, draft);
  state.boundary = new BoundaryController(candidate, draft?.boundaries || state.current.get(candidate.candidate_id));
  renderBoundaries();
  renderPreciseMode();
  try {
    const support = FramePlayer.browserSupport();
    if (!support.ok) throw new Error(support.code);
    const blob = await getClip(candidate);
    if (loadId !== state.loadingId) return;
    await state.player.load(candidate, blob);
    if (loadId !== state.loadingId) return;
    state.verified = true;
    setControlsDisabled(false);
    setPill(elements.video_status, "체크섬 확인", "good");
    setPill(elements.frame_ready, "FRAME_ACCURATE_READY", "good");
    elements.video_loading.hidden = true;
    prefetchNext();
  } catch (error) {
    if (loadId !== state.loadingId || error.message === "FRAME_ACTION_SUPERSEDED") return;
    blockCandidate(error.message || "VIDEO_DECODE_FAILED");
  }
}

function restoreForm(candidate, draft) {
  elements.review_form.reset();
  const saved = state.current.get(candidate.candidate_id);
  const source = draft?.form || saved || null;
  const value = source ? normalizeReviewInput(source, candidate) : null;
  if (value) {
    setRadio("target_validation", value.target_validation);
    setRadio("boundary_assessment", value.boundary_assessment);
    setRadio("learning_video_assessment", value.learning_video_assessment);
    setRadio("reference_assessment", value.reference_assessment);
    setRadio("excluded", value.excluded === null ? "HOLD" : String(value.excluded));
    elements.representative_fit.value = value.representative_fit || "";
    elements.sentence_effect.value = value.sentence_connection_effect || "";
    elements.exclusion_reason.value = value.exclusion_reason || "";
    elements.expert_notes.value = value.expert_notes || "";
    elements.reviewer_code.value = value.reviewer_code || localStorage.getItem("sign-review:reviewer-code") || "";
    state.interactionCount = Number(value.interaction_count || 0);
  } else {
    elements.reviewer_code.value = localStorage.getItem("sign-review:reviewer-code") || "";
  }
  state.dirty = Boolean(draft);
  elements.quick_summary.textContent = "아직 적용하지 않았습니다.";
  setPill(elements.save_status, saved ? stateLabel(candidateReviewState(saved, candidate)) : draft ? "로컬 초안" : "변경 없음", draft ? "warning" : saved ? "good" : "neutral");
  hideValidation();
}

function formValue(overrides = {}) {
  const data = new FormData(elements.review_form);
  return {
    reviewer_code: String(data.get("reviewer_code") || "").trim(),
    review_mode: elements.precise_panel.open ? "PRECISE" : "COARSE",
    target_validation: data.get("target_validation"),
    boundary_assessment: data.get("boundary_assessment"),
    learning_video_assessment: data.get("learning_video_assessment"),
    reference_assessment: data.get("reference_assessment"),
    representative_fit: data.get("representative_fit"),
    sentence_connection_effect: data.get("sentence_connection_effect"),
    excluded: data.get("excluded") === "HOLD" ? null : data.get("excluded") === "true",
    exclusion_reason: String(data.get("exclusion_reason") || ""),
    expert_notes: String(data.get("expert_notes") || ""),
    review_duration_ms: Math.round(Math.max(0, performance.now() - state.openedAt)),
    interaction_count: state.interactionCount,
    ...overrides
  };
}

async function saveReview(advance, overrides = {}) {
  if (!state.verified) return showValidation("프레임과 영상 검증이 완료되기 전에는 저장할 수 없습니다.");
  if (!elements.review_form.reportValidity()) return;
  const candidate = currentCandidate();
  const form = formValue(overrides);
  localStorage.setItem("sign-review:reviewer-code", form.reviewer_code);
  const snapshot = state.boundary.snapshot();
  const validation = validateReview({ ...form, ...snapshot, revision: state.manifest.revision, clip_sha256: candidate.clip_sha256 }, candidate, state.manifest);
  if (!validation.ok) return showValidation(`${validation.code}: ${validation.message}`, validation.field);
  hideValidation();
  setPill(elements.save_status, "저장 중", "neutral");
  const event = await createReviewEvent({ manifest: state.manifest, candidate, reviewerCode: form.reviewer_code, form, boundaries: snapshot });
  try {
    const retryKey = `sign-review:mock-failure:${state.manifest.batch_id}:${candidate.candidate_id}`;
    if (state.config.mode === "mock" && candidate.mock_case === "NETWORK_RETRY" && !sessionStorage.getItem(retryKey)) {
      state.store.failNextSave = true;
      sessionStorage.setItem(retryKey, "triggered");
    }
    await state.store.appendEvent(event);
    state.events.push(event);
    state.current.set(candidate.candidate_id, event);
    setPill(elements.save_status, stateLabel(event.review_state), "good");
    toast("검토 판정을 저장했습니다.");
  } catch {
    const pending = { ...event, save_status: "SYNC_PENDING" };
    await state.queue.enqueue(pending);
    state.events.push(pending);
    state.current.set(candidate.candidate_id, pending);
    setPill(elements.save_status, "로컬 저장됨, 동기화 대기", "warning");
    toast("네트워크 저장에 실패해 로컬 대기열에 보관했습니다.");
  }
  state.session.clearDraft(state.manifest.batch_id, state.manifest.revision, candidate.candidate_id);
  state.dirty = false;
  await refreshQueueCount();
  renderProgress();
  renderCandidateList();
  if (advance) await goToNextPending();
}

function holdReview() {
  if (!String(elements.expert_notes.value || "").trim()) return showValidation("보류 사유를 전문가 의견에 남겨 주세요.", "expert_notes");
  setRadio("target_validation", "TARGET_UNCERTAIN");
  setRadio("boundary_assessment", "BOUNDARY_AMBIGUOUS");
  setRadio("learning_video_assessment", "LEARNING_UNCERTAIN");
  setRadio("reference_assessment", "REFERENCE_UNCERTAIN");
  setRadio("excluded", "HOLD");
  elements.representative_fit.value = "REPRESENTATIVE_UNCERTAIN";
  elements.sentence_effect.value = "CONNECTION_UNCERTAIN";
  saveReview(false, { review_state: "REVIEW_ON_HOLD", excluded: null });
}

async function flushQueue() {
  const result = await state.queue.flush(state.store);
  await refreshQueueCount();
  if (result.synced) toast(`${result.synced}개 로컬 판정을 동기화했습니다.`);
}

function updateBoundary(side) {
  if (!state.verified || !elements.precise_panel.open) return;
  if (side === "start") state.boundary.setStart(state.player.currentFrame);
  else state.boundary.setEnd(state.player.currentFrame);
  recordInteraction();
  markDirty();
  renderBoundaries();
  saveDraft();
}

function resetBoundaries() {
  state.boundary.resetToAnnotation();
  recordInteraction();
  markDirty();
  renderBoundaries();
  saveDraft();
}

function saveDraft() {
  if (!state.manifest || !state.boundary || state.candidateIndex < 0) return;
  state.session.saveDraft(state.manifest.batch_id, state.manifest.revision, currentCandidate().candidate_id, { form: formValue(), boundaries: state.boundary.snapshot() });
}

function markDirty() {
  state.dirty = true;
  setPill(elements.save_status, "저장되지 않은 변경", "warning");
}

function recordInteraction() {
  state.interactionCount += 1;
}

function renderCandidateHeader() {
  const candidate = currentCandidate();
  elements.candidate_position.textContent = `후보 ${state.candidateIndex + 1} / ${state.manifest.candidates.length}`;
  elements.candidate_title.textContent = candidate.candidate_id;
  const flags = candidate.precise_review_required ? " · 운영자 정밀 지정" : candidate.representative_final_candidate ? " · 대표 최종 후보" : "";
  elements.candidate_meta.textContent = `signer ${candidate.signer_id} · archive ${candidate.source_archive_id} · ${state.manifest.revision}${flags}`;
  elements.frame_total.textContent = candidate.frame_count - 1;
  elements.annotation_summary.textContent = `frame ${candidate.annotated_start_local_frame} – ${candidate.annotated_end_local_frame}`;
}

function renderBoundaries() {
  if (!state.boundary) return;
  const candidate = currentCandidate();
  const snapshot = state.boundary.snapshot();
  elements.approved_summary.textContent = `frame ${snapshot.manual_start_local_frame} – ${snapshot.manual_end_local_frame} · source ${snapshot.manual_start_source_sec.toFixed(3)} – ${snapshot.manual_end_source_sec.toFixed(3)} s`;
  positionRange(elements.annotation_range, candidate.annotated_start_local_frame, candidate.annotated_end_local_frame, candidate.frame_count);
  positionRange(elements.approved_range, snapshot.manual_start_local_frame, snapshot.manual_end_local_frame, candidate.frame_count);
}

function renderFrame(detail) {
  elements.current_frame.textContent = detail.frame;
  elements.local_time.textContent = detail.localTime.toFixed(3);
  elements.source_time.textContent = detail.sourceTime.toFixed(3);
  elements.playhead.style.left = `${framePercent(detail.frame, currentCandidate().frame_count)}%`;
}

function positionRange(element, start, end, count) {
  const left = framePercent(start, count);
  const right = framePercent(end, count);
  element.style.left = `${left}%`;
  element.style.width = `${Math.max(0.8, right - left)}%`;
}

function framePercent(frame, count) {
  return count <= 1 ? 0 : (frame / (count - 1)) * 100;
}

function renderProgress() {
  const progress = progressFor(state.manifest, state.current);
  const percent = progress.total ? Math.round(progress.coarseComplete / progress.total * 100) : 0;
  elements.progress_percent.textContent = `${percent}%`;
  elements.progress_bar.setAttribute("aria-valuenow", String(percent));
  elements.progress_bar.querySelector("span").style.width = `${percent}%`;
  elements.progress_summary.textContent = `전체 ${progress.total} · Coarse 완료 ${progress.coarseComplete} · 미완료 ${progress.pending} · 보류 ${progress.held}`;
  elements.progress_detail.textContent = `정밀 완료 ${progress.preciseComplete} · 정밀 대기 ${progress.precisePending}`;
}

function renderPreciseMode() {
  if (!state.manifest || state.candidateIndex < 0) return;
  const candidate = currentCandidate();
  const preview = normalizeReviewInput({ ...formValue(), ...(state.boundary?.snapshot() || {}) }, candidate);
  if (elements.precise_panel.open) setPill(elements.precise_mode_status, "PRECISE", "warning");
  else if (preview.precise_review_required) setPill(elements.precise_mode_status, "정밀 대기", "warning");
  else setPill(elements.precise_mode_status, "COARSE", "neutral");
}

function populateSignerFilter() {
  const signers = [...new Set(state.manifest.candidates.map(candidate => candidate.signer_id))].sort();
  for (const signer of signers) elements.signer_filter.add(new Option(signer, signer));
}

function renderCandidateList() {
  if (!state.manifest) return;
  const query = elements.candidate_search.value.trim().toLowerCase();
  const status = elements.status_filter.value;
  const signer = elements.signer_filter.value;
  elements.candidate_list.replaceChildren();
  state.manifest.candidates.forEach((candidate, index) => {
    const reviewState = candidateReviewState(state.current.get(candidate.candidate_id), candidate);
    const candidateStatus = statusClass(reviewState);
    if (query && !candidate.candidate_id.toLowerCase().includes(query)) return;
    if (status !== "all" && status !== candidateStatus) return;
    if (signer !== "all" && signer !== candidate.signer_id) return;
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-current", index === state.candidateIndex ? "true" : "false");
    button.innerHTML = `<span><strong>${escapeHtml(candidate.candidate_id)}</strong><small>signer ${escapeHtml(candidate.signer_id)}</small></span><span class="candidate-state candidate-state--${candidateStatus}">${escapeHtml(stateLabel(reviewState))}</span>`;
    button.addEventListener("click", () => openCandidate(index));
    item.append(button);
    elements.candidate_list.append(item);
  });
}

async function goToNextPending() {
  const found = findNext(candidate => candidateReviewState(state.current.get(candidate.candidate_id), candidate) === "NOT_REVIEWED");
  if (found >= 0) return openCandidate(found);
  toast("이 batch의 coarse 미완료 후보가 없습니다.");
}

async function goToNextPrecise() {
  const found = findNext(candidate => candidateReviewState(state.current.get(candidate.candidate_id), candidate) === "PRECISE_REVIEW_REQUIRED");
  if (found >= 0) return openCandidate(found);
  toast("정밀 검토 대기 후보가 없습니다.");
}

function findNext(predicate) {
  const candidates = state.manifest.candidates;
  for (let offset = 1; offset <= candidates.length; offset += 1) {
    const index = (state.candidateIndex + offset) % candidates.length;
    if (predicate(candidates[index])) return index;
  }
  return -1;
}

function isFullyComplete(candidate) {
  return ["COARSE_REVIEW_COMPLETE", "PRECISE_REVIEW_COMPLETE", "REJECTED"].includes(candidateReviewState(state.current.get(candidate.candidate_id), candidate));
}

async function getClip(candidate) {
  if (state.blobCache.has(candidate.candidate_id)) return state.blobCache.get(candidate.candidate_id).blob;
  const blob = await state.drive.loadClip(candidate);
  cacheBlob(candidate.candidate_id, blob);
  return blob;
}

async function prefetchNext() {
  const next = state.manifest.candidates[state.candidateIndex + 1];
  if (!next || state.blobCache.has(next.candidate_id) || state.cacheBytes >= state.memoryBudgetBytes) return;
  try {
    const blob = await state.drive.loadClip(next);
    if (state.cacheBytes + blob.size <= state.memoryBudgetBytes) cacheBlob(next.candidate_id, blob);
  } catch {
    // Prefetch failures do not block the current review.
  }
}

function cacheBlob(candidateId, blob) {
  state.blobCache.set(candidateId, { blob, bytes: blob.size });
  state.cacheBytes += blob.size;
  while (state.blobCache.size > 2) {
    const oldest = state.blobCache.keys().next().value;
    if (oldest === currentCandidate().candidate_id) break;
    state.cacheBytes -= state.blobCache.get(oldest).bytes;
    state.blobCache.delete(oldest);
  }
}

async function refreshQueueCount() {
  let count = 0;
  try { count = (await state.queue.list()).length; } catch { count = 0; }
  elements.sync_count.dataset.count = String(count);
  setPill(elements.sync_count, `동기화 대기 ${count}`, count ? "warning" : "neutral");
}

function handleKeyboard(event) {
  const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) || event.target.isContentEditable;
  if (event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    saveReview(true);
    return;
  }
  if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  const coarseShortcuts = {
    "1": ["target_validation", "TARGET_CONFIRMED"], "2": ["target_validation", "TARGET_MISMATCH"], "3": ["target_validation", "TARGET_UNCERTAIN"],
    k: ["boundary_assessment", "BOUNDARY_KEEP_ORIGINAL"], a: ["boundary_assessment", "BOUNDARY_START_TOO_EARLY"],
    d: ["boundary_assessment", "BOUNDARY_START_TOO_LATE"], z: ["boundary_assessment", "BOUNDARY_END_TOO_EARLY"],
    c: ["boundary_assessment", "BOUNDARY_END_TOO_LATE"], b: ["boundary_assessment", "BOUNDARY_BOTH_NEED_ADJUSTMENT"],
    u: ["boundary_assessment", "BOUNDARY_AMBIGUOUS"], x: ["boundary_assessment", "BOUNDARY_UNUSABLE"],
    l: ["learning_video_assessment", "LEARNING_ALLOWED"], r: ["reference_assessment", "REFERENCE_ALLOWED"]
  };
  if (coarseShortcuts[key]) {
    const [name, value] = coarseShortcuts[key];
    setRadio(name, value);
    applyAutomaticRules(elements.review_form.querySelector(`input[name="${name}"]:checked`));
    recordInteraction();
    markDirty();
    saveDraft();
    renderPreciseMode();
    event.preventDefault();
    return;
  }
  if (key === "arrowleft" && elements.precise_panel.open) preciseAction(() => state.player.step(event.shiftKey ? -5 : -1));
  else if (key === "arrowright" && elements.precise_panel.open) preciseAction(() => state.player.step(event.shiftKey ? 5 : 1));
  else if (key === " ") playerAction(() => state.player.togglePlayback());
  else if (key === "s" && elements.precise_panel.open) updateBoundary("start");
  else if (key === "e" && elements.precise_panel.open) updateBoundary("end");
  else return;
  event.preventDefault();
}

function applyQuickAction() {
  setRadio("target_validation", "TARGET_CONFIRMED");
  setRadio("boundary_assessment", "BOUNDARY_KEEP_ORIGINAL");
  setRadio("reference_assessment", "REFERENCE_ALLOWED");
  setRadio("excluded", "false");
  state.boundary.resetToAnnotation();
  elements.quick_summary.textContent = "적용됨: [좋다1] 확인 · 기존 경계 적절 · reference 가능 · 후보 유지. 학습 영상, 대표 적합도, 연결 영향은 별도로 선택하세요.";
  recordInteraction();
  markDirty();
  renderBoundaries();
  renderPreciseMode();
  saveDraft();
}

function applyAutomaticRules(target) {
  if (!target?.name) return;
  if (target.name === "target_validation" && target.value === "TARGET_MISMATCH") {
    setRadio("learning_video_assessment", "LEARNING_NOT_ALLOWED");
    setRadio("reference_assessment", "REFERENCE_NOT_ALLOWED");
    setRadio("excluded", "true");
    elements.representative_fit.value = "REPRESENTATIVE_UNSUITABLE";
    elements.exclusion_reason.value = "다른 gloss";
  }
  if (target.name === "boundary_assessment" && target.value === "BOUNDARY_UNUSABLE") {
    setRadio("learning_video_assessment", "LEARNING_NOT_ALLOWED");
    setRadio("reference_assessment", "REFERENCE_NOT_ALLOWED");
    setRadio("excluded", "true");
    elements.representative_fit.value = "REPRESENTATIVE_UNSUITABLE";
    elements.exclusion_reason.value = "경계 판단 불가";
  }
  if (target.name === "excluded" && target.value === "true") {
    setRadio("learning_video_assessment", "LEARNING_NOT_ALLOWED");
    setRadio("reference_assessment", "REFERENCE_NOT_ALLOWED");
  }
}

async function playerAction(action) {
  if (state.playerActionPromise) return state.playerActionPromise;
  const candidateId = currentCandidate()?.candidate_id;
  setPlayerControlsBusy(true);
  const promise = Promise.resolve()
    .then(action)
    .catch(error => {
      if (error.message !== "FRAME_ACTION_SUPERSEDED") {
        blockCandidate(error.message || "FRAME_SEEK_UNVERIFIED");
      }
    })
    .finally(() => {
      if (state.playerActionPromise !== promise) return;
      state.playerActionPromise = null;
      if (state.verified && currentCandidate()?.candidate_id === candidateId) setPlayerControlsBusy(false);
    });
  state.playerActionPromise = promise;
  return promise;
}

async function preciseAction(action) {
  if (!elements.precise_panel.open) return;
  recordInteraction();
  await playerAction(action);
}

function setControlsDisabled(disabled) {
  document.querySelectorAll(".frame-controls button, .boundary-actions button, .coarse-playback button, .save-actions button").forEach(button => { button.disabled = disabled; });
}

function setPlayerControlsBusy(busy) {
  elements.review_video.setAttribute("aria-busy", String(busy));
  document.querySelectorAll(".frame-controls button, .boundary-actions button, .coarse-playback button").forEach(button => {
    button.disabled = busy || !state.verified;
  });
}

function setRadio(name, value) {
  if (value === undefined || value === null) return;
  const input = elements.review_form.querySelector(`input[name="${name}"][value="${CSS.escape(String(value))}"]`);
  if (input) input.checked = true;
}

function showValidation(message, field) {
  elements.validation_message.textContent = message;
  elements.validation_message.hidden = false;
  setPill(elements.save_status, "저장 차단", "danger");
  if (field) elements.review_form.querySelector(`[name="${CSS.escape(field)}"]`)?.focus();
}

function hideValidation() {
  elements.validation_message.hidden = true;
  elements.validation_message.textContent = "";
}

function blockCandidate(code) {
  state.verified = false;
  setControlsDisabled(true);
  setPill(elements.video_status, code, "danger");
  setPill(elements.frame_ready, "FRAME_ACCURATE_READY=false", "danger");
  elements.video_loading.textContent = `저장 차단: ${code}`;
  elements.video_loading.hidden = false;
  elements.blocking_banner.textContent = `${code}: 영상 또는 프레임 정확성을 확인할 수 없어 이 후보의 저장을 차단했습니다.`;
  elements.blocking_banner.hidden = false;
}

function block(code) {
  elements.app.setAttribute("aria-busy", "false");
  elements.blocking_banner.textContent = `${code}: 포털을 시작할 수 없습니다.`;
  elements.blocking_banner.hidden = false;
  setControlsDisabled(true);
}

function setPill(element, text, tone) {
  element.textContent = text;
  element.className = `status-pill status-pill--${tone}`;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => { elements.toast.hidden = true; }, 4000);
}

function currentCandidate() {
  return state.manifest.candidates[state.candidateIndex];
}

function stateLabel(value) {
  return ({
    NOT_REVIEWED: "미완료", COARSE_REVIEW_COMPLETE: "Coarse 완료", PRECISE_REVIEW_REQUIRED: "정밀 대기",
    PRECISE_REVIEW_COMPLETE: "정밀 완료", REVIEW_ON_HOLD: "보류", REJECTED: "제외"
  })[value] || value;
}

function statusClass(value) {
  if (value === "PRECISE_REVIEW_REQUIRED") return "precise";
  if (value === "REVIEW_ON_HOLD") return "held";
  if (value === "REJECTED") return "rejected";
  if (["COARSE_REVIEW_COMPLETE", "PRECISE_REVIEW_COMPLETE"].includes(value)) return "complete";
  return "pending";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" }[character]));
}
