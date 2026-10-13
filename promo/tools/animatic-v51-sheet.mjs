#!/usr/bin/env node
/**
 * v5.1 애니매틱 대조 시트 — 장면 중간 프레임 7장 + 경계 6곳의 −0.1초/+0.2초 12장 → 타일 PNG.
 *
 *   node tools/animatic-v51-sheet.mjs [out/animatic/v5.1.mp4] [out/animatic/v5.1-sheet.png]
 *
 * 경계 쌍은 크로스페이드(경계 b 기준 [b-7f, b+8f))가 실제로 걸렸는지 보는 용도다.
 * 장면 시각은 src/scene-durations-v51.json 에서 읽는다(렌더본과 같은 정본).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [inArg, outArg] = process.argv.slice(2);
const IN = path.resolve(ROOT, inArg ?? "out/animatic/v5.1.mp4");
const OUT = path.resolve(ROOT, outArg ?? "out/animatic/v5.1-sheet.png");
const dur = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "scene-durations-v51.json"), "utf8"));
const fps = dur.fps;
const ids = Object.keys(dur.scenes);

const shots = [];
for (const id of ids) {
  const s = dur.scenes[id];
  shots.push({ t: (s.startFrame + s.frames / 2) / fps, label: `${id} mid` });
}
for (const id of ids.slice(1)) {
  const b = dur.scenes[id].startFrame / fps;
  shots.push({ t: b - 0.1, label: `to ${id} -0.1s` });
  shots.push({ t: b + 0.2, label: `to ${id} +0.2s` });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anim-sheet-"));
const files = shots.map((sh, i) => {
  const f = path.join(tmp, `s${String(i).padStart(2, "0")}.png`);
  const text = `${sh.label} ${sh.t.toFixed(2)}s`.replace(/:/g, "\\:");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", sh.t.toFixed(3), "-i", IN, "-frames:v", "1",
    "-vf", `scale=640:360,drawtext=text='${text}':x=10:y=10:fontfile='C\\:/Windows/Fonts/arial.ttf':fontsize=22:fontcolor=white:box=1:boxcolor=black@0.7`, f]);
  return f;
});
// 4열 타일 — 19장 → 5행(빈 칸은 검정)
execFileSync("ffmpeg", ["-y", "-v", "error", "-framerate", "1", "-i", path.join(tmp, "s%02d.png"),
  "-vf", "tile=4x5:padding=6:color=0x222222", "-frames:v", "1", OUT]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${OUT} (${files.length} frames)`);
for (const sh of shots) console.log(`  ${sh.label.padEnd(22)} ${sh.t.toFixed(2)}s`);
