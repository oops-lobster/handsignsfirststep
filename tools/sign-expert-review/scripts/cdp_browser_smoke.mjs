/** Real-Chrome coarse/precise smoke test. Start Chrome with a loopback CDP port first. */
import { writeFile } from "node:fs/promises";

const endpoint = process.env.REVIEW_CDP_ENDPOINT || "http://127.0.0.1:9223";
const viewportWidth = Number(process.env.REVIEW_CDP_WIDTH || 1200);
const viewportHeight = Number(process.env.REVIEW_CDP_HEIGHT || 900);
const screenshotPath = process.env.REVIEW_CDP_SCREENSHOT || "";
if (typeof WebSocket !== "function") throw new Error("This smoke test requires a Node runtime with global WebSocket support.");

const targets = await fetch(`${endpoint}/json`).then(response => response.json());
const target = targets.find(item => item.type === "page" && item.url.startsWith("http://127.0.0.1:4311"));
if (!target) throw new Error("Review portal CDP target not found.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
const consoleErrors = [];

socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || "Runtime exception");
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") consoleErrors.push(message.params.args?.map(item => item.value || item.description).join(" ") || "console.error");
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
  return result.result.value;
}

async function waitFor(expression, timeoutMs = 8000) {
  return evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      try {
        const value = (${expression});
        if (value) { clearInterval(timer); resolve(value); }
        else if (Date.now() - started > ${timeoutMs}) { clearInterval(timer); reject(new Error("BROWSER_WAIT_TIMEOUT")); }
      } catch (error) { clearInterval(timer); reject(error); }
    }, 80);
  })`);
}

async function key(key, code) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
}

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: viewportWidth <= 760 });
if (process.env.REVIEW_CDP_CAPTURE_ONLY === "1" && screenshotPath) {
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  console.log(JSON.stringify({ status: "BROWSER_SCREENSHOT_CAPTURED", screenshotPath, viewportWidth, viewportHeight }));
  socket.close();
  process.exit(0);
}
try {
  await waitFor(`document.getElementById("app")?.getAttribute("aria-busy") === "false" && document.getElementById("frame-ready")?.textContent === "FRAME_ACCURATE_READY"`);
} catch (error) {
  const diagnosis = await evaluate(`(() => ({
    busy: document.getElementById("app")?.getAttribute("aria-busy"),
    frameReady: document.getElementById("frame-ready")?.textContent,
    blocking: document.getElementById("blocking-banner")?.textContent,
    body: document.body.innerText.slice(0, 1200)
  }))()`);
  console.log(JSON.stringify({ status: "BROWSER_BOOT_FAILED", diagnosis, consoleErrors }, null, 2));
  throw error;
}

const initial = await evaluate(`(() => ({
  frameReady: document.getElementById("frame-ready").textContent,
  currentFrame: document.getElementById("current-frame").textContent,
  candidate: document.getElementById("candidate-title").textContent,
  batch: document.getElementById("batch-name").textContent,
  candidateCount: document.querySelectorAll("#candidate-list li").length,
  preciseOpen: document.getElementById("precise-panel").open,
  saveEnabled: !document.getElementById("save-only").disabled,
  loadingHidden: document.getElementById("video-loading").hidden,
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  viewport: {width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth},
  blockingMessage: document.getElementById("blocking-banner").hidden ? "" : document.getElementById("blocking-banner").textContent
}))()`);

await evaluate(`(() => {
  const setValue = (selector, value) => { const element = document.querySelector(selector); element.value = value; element.dispatchEvent(new Event("input", {bubbles:true})); element.dispatchEvent(new Event("change", {bubbles:true})); };
  setValue("#reviewer-code", "BROWSER-R1");
  document.getElementById("quick-action").click();
  document.querySelector('input[name="learning_video_assessment"][value="LEARNING_ALLOWED"]').click();
  setValue("#representative-fit", "REPRESENTATIVE_MEDIUM");
  setValue("#sentence-effect", "CONNECTION_NONE");
})()`);
const quickAction = await evaluate(`(() => ({
  target: document.querySelector('input[name="target_validation"]:checked')?.value,
  boundary: document.querySelector('input[name="boundary_assessment"]:checked')?.value,
  reference: document.querySelector('input[name="reference_assessment"]:checked')?.value,
  summary: document.getElementById("quick-summary").textContent
}))()`);
await evaluate(`document.getElementById("save-only").click()`);
await waitFor(`document.getElementById("save-status").textContent === "Coarse 완료"`);
const coarseSave = await evaluate(`(() => ({
  status: document.getElementById("save-status").textContent,
  preciseOpen: document.getElementById("precise-panel").open,
  eventCount: JSON.parse(localStorage.getItem("sign-review:mock-events") || "[]").length
}))()`);

await evaluate(`document.getElementById("next-pending").click()`);
await waitFor(`document.getElementById("candidate-title").textContent === "GOOD1_MOCK_MODIFY" && document.getElementById("frame-ready").textContent === "FRAME_ACCURATE_READY"`);
await evaluate(`(() => {
  const setValue = (selector, value) => { const element = document.querySelector(selector); element.value = value; element.dispatchEvent(new Event("input", {bubbles:true})); element.dispatchEvent(new Event("change", {bubbles:true})); };
  document.querySelector('input[name="target_validation"][value="TARGET_CONFIRMED"]').click();
  document.querySelector('input[name="boundary_assessment"][value="BOUNDARY_START_TOO_EARLY"]').click();
  document.querySelector('input[name="learning_video_assessment"][value="LEARNING_ALLOWED"]').click();
  document.querySelector('input[name="reference_assessment"][value="REFERENCE_NOT_ALLOWED"]').click();
  document.querySelector('input[name="excluded"][value="false"]').click();
  setValue("#representative-fit", "REPRESENTATIVE_MEDIUM");
  setValue("#sentence-effect", "CONNECTION_MINOR");
  setValue("#expert-notes", "정밀 시작 경계 확인 필요");
})()`);
await evaluate(`document.getElementById("save-only").click()`);
await waitFor(`document.getElementById("save-status").textContent === "정밀 대기"`);
const precisePending = await evaluate(`(() => ({
  status: document.getElementById("save-status").textContent,
  preciseOpen: document.getElementById("precise-panel").open,
  eventCount: JSON.parse(localStorage.getItem("sign-review:mock-events") || "[]").length
}))()`);

await evaluate(`document.getElementById("precise-panel").open = true`);
await waitFor(`document.getElementById("precise-panel").open && document.getElementById("precise-mode-status").textContent === "PRECISE"`);
await evaluate(`document.querySelector('button[data-step="1"]').click()`);
await waitFor(`document.getElementById("current-frame").textContent === "10"`);
await evaluate(`document.getElementById("set-start").click()`);
await evaluate(`document.getElementById("save-only").click()`);
await waitFor(`document.getElementById("save-status").textContent === "정밀 완료"`);
const preciseComplete = await evaluate(`(() => ({
  status: document.getElementById("save-status").textContent,
  currentFrame: document.getElementById("current-frame").textContent,
  boundary: document.getElementById("approved-summary").textContent,
  eventCount: JSON.parse(localStorage.getItem("sign-review:mock-events") || "[]").length
}))()`);

await evaluate(`document.getElementById("next-pending").click()`);
await waitFor(`document.getElementById("candidate-title").textContent === "GOOD1_MOCK_MISMATCH" && document.getElementById("frame-ready").textContent === "FRAME_ACCURATE_READY"`);
await key("2", "Digit2");
const mismatchAutomation = await evaluate(`(() => ({
  target: document.querySelector('input[name="target_validation"]:checked')?.value,
  learning: document.querySelector('input[name="learning_video_assessment"]:checked')?.value,
  reference: document.querySelector('input[name="reference_assessment"]:checked')?.value,
  representative: document.getElementById("representative-fit").value,
  excluded: document.querySelector('input[name="excluded"]:checked')?.value,
  reason: document.getElementById("exclusion-reason").value
}))()`);

const layout = await evaluate(`(() => ({
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  viewport: {width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth},
  preciseDefaultCollapsedOnNavigation: !document.getElementById("precise-panel").open,
  bodyHasContent: document.body.innerText.trim().length > 500,
  errorOverlay: Boolean(document.querySelector("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay"))
}))()`);

const passed = initial.frameReady === "FRAME_ACCURATE_READY" && initial.currentFrame === "9" && initial.candidateCount === 5 &&
  !initial.preciseOpen && initial.saveEnabled && initial.loadingHidden && !initial.horizontalOverflow && !initial.blockingMessage &&
  quickAction.target === "TARGET_CONFIRMED" && quickAction.boundary === "BOUNDARY_KEEP_ORIGINAL" && quickAction.reference === "REFERENCE_ALLOWED" &&
  coarseSave.status === "Coarse 완료" && coarseSave.eventCount === 1 && !coarseSave.preciseOpen &&
  precisePending.status === "정밀 대기" && precisePending.eventCount === 2 && !precisePending.preciseOpen &&
  preciseComplete.status === "정밀 완료" && preciseComplete.currentFrame === "10" && preciseComplete.boundary.includes("frame 10 – 15") && preciseComplete.eventCount === 3 &&
  mismatchAutomation.target === "TARGET_MISMATCH" && mismatchAutomation.learning === "LEARNING_NOT_ALLOWED" &&
  mismatchAutomation.reference === "REFERENCE_NOT_ALLOWED" && mismatchAutomation.representative === "REPRESENTATIVE_UNSUITABLE" &&
  mismatchAutomation.excluded === "true" && mismatchAutomation.reason === "다른 gloss" &&
  !layout.horizontalOverflow && layout.preciseDefaultCollapsedOnNavigation && layout.bodyHasContent && !layout.errorOverlay && consoleErrors.length === 0;

if (screenshotPath) {
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
}
console.log(JSON.stringify({ status: passed ? "BROWSER_SMOKE_PASSED" : "BROWSER_SMOKE_FAILED", initial, quickAction, coarseSave, precisePending, preciseComplete, mismatchAutomation, layout, consoleErrors }, null, 2));
socket.close();
if (!passed) process.exit(2);
