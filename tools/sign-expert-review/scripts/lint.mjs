import { readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const roots = [resolve(toolRoot, "web"), resolve(toolRoot, "scripts"), resolve(toolRoot, "server"), resolve(toolRoot, "api")];
const files = [];

async function collect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === "tests" || entry.name === "dist") continue;
    const target = join(path, entry.name);
    if (entry.isDirectory()) await collect(target);
    else if ([".js", ".mjs"].includes(extname(entry.name))) files.push(target);
  }
}

for (const root of roots) await collect(root);
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Checked ${files.length} expert review JavaScript modules.`);
