import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { SignDictionaryAdapter } from "./src/sign-dictionary/adapter.js";
import { getCached, setCached } from "./src/sign-dictionary/cache.js";
import { fingerspellingLessons, findLesson } from "./src/data/fingerspelling/curriculum.js";

const rootDir = process.cwd();
const publicDir = join(rootDir, "public");
const mediaPipeDir = join(rootDir, "node_modules", "@mediapipe", "tasks-vision");
await loadEnv(join(rootDir, ".env"));

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const adapter = new SignDictionaryAdapter();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".task": "application/octet-stream",
  ".wasm": "application/wasm"
};

function cacheControlFor(path) {
  const extension = extname(path);
  if ([".html", ".js", ".mjs", ".css"].includes(extension)) return "no-store";
  return "public, max-age=3600";
}

async function loadEnv(path) {
  try {
    const text = await readFile(path, "utf8");
    text.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const index = trimmed.indexOf("=");
      if (index === -1) return;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (key && process.env[key] == null) process.env[key] = value;
    });
  } catch {
    // .env is optional.
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function safePath(pathname) {
  if (pathname.startsWith("/vendor/mediapipe/")) {
    const relativePath = pathname.replace("/vendor/mediapipe/", "");
    const normalizedVendor = normalize(decodeURIComponent(relativePath)).replace(/^(\.\.[/\\])+/, "");
    return join(mediaPipeDir, normalizedVendor);
  }
  if (pathname.startsWith("/src/")) {
    const normalizedSrc = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
    return join(rootDir, normalizedSrc);
  }
  const normalized = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  return join(publicDir, normalized === "/" ? "index.html" : normalized);
}

async function serveStatic(req, res, url) {
  const path = safePath(url.pathname);
  try {
    const file = await readFile(path);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(path)] || "application/octet-stream",
      "cache-control": cacheControlFor(path)
    });
    res.end(file);
  } catch {
    const html = await readFile(join(publicDir, "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
  }
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/lessons") {
    return sendJson(res, 200, { lessons: fingerspellingLessons });
  }

  if (url.pathname.startsWith("/api/lessons/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop() || "");
    const lesson = findLesson(id);
    if (!lesson) return sendJson(res, 404, { error: "Lesson not found" });
    return sendJson(res, 200, { lesson });
  }

  if (url.pathname === "/api/dictionary/search") {
    const query = url.searchParams.get("q")?.trim();
    if (!query) return sendJson(res, 400, { error: "Missing q" });
    const key = `search:${query}`;
    const cached = getCached(key);
    if (cached) return sendJson(res, 200, { ...cached, cached: true });
    const result = await adapter.searchEntries(query);
    setCached(key, result);
    return sendJson(res, 200, result);
  }

  if (url.pathname.startsWith("/api/dictionary/lesson/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop() || "");
    const lesson = findLesson(id);
    if (!lesson) return sendJson(res, 404, { error: "Lesson not found" });
    const key = `lesson:${lesson.id}:${lesson.dictionaryQuery}`;
    const cached = getCached(key);
    if (cached) return sendJson(res, 200, { lesson, ...cached, cached: true });
    const result = await adapter.searchEntries(lesson.dictionaryQuery);
    const exact = result.entries.find(entry => entry.title === lesson.symbol || entry.title.split(",").map(part => part.trim()).includes(lesson.symbol));
    const entries = exact ? [exact] : result.entries;
    const body = { ...result, entries };
    setCached(key, body);
    return sendJson(res, 200, { lesson, ...body });
  }

  return sendJson(res, 404, { error: "API route not found" });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    return sendJson(res, 500, { error: "Server error", detail: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Handsigns First Step is running at http://${host}:${port}`);
});
