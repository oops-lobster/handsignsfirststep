import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertAllowedGoogleAccount, validDriveFileId } from "../../server/googleAccess.js";
import { reviewRuntimeConfig, validateRuntimeConfig } from "../../server/runtimeConfig.js";
import configHandler from "../../api/config.js";
import driveHandler from "../../api/google-drive.js";

function mockResponse() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; }
  };
}

function withEnvironment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("server-side Drive gate requires the allowlisted verified email", async () => {
  const allowed = await assertAllowedGoogleAccount("Bearer short-lived-token", "review@example.test", async () => ({
    ok: true,
    async json() { return { email: "review@example.test", email_verified: true }; }
  }));
  assert.equal(allowed, "review@example.test");

  await assert.rejects(
    assertAllowedGoogleAccount("Bearer short-lived-token", "review@example.test", async () => ({
      ok: true,
      async json() { return { email: "other@example.test", email_verified: true }; }
    })),
    /GOOGLE_ACCOUNT_NOT_AUTHORIZED/
  );
  assert.equal(validDriveFileId("safe_Drive-file-id_123"), true);
  assert.equal(validDriveFileId("../unsafe"), false);
});

test("production Google config fails closed when any required value is absent", () => {
  const complete = reviewRuntimeConfig({
    REVIEW_DATA_MODE: "google",
    REVIEW_GOOGLE_CLIENT_ID: "client",
    REVIEW_ALLOWED_EMAIL: "review@example.test",
    REVIEW_DRIVE_FOLDER_ID: "folder",
    REVIEW_MANIFEST_FILE_ID: "manifest",
    REVIEW_SPREADSHEET_ID: "sheet",
    REVIEW_SHEET_TAB: "review_events",
    REVIEW_PREFETCH_MEMORY_MB: "64"
  });
  assert.equal(validateRuntimeConfig(complete).ok, true);
  assert.deepEqual(validateRuntimeConfig({ ...complete, manifestFileId: "" }), { ok: false, code: "BLOCKED_VERCEL_ENV" });
});

test("Vercel config function publishes only validated browser configuration", t => {
  withEnvironment(t, {
    REVIEW_DATA_MODE: "google",
    REVIEW_GOOGLE_CLIENT_ID: "public-client",
    REVIEW_ALLOWED_EMAIL: "review@example.test",
    REVIEW_DRIVE_FOLDER_ID: "restricted-folder",
    REVIEW_MANIFEST_FILE_ID: "restricted-manifest",
    REVIEW_SPREADSHEET_ID: "restricted-sheet",
    REVIEW_SHEET_TAB: "review_events",
    REVIEW_PREFETCH_MEMORY_MB: "64"
  });
  const response = mockResponse();
  configHandler({ method: "GET" }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.mode, "google");
  assert.equal(response.body.allowedEmail, "review@example.test");
  assert.equal(Object.hasOwn(response.body, "clientSecret"), false);
  assert.equal(response.headers["cache-control"], "no-store");
});

test("Vercel Drive function verifies email before proxying restricted media", async t => {
  withEnvironment(t, { REVIEW_ALLOWED_EMAIL: "review@example.test" });
  const originalFetch = globalThis.fetch;
  let driveFetches = 0;
  globalThis.fetch = async url => {
    if (String(url).includes("userinfo")) {
      return { ok: true, async json() { return { email: "review@example.test", email_verified: true }; } };
    }
    driveFetches += 1;
    return {
      ok: true,
      headers: new Headers({ "content-type": "video/mp4", "content-length": "4" }),
      async arrayBuffer() { return Uint8Array.from([0, 1, 2, 3]).buffer; }
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = mockResponse();
  await driveHandler({ method: "GET", query: { fileId: "safe_Drive-file-id_123" }, headers: { authorization: "Bearer memory-token" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(driveFetches, 1);
  assert.equal(response.body.byteLength, 4);
  assert.equal(response.headers["content-type"], "video/mp4");
});

test("Vercel build output contains only allowlisted static portal assets", async () => {
  const toolRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
  const result = spawnSync(process.execPath, [resolve(toolRoot, "scripts/build-vercel.mjs")], { cwd: toolRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const dist = resolve(toolRoot, "dist");
  const entries = await readdir(dist, { recursive: true, withFileTypes: true });
  const files = entries.filter(entry => entry.isFile()).map(entry => entry.name);
  assert.ok(files.includes("index.html"));
  assert.equal(files.some(name => [".mp4", ".zip", ".json"].includes(extname(name))), false);
});
