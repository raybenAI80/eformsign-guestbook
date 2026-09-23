#!/usr/bin/env node
/**
 * 렌더 결과를 눈으로 대조하는 프레임 대조시트.
 *
 *   node tools/contact-sheet.mjs out/preview9.mp4            프레임 4장 + 붙인 시트
 *   node tools/contact-sheet.mjs out/main60.mp4 --n 8        장수 지정
 *
 * 왜 있나: 렌더가 "끝났다"는 것과 "화면이 맞다"는 것은 다르다.
 * 영상 길이·용량만 보고 완료를 주장하지 않으려고, 실제 픽셀을 뽑아 한 장으로 붙인다.
 * 산출은 `out/check/<이름>-NN.png` 와 `out/check/<이름>-sheet.png`.
 *
 * ffmpeg·ffprobe 가 PATH 에 있어야 한다(TTS 와 같은 전제).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
if (!input) {
  console.error("사용법: node tools/contact-sheet.mjs <영상파일> [--n 4]");
  process.exit(1);
}
const nIdx = args.indexOf("--n");
const N = nIdx >= 0 ? Number(args[nIdx + 1]) : 4;

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), "..");
const video = path.resolve(ROOT, input);
const outDir = path.join(ROOT, "out", "check");
fs.mkdirSync(outDir, { recursive: true });

const base = path.basename(video, path.extname(video));

const duration = Number(
  execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video],
    { encoding: "utf8" },
  ).trim(),
);

/** 맨 앞·맨 뒤 프레임은 전환 중이라 정보가 적다 — 구간 가운데를 고른다 */
const times = Array.from({ length: N }, (_, i) => ((i + 0.5) * duration) / N);

const shots = [];
times.forEach((t, i) => {
  const out = path.join(outDir, `${base}-${String(i + 1).padStart(2, "0")}.png`);
  execFileSync(
    "ffmpeg",
    ["-y", "-ss", t.toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=640:-1", out],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  shots.push({ out, t });
});

/**
 * 🔴 `tile` 필터는 **한 스트림의 연속 프레임**을 붙이는 도구라 입력 여러 개에는 못 쓴다
 *    (2026-09-18 실측: 입력 4개를 tile 로 넘기면 ffmpeg 가 실패한다). 격자는 xstack 이다.
 */
const COLS = 2;
const ROWS = Math.ceil(N / COLS);
const layout = shots
  .map((_, i) => {
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    return `${c === 0 ? "0" : Array.from({ length: c }, (_, k) => `w${k}`).join("+")}_${
      r === 0 ? "0" : Array.from({ length: r }, (_, k) => `h${k * COLS}`).join("+")
    }`;
  })
  .join("|");

const sheet = path.join(outDir, `${base}-sheet.png`);
execFileSync(
  "ffmpeg",
  [
    "-y",
    ...shots.flatMap((s) => ["-i", s.out]),
    "-filter_complex",
    `${shots.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${shots.length}:layout=${layout}`,
    "-frames:v",
    "1",
    sheet,
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
void ROWS;

console.log(`영상 ${path.relative(ROOT, video)} · ${duration.toFixed(3)}초 · ${(fs.statSync(video).size / 1024 / 1024).toFixed(2)}MB`);
for (const s of shots) console.log(`  ${s.t.toFixed(2)}초 -> ${path.relative(ROOT, s.out)}`);
console.log(`대조시트 -> ${path.relative(ROOT, sheet)}`);
