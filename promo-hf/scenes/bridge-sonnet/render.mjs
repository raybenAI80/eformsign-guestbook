#!/usr/bin/env node
// Render bridge-sonnet: node scenes/bridge-sonnet/render.mjs  -> ../promo/out/ab/bridge-sonnet.mp4
import { copyFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = resolve(root, "..", "promo", "out", "ab", "bridge-sonnet.mp4");
mkdirSync(dirname(out), { recursive: true });
const tmp = "_render-bridge-sonnet.html";
copyFileSync(join(root, "scenes", "bridge-sonnet", "host.html"), join(root, tmp));
let code = 1;
try {
  code = spawnSync("npx", ["--yes", "hyperframes@0.8.149", "render", "-c", tmp, "-o", out, "--quiet"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" }).status ?? 1;
} finally { rmSync(join(root, tmp), { force: true }); }
console.log(`render bridge-sonnet -> ${out} exit=${code}`);
process.exit(code);
