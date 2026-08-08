import { applyHeaders } from "../server/securityHeaders.js";
import { assertAllowedGoogleAccount, bearerAuthorization, validDriveFileId } from "../server/googleAccess.js";

const MAX_DRIVE_ASSET_BYTES = 20 * 1024 * 1024;

function fail(response, status, code) {
  applyHeaders(response, { "content-type": "application/json; charset=utf-8" });
  response.status(status).json({ code });
}

export default async function handler(request, response) {
  if (request.method !== "GET") return fail(response, 405, "METHOD_NOT_ALLOWED");
  const fileId = String(request.query?.fileId || "");
  if (!validDriveFileId(fileId)) return fail(response, 400, "INVALID_DRIVE_FILE_ID");

  try {
    const authorization = bearerAuthorization(request.headers.authorization);
    await assertAllowedGoogleAccount(authorization, process.env.REVIEW_ALLOWED_EMAIL);
    const upstream = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: authorization },
      cache: "no-store"
    });
    if (!upstream.ok) {
      const status = [401, 403, 404].includes(upstream.status) ? upstream.status : 502;
      return fail(response, status, status === 502 ? "DRIVE_FILE_LOAD_FAILED" : "GOOGLE_ACCOUNT_NOT_AUTHORIZED");
    }
    const declaredSize = Number(upstream.headers.get("content-length") || 0);
    if (declaredSize > MAX_DRIVE_ASSET_BYTES) return fail(response, 413, "DRIVE_FILE_TOO_LARGE");
    const content = Buffer.from(await upstream.arrayBuffer());
    if (content.byteLength > MAX_DRIVE_ASSET_BYTES) return fail(response, 413, "DRIVE_FILE_TOO_LARGE");
    applyHeaders(response, {
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      "content-length": String(content.byteLength)
    });
    response.status(200).send(content);
  } catch (error) {
    const code = ["BLOCKED_GOOGLE_AUTH", "GOOGLE_ACCOUNT_NOT_AUTHORIZED", "BLOCKED_VERCEL_ENV"].includes(error.message)
      ? error.message
      : "DRIVE_FILE_LOAD_FAILED";
    const status = code === "BLOCKED_VERCEL_ENV" ? 503 : code === "DRIVE_FILE_LOAD_FAILED" ? 502 : 403;
    return fail(response, status, code);
  }
}
