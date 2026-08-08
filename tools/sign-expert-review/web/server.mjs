import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertAllowedGoogleAccount, validDriveFileId } from "../server/googleAccess.js";
import { reviewRuntimeConfig, validateRuntimeConfig } from "../server/runtimeConfig.js";
import { SECURITY_HEADERS } from "../server/securityHeaders.js";

const webRoot = resolve(fileURLToPath(new URL("./", import.meta.url)));
const toolRoot = resolve(webRoot, "..");
const fixtureRoot = join(toolRoot, "fixtures");
const port = Number(process.env.REVIEW_PORT || 4311);
const host = process.env.REVIEW_HOST || "127.0.0.1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml"
};

const maxDriveAssetBytes = 20 * 1024 * 1024;

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function safeFile(root, pathname) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("PATH_NOT_ALLOWED");
  return target;
}

async function serveFile(response, path) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error("NOT_FOUND");
  const content = await readFile(path);
  response.writeHead(200, { ...SECURITY_HEADERS, "content-type": mimeTypes[extname(path)] || "application/octet-stream" });
  response.end(content);
}

async function proxyDriveFile(request, response, fileId) {
  if (!validDriveFileId(fileId)) return sendJson(response, 400, { code: "INVALID_DRIVE_FILE_ID" });
  const authorization = String(request.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return sendJson(response, 401, { code: "BLOCKED_GOOGLE_AUTH" });
  try {
    await assertAllowedGoogleAccount(authorization, process.env.REVIEW_ALLOWED_EMAIL);
  } catch (error) {
    const code = error.message === "BLOCKED_VERCEL_ENV" ? error.message : "GOOGLE_ACCOUNT_NOT_AUTHORIZED";
    return sendJson(response, code === "BLOCKED_VERCEL_ENV" ? 503 : 403, { code });
  }
  const upstream = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: authorization },
    cache: "no-store"
  });
  if (!upstream.ok) {
    const status = [401, 403, 404].includes(upstream.status) ? upstream.status : 502;
    return sendJson(response, status, { code: status === 502 ? "DRIVE_FILE_LOAD_FAILED" : "GOOGLE_ACCOUNT_NOT_AUTHORIZED" });
  }
  const declaredSize = Number(upstream.headers.get("content-length") || 0);
  if (declaredSize > maxDriveAssetBytes) return sendJson(response, 413, { code: "DRIVE_FILE_TOO_LARGE" });
  const content = Buffer.from(await upstream.arrayBuffer());
  if (content.byteLength > maxDriveAssetBytes) return sendJson(response, 413, { code: "DRIVE_FILE_TOO_LARGE" });
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": upstream.headers.get("content-type") || "application/octet-stream",
    "content-length": String(content.byteLength)
  });
  response.end(content);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { code: "METHOD_NOT_ALLOWED" });
    if (url.pathname === "/config.json") {
      const config = reviewRuntimeConfig();
      const validation = validateRuntimeConfig(config);
      return sendJson(response, validation.ok ? 200 : 503, validation.ok ? config : { code: validation.code });
    }
    if (url.pathname.startsWith("/google-drive/files/")) {
      const fileId = decodeURIComponent(url.pathname.slice("/google-drive/files/".length));
      return await proxyDriveFile(request, response, fileId);
    }
    if (url.pathname.startsWith("/fixtures/")) {
      return await serveFile(response, safeFile(fixtureRoot, url.pathname.replace("/fixtures/", "")));
    }
    const requested = url.pathname === "/" ? "index.html" : url.pathname;
    return await serveFile(response, safeFile(webRoot, requested));
  } catch (error) {
    if (error.code === "ENOENT" || error.message === "NOT_FOUND") return sendJson(response, 404, { code: "NOT_FOUND" });
    return sendJson(response, 500, { code: "REVIEW_SERVER_ERROR" });
  }
});

server.listen(port, host, () => {
  console.log(`Expert review portal (${process.env.REVIEW_DATA_MODE || "mock"}) at http://${host}:${port}`);
});

export { server };
