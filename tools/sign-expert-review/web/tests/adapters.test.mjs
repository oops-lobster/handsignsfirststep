import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { GoogleDriveAdapter } from "../src/adapters/googleDriveAdapter.js";
import { MockDriveAdapter } from "../src/adapters/mockDriveAdapter.js";

globalThis.crypto ||= webcrypto;

const blob = new Blob(["synthetic"]);
const checksum = "b3cc0475bb78a5026098858e9889acf666d31062d513d303314eca31d36e72f2";

test("mock Drive validates downloaded blob checksum", async () => {
  const adapter = new MockDriveAdapter({ fetchImpl: async () => new Response(blob, { status: 200 }) });
  const loaded = await adapter.loadClip({ clip_sha256: checksum });
  assert.equal(await loaded.text(), "synthetic");
  await assert.rejects(adapter.loadClip({ clip_sha256: "0".repeat(64) }), /CLIP_CHECKSUM_MISMATCH/);
});

test("Google Drive uses the restricted local proxy and maps unauthorized access", async () => {
  let request;
  const adapter = new GoogleDriveAdapter({
    tokenProvider: async () => "memory-token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(blob, { status: 200 });
    }
  });
  await adapter.loadClip({ drive_file_id: "restricted-id", clip_sha256: checksum });
  assert.equal(request.url, "/google-drive/files/restricted-id");
  assert.equal(request.options.headers.Authorization, "Bearer memory-token");
  const denied = new GoogleDriveAdapter({ tokenProvider: async () => "token", fetchImpl: async () => new Response("", { status: 403 }) });
  await assert.rejects(denied.loadManifest("denied"), /GOOGLE_ACCOUNT_NOT_AUTHORIZED/);
});
