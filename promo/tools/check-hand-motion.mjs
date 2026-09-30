#!/usr/bin/env node
/**
 * 레인 V(2026-09-30) 게이트 — Fill·Repeat 손 궤적이 **사람 손 속도 범위**인지, 손끝이 **화면 안**에
 * 닿는지, 바탕이 **한 장**인지 판정한다. 결과 표를 out/check/v33v-motion.json 에 쓴다.
 *
 *   node tools/check-hand-motion.mjs          (exit 1 = 실패)
 *
 * 속도 환산: 태블릿 화면 세로(쿼드 높이, 사진 px) = 23.5cm(11인치 세로) 로 두고 cm/s 로 바꾼다.
 * 기준(사람이 화면을 짚는 손): 이동 평균 ≤ 60cm/s, 순간 최고 ≤ 150cm/s, 한 프레임 도약 없음.
 * 🔴 TS 정본(src/hand.ts)을 그대로 import 한다 — 궤적을 이 스크립트에서 다시 계산하지 않는다.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (!process.env.__HAND_CHECK_CHILD) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "handchk-"));
  const hook = path.join(dir, "json-attr-hook.mjs");
  const reg = path.join(dir, "register.mjs");
  fs.writeFileSync(
    hook,
    `export async function resolve(spec, ctx, next) {
  let r;
  try { r = await next(spec, ctx); } catch (e) {
    if (e?.code !== "ERR_MODULE_NOT_FOUND" || !spec.startsWith(".")) throw e;
    r = await next(spec + ".ts", ctx);
  }
  if (r.url.endsWith(".json")) { r.format = "json"; r.importAttributes = { type: "json" }; }
  return r;
}\n`,
  );
  fs.writeFileSync(reg, `import { register } from "node:module";\nregister("./json-attr-hook.mjs", import.meta.url);\n`);
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--import", pathToFileURL(reg).href, fileURLToPath(import.meta.url)],
    { stdio: "inherit", env: { ...process.env, __HAND_CHECK_CHILD: "1" }, cwd: root },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}

const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const hand = await imp("src/hand.ts");
const ss = await imp("src/shots-scenes.ts");
const durations = JSON.parse(fs.readFileSync(path.join(root, "src/scene-durations.json"), "utf8"));

const quad = ss.screenQuad(3);
const aspect = ss.quadAspect(quad);
const qH = (Math.hypot(quad.tl[0] - quad.bl[0], quad.tl[1] - quad.bl[1]) + Math.hypot(quad.tr[0] - quad.br[0], quad.tr[1] - quad.br[1])) / 2;
const CM_PER_PX = 23.5 / qH; // 사진 px → cm
const FPS = 30;

const seq = ss.fillSeq();
const seqCap = { width: seq.width, height: seq.height, viewport: seq.viewport };
const fillTotal = durations.scenes.fill.frames;
const per = Math.max(1, Math.floor(196 / Math.max(1, seq.frames.length)));
const fill = hand.fillKeys({ per, seqCap, b04Cap: ss.geo("B04"), b05At: 256, total: fillTotal, quad, aspect });

/* Repeat — Repeat.tsx 와 같은 파생(길이·밝은 프레임)을 쓴다 */
const repTotal = durations.scenes.repeat.frames;
const FIRST_LEN = Math.round(repTotal * 0.55);
const thanks = ss.thanksSeq();
const seqUse = ss.brightFrames(thanks);
const perSeq = Math.max(1, Math.floor((FIRST_LEN * 0.8) / seqUse.length));
const tIdx = seqUse.indexOf(hand.thanksTransitionFrame() ?? "");
const cd = ss.countdownSeq();
const cdCap = { width: cd.width, height: cd.height, viewport: hand.centeredOverlayArea(cd.viewport, cd.height) };
const cdN = Math.min(8, ss.brightFrames(cd).length);
const blank = ss.geo("C01b");
const thanksCap = { width: thanks.width, height: thanks.height, viewport: thanks.viewport };
const rep1 = hand.repeatKeys({ quad, aspect, thanksCap, thanksTapAt: tIdx > 0 ? tIdx * perSeq - 1 : null, cdCap, cdTapAt: null, blankCap: blank });
const rep2 = hand.repeatKeys({ quad, aspect, thanksCap, thanksTapAt: null, cdCap, cdTapAt: cdN ? cdN * 10 - 1 : null, blankCap: blank });

const fail = [];
const inQuad = (p) => {
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    s += Math.sign(c);
  }
  return Math.abs(s) === 4;
};

