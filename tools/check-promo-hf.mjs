#!/usr/bin/env node
// Oracle for the HyperFrames promo project (promo-hf/).
// Usage: node tools/check-promo-hf.mjs --project <promo-hf dir> [--skip-hf]
//
// 1) `npx hyperframes@0.8.108 check --at-transitions` in the project (exit code passed through)
// 2) headline banned words (태블릿|설치|키오스크) and the unconfirmed-copy placeholder (카피 미확정)
//    counted in compositions/, hosts/, index.html. Asset paths such as `tablet/...` are English,
//    so they never match the Korean pattern — no path exclusion needed beyond that.
// Prints one JSON object to stdout. exit 0 = all pass, 1 = any failure, 2 = usage error.
// Gate: R20-promo-hf (C:/Users/FORCS/.agent-harness/gates/gates.json, gate promo-hf-check).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";

const HF_VERSION = "0.8.108";
const BANNED = /태블릿|설치|키오스크/g;
const PLACEHOLDER = /카피 미확정/g;

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const projectArg = arg("--project");
if (!projectArg) {
  console.error("usage: node tools/check-promo-hf.mjs --project <promo-hf dir> [--skip-hf]");
  process.exit(2);
}
const project = resolve(projectArg);
if (!existsSync(join(project, "hyperframes.json"))) {
  console.log(JSON.stringify({ ok: false, project, error: "hyperframes.json not found — not a HyperFrames project" }));
  process.exit(1);
}

// --- 2) grep (cheap, run first so a usage-time failure still reports it)
const targets = [];
for (const dir of ["compositions", "hosts"]) {
  const d = join(project, dir);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isFile() && /\.(html?|css|js|mjs)$/i.test(f)) targets.push(p);
  }
}
if (existsSync(join(project, "index.html"))) targets.push(join(project, "index.html"));

const hits = { banned: [], placeholder: [] };
for (const p of targets) {
  const lines = readFileSync(p, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const rel = `${relative(project, p).replace(/\\/g, "/")}:${i + 1}`;
    for (const m of line.matchAll(BANNED)) hits.banned.push({ at: rel, word: m[0] });
    if (PLACEHOLDER.test(line)) hits.placeholder.push({ at: rel });
    PLACEHOLDER.lastIndex = 0;
  });
}

// --- 1) HyperFrames check
let hf = { skipped: true };
if (!argv.includes("--skip-hf")) {
  const r = spawnSync("npx", ["--yes", `hyperframes@${HF_VERSION}`, "check", "--at-transitions"], {
    cwd: project,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 10 * 60 * 1000,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  const summary = out.split(/\r?\n/).map((s) => s.trim()).filter((s) => /errors?,|Check (passed|failed)/.test(s));
  hf = { exit: r.status ?? 1, summary, tail: r.status === 0 ? undefined : out.trim().slice(-1200) };
}

const ok = (hf.skipped || hf.exit === 0) && hits.banned.length === 0 && hits.placeholder.length === 0;
console.log(JSON.stringify({
  ok,
  project,
  hyperframes: hf,
  bannedWords: { count: hits.banned.length, hits: hits.banned },
  copyPlaceholder: { count: hits.placeholder.length, hits: hits.placeholder },
  scanned: targets.map((p) => relative(project, p).replace(/\\/g, "/")),
}, null, 2));
process.exit(ok ? 0 : 1);
