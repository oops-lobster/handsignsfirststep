import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const dist = resolve(toolRoot, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(toolRoot, "web"), resolve(dist, "web"), {
  recursive: true,
  filter: source => !source.includes(`${resolve(toolRoot, "web", "tests")}`)
});
await cp(resolve(toolRoot, "fixtures"), resolve(dist, "fixtures"), { recursive: true });
await cp(resolve(toolRoot, "schemas"), resolve(dist, "schemas"), { recursive: true });
console.log(`Built static expert review portal at ${dist}`);
