import test from "node:test";
import assert from "node:assert/strict";
import { GoogleIdentityAuth } from "../src/auth/googleIdentity.js";

function installGoogleMock(t, tokenResponse = { access_token: "memory-only-token", expires_in: 3600 }) {
  const previous = globalThis.google;
  let options;
  const revoked = [];
  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient(value) {
          options = value;
          return { requestAccessToken: () => queueMicrotask(() => options.callback(tokenResponse)) };
        },
        revoke(token) { revoked.push(token); }
      }
    }
  };
  t.after(() => { globalThis.google = previous; });
  return { options: () => options, revoked };
}

test("Google auth verifies the configured shared account before exposing a token", async t => {
  const googleMock = installGoogleMock(t);
  const auth = new GoogleIdentityAuth("public-web-client-id", {
    allowedEmail: "review@example.test",
    fetchImpl: async () => ({
      ok: true,
      async json() { return { email: "review@example.test", email_verified: true }; }
    })
  });

  assert.equal(await auth.connect(), "memory-only-token");
  assert.equal(await auth.token(), "memory-only-token");
  assert.equal(auth.accountEmail, "review@example.test");
  assert.match(googleMock.options().scope, /\bopenid\b/);
  assert.match(googleMock.options().scope, /\bemail\b/);
  auth.disconnect();
  assert.deepEqual(googleMock.revoked, ["memory-only-token"]);
});

test("Google auth revokes a token from a non-allowlisted account", async t => {
  const googleMock = installGoogleMock(t);
  const auth = new GoogleIdentityAuth("public-web-client-id", {
    allowedEmail: "review@example.test",
    fetchImpl: async () => ({
      ok: true,
      async json() { return { email: "other@example.test", email_verified: true }; }
    })
  });

  await assert.rejects(auth.connect(), /GOOGLE_ACCOUNT_NOT_AUTHORIZED/);
  await assert.rejects(auth.token(), /BLOCKED_GOOGLE_AUTH/);
  assert.deepEqual(googleMock.revoked, ["memory-only-token"]);
});