const report = { cmPerPhotoPx: +CM_PER_PX.toFixed(4), limits: { meanCmS: 60, peakCmS: 150 }, cuts: {} };
for (const [name, keys, total] of [["fill", fill, fillTotal], ["repeat-1", rep1, FIRST_LEN + 12], ["repeat-2", rep2, repTotal - FIRST_LEN]]) {
  const rows = [];
  // 탭 = 화면 안이어야 한다
  for (const k of keys) {
    if (k.kind === "tap" || k.kind === "sign") {
      const ok = inQuad(k.at);
      if (!ok) fail.push(`${name} t=${k.t} 손끝이 화면 밖 ${k.at.map((v) => v.toFixed(0))}`);
      rows.push({ t: k.t, kind: k.kind, at: k.at.map((v) => +v.toFixed(1)), inScreen: ok });
    }
  }
  // 프레임별 속도
  let prev = null, peak = 0, jumps = 0;
  const moves = [];
  let cur = null;
  for (let f = 0; f < total; f++) {
    const p = hand.poseAt(keys, f);
    if (prev && p.visible && prev.visible) {
      const v = Math.hypot(p.tip[0] - prev.tip[0], p.tip[1] - prev.tip[1]) * CM_PER_PX * FPS;
      if (v > 3) {
        if (!cur) cur = { from: f - 1, dist: 0, peak: 0 };
        cur.dist += v / FPS; cur.peak = Math.max(cur.peak, v);
      } else if (cur) { cur.to = f - 1; moves.push(cur); cur = null; }
      peak = Math.max(peak, v);
      if (v > 300) jumps++;
    }
    prev = p;
  }
  if (cur) { cur.to = total - 1; moves.push(cur); }
  const mv = moves.map((m) => ({
    frames: `${m.from}-${m.to}`,
    distCm: +m.dist.toFixed(1),
    meanCmS: +(m.dist / ((m.to - m.from + 1) / FPS)).toFixed(1),
    peakCmS: +m.peak.toFixed(1),
  }));
  for (const m of mv) {
    if (m.distCm < 1.5) continue; // 머무름 흔들림·탭 누름은 이동이 아니다
    if (m.meanCmS > 60) fail.push(`${name} ${m.frames} 평균 ${m.meanCmS}cm/s > 60`);
    if (m.peakCmS > 150) fail.push(`${name} ${m.frames} 최고 ${m.peakCmS}cm/s > 150`);
  }
  if (jumps) fail.push(`${name} 한 프레임 도약 ${jumps}회`);
  report.cuts[name] = { taps: rows, moves: mv.filter((m) => m.distCm >= 1.5) };
}

/* 바탕 한 장: Fill·Repeat 의 Photo src 가 전부 handPlate() 인가(소스 정적 검사) */
const srcs = [];
for (const f of ["src/scenes/Fill.tsx", "src/scenes/Repeat.tsx"]) {
  const t = fs.readFileSync(path.join(root, f), "utf8");
  for (const m of t.matchAll(/<(?:Photo src|Visitor gen)=\{?([^}\s]+)\}?/g)) srcs.push(`${f}: ${m[1]}`);
  if (/Occluder/.test(t.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, ""))) fail.push(`${f} 에 Occluder 가 남아 있다`);
}
const bad = srcs.filter((s) => !/handPlate\(\)/.test(s));
if (bad.length) fail.push(`바탕이 한 장이 아니다: ${bad.join(" | ")}`);
report.plates = { sources: srcs, unique: [...new Set(srcs.map((s) => s.split(": ")[1]))], file: hand.handPlate() };

fs.mkdirSync(path.join(root, "out/check"), { recursive: true });
fs.writeFileSync(path.join(root, "out/check/v33v-motion.json"), JSON.stringify(report, null, 2));
for (const [n, c] of Object.entries(report.cuts)) {
  console.log(`\n[${n}] 탭 ${c.taps.length}개(화면 안 ${c.taps.filter((x) => x.inScreen).length})`);
  for (const m of c.moves) console.log(`  이동 ${m.frames.padEnd(9)} ${String(m.distCm).padStart(5)}cm  평균 ${String(m.meanCmS).padStart(5)}cm/s  최고 ${String(m.peakCmS).padStart(5)}cm/s`);
}
console.log(`\n바탕: ${report.plates.unique.join(", ")} → ${report.plates.file}`);
if (fail.length) { console.log("\nFAIL"); fail.forEach((x) => console.log("  X " + x)); process.exit(1); }
console.log("\nPASS — 손 궤적·바탕 한 장");
