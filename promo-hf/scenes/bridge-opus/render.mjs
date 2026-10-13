#!/usr/bin/env node
// v5.1 bridge scene (7.0 s, silent) — standalone mini HyperFrames project.
// Usage: node promo-hf/scenes/bridge-opus/render.mjs [--check] [output.mp4]
//   copies the 4 assets from promo/public (assets/ is gitignored), runs lint (+ check), renders.
// Default output: promo/out/ab/bridge-opus.mp4
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HF = "hyperframes@0.8.149";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");
const src = join(repo, "promo", "public");
const FILES = ["gen/gen-01.png", "gen/gen-01-hand.png", "shots/demo/tablet/V3-step1-filled-x25.png", "fonts/Paperlogy-8ExtraBold.ttf"];
for (const f of FILES) {
  const to = join(here, "assets", f);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(src, f), to);
}
const args = process.argv.slice(2);
const doCheck = args.includes("--check");
const out = resolve(args.find((a) => !a.startsWith("--")) || join(repo, "promo", "out", "ab", "bridge-opus.mp4"));
mkdirSync(dirname(out), { recursive: true });
const run = (a) => spawnSync("npx", ["--yes", HF, ...a], { cwd: here, stdio: "inherit", shell: process.platform === "win32" }).status ?? 1;
let code = run(["lint", "."]);
if (code === 0 && doCheck) code = run(["check", ".", "--at-transitions"]);
if (code === 0) code = run(["render", "-o", out, "--quiet"]);
console.log(`bridge-opus -> ${out} exit=${code}`);
process.exit(code);
