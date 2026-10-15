#!/usr/bin/env node
// Judge the bridge-opus hand fade: hand-mask region color vs the same scene rendered without the hand layer.
// Usage: node bridge-fade-judge.mjs [--video mp4] [--hand alpha.png] [--out-dir dir] [--name base]
//        [--times 1.5,1.7,...] [--ref-video nohand.mp4] [--after 1.737] [--max-de 3]
// No npm deps; needs ffmpeg on PATH. Camera constants mirror scenes/bridge-opus/index.html.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const root = path.resolve(here, "..", "..");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const video = arg("video", path.join(root, "promo/out/ab/bridge-opus-v3.mp4"));
const handPng = arg("hand", path.join(root, "promo-hf/scenes/bridge-opus/assets/gen/gen-01-hand.png"));
const outDir = arg("out-dir", path.join(root, "promo/out/ab"));
const base = arg("name", "bridge-opus-v3-fade");
const times = arg("times", "1.5,1.7,1.8,1.9,2.0,2.15,2.5").split(",").map(Number);
const refVideo = arg("ref-video", path.join(root, "promo/out/ab/bridge-opus-v3-nohand.mp4")); // same scene rendered with #bo-hand hidden
const after = Number(arg("after", "1.737"));
const maxDE = Number(arg("max-de", "3"));

// camera constants (same as index.html)
const T0 = 0.5, T1 = 4.0, S_END = 2.0, F = [880, 870], F_END = [960, 660];
const HAND_DROP = 32;
const PAGE_FADE_T = T0 + (T1 - T0) * Math.sqrt(0.25 / 2);
const HAND_OUT = [PAGE_FADE_T - 0.45, PAGE_FADE_T - 0.05];
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
const cam = (time) => {
  const p = ease(clamp01((time - T0) / (T1 - T0)));
  const s = 1 + (S_END - 1) * p;
  const fx = F[0] + (F_END[0] - F[0]) * p, fy = F[1] + (F_END[1] - F[1]) * p;
  return { s, tx: fx - s * F[0], ty: fy - s * F[1] };
};

const tmp = mkdtempSync(path.join(tmpdir(), "bfj-"));
const ff = (args, opts = {}) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 1 << 30, ...opts });

// hand alpha, 1920x1080 gray raw
const aRaw = ff(["-i", handPng, "-vf", "scale=1920:1080,format=rgba,alphaextract,format=gray", "-f", "rawvideo", "-"]);
const A = new Uint8Array(aRaw);
const pts = [];
for (let y = 0; y < 1080; y += 4) for (let x = 0; x < 1920; x += 4) if (A[y * 1920 + x] > 128) pts.push([x, y]);
if (!pts.length) { console.error("empty hand alpha"); process.exit(2); }

const frame = (t, v = video) => new Uint8Array(ff(["-ss", String(t), "-i", v, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]));
const lab = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const g2 = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * g2(Y) - 16, 500 * (g2(X) - g2(Y)), 200 * (g2(Y) - g2(Z))];
};
// mean color of frame over the mask mapped to screen at time `maskT` (hand drop included)
const meanColor = (buf, maskT) => {
  const { s, tx, ty } = cam(maskT);
  const drop = HAND_DROP * smooth(HAND_OUT[0], HAND_OUT[1], maskT);
  let r = 0, g = 0, b = 0, n = 0;
  for (const [x, y] of pts) {
    const sx = Math.round(s * x + tx), sy = Math.round(s * y + ty + drop);
    if (sx < 0 || sy < 0 || sx >= 1920 || sy >= 1080) continue;
    const i = (sy * 1920 + sx) * 3;
    r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : null;
};

const rows = [];
for (const t of times) {
  const buf = frame(t);
  // mask at time t; reference = same time in the hand-free render
  const c = meanColor(buf, t), c0 = meanColor(frame(t, refVideo), t);
  const l1 = lab(c), l0 = lab(c0);
  const de = Math.hypot(l1[0] - l0[0], l1[1] - l0[1], l1[2] - l0[2]);
  const gated = t >= after;
  rows.push({ t, deltaE: +de.toFixed(2), gated, pass: gated ? de < maxDE : null, mean: c.map((v) => +v.toFixed(1)), ref: c0.map((v) => +v.toFixed(1)) });
}

// contact sheet: table header band (x340 y36 1240x120) at 200%, one row per time
mkdirSync(outDir, { recursive: true });
const crops = [];
times.forEach((t, i) => {
  const f = path.join(tmp, `c${i}.png`);
  ff(["-ss", String(t), "-i", video, "-frames:v", "1", "-vf", "crop=1240:120:340:36,scale=2480:240:flags=lanczos", f]);
  crops.push(f);
});
const sheet = path.join(outDir, base.replace(/-fade$/, "") + "-fade-sheet.png");
ff([...crops.flatMap((f) => ["-i", f]), "-filter_complex", `${crops.map((_, i) => `[${i}:v]`).join("")}vstack=inputs=${crops.length}`, sheet]);

const failed = rows.filter((r) => r.pass === false);
const result = { video, times, refVideo, after, maxDE, sheet, rows, pass: failed.length === 0 };
const jsonPath = path.join(outDir, base + ".json");
writeFileSync(jsonPath, JSON.stringify(result, null, 2));
console.log("t(s)   dE     gated  pass");
for (const r of rows) console.log(`${String(r.t).padEnd(6)} ${String(r.deltaE).padEnd(6)} ${String(r.gated).padEnd(6)} ${r.pass}`);
console.log(`sheet: ${sheet}\njson: ${jsonPath}\nRESULT: ${result.pass ? "PASS" : "FAIL"}`);
process.exit(result.pass ? 0 : 1);
