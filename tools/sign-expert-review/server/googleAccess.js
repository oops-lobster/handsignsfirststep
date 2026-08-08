const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export function bearerAuthorization(value = "") {
  const authorization = String(value || "");
  if (!authorization.startsWith("Bearer ") || authorization.length <= 7) throw new Error("BLOCKED_GOOGLE_AUTH");
  return authorization;
}

export function validDriveFileId(fileId = "") {
  return /^[A-Za-z0-9_-]{10,200}$/.test(String(fileId));
}

export async function assertAllowedGoogleAccount(authorization, allowedEmail, fetchImpl = (...args) => fetch(...args)) {
  const bearer = bearerAuthorization(authorization);
  const expected = String(allowedEmail || "").trim().toLowerCase();
  if (!expected) throw new Error("BLOCKED_VERCEL_ENV");
  const response = await fetchImpl(USERINFO_URL, {
    headers: { Authorization: bearer },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("BLOCKED_GOOGLE_AUTH");
  const profile = await response.json();
  const actual = String(profile.email || "").trim().toLowerCase();
  if (!profile.email_verified || actual !== expected) throw new Error("GOOGLE_ACCOUNT_NOT_AUTHORIZED");
  return actual;
}
