#!/usr/bin/env node
// Render one scene through its standalone host in hosts/.
// Usage: node tools/render-scene.mjs <hook|compare|cta> [output.mp4]
//
// Why the copy: a project may have only ONE root-level HTML file with data-composition-id
// (lint multiple_root_compositions), and a host's asset / sub-composition paths are relative
// to the project root. So hosts live in hosts/ and are copied to the root only for the render.
import { copyFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scene = process.argv[2];
const host = join(root, "hosts", `scene-${scene}.html`);
if (!scene || !existsSync(host)) {
  console.error("usage: node tools/render-scene.mjs <hook|compare|cta> [output.mp4]");
  process.exit(2);
}
const out = resolve(process.argv[3] || join(root, "renders", `scene-${scene}.mp4`));
const tmp = `_render-${scene}.html`;
copyFileSync(host, join(root, tmp));
let code = 1;
try {
  const r = spawnSync("npx", ["--yes", "hyperframes@0.8.149", "render", "-c", tmp, "-o", out, "--quiet"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  code = r.status ?? 1;
} finally {
  rmSync(join(root, tmp), { force: true });
}
console.log(`render ${scene} -> ${out} exit=${code}`);
process.exit(code);
