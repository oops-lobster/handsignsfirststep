import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const webRoot = resolve(toolRoot, "web");
const dist = resolve(toolRoot, "dist");
const allowedExtensions = new Set([".html", ".css", ".js", ".svg", ".png", ".webp", ".ico"]);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(webRoot, "index.html"), resolve(dist, "index.html"));
await cp(resolve(webRoot, "styles.css"), resolve(dist, "styles.css"));
await cp(resolve(webRoot, "src"), resolve(dist, "src"), { recursive: true });

const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) await collect(target);
    else files.push(target);
  }
}
await collect(dist);

for (const file of files) {
  if (!allowedExtensions.has(extname(file))) throw new Error(`VERCEL_OUTPUT_NOT_ALLOWED:${file}`);
  const content = await readFile(file);
  if (content.byteLength > 1024 * 1024) throw new Error(`VERCEL_OUTPUT_TOO_LARGE:${file}`);
  const text = content.toString("utf8");
  if (/\b(client_secret|refresh_token)\b\s*[:=]\s*["'][^"']+/i.test(text)) throw new Error(`VERCEL_OUTPUT_SECRET_PATTERN:${file}`);
  if (/\/Volumes\//.test(text)) throw new Error(`VERCEL_OUTPUT_PRIVATE_PATH:${file}`);
}

console.log(`Built allowlisted Vercel portal at ${dist} (${files.length} files, no media/archive/data files).`);
