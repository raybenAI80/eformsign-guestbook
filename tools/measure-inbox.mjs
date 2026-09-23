#!/usr/bin/env node
/**
 * 이폼사인 문서함 실캡처(shots/D/D01-document-list.png)의 **목록 행 좌표**를 화소 스캔으로 잰다.
 *
 * 왜 스크립트인가: Hook/Fill/Repeat 장면은 이 캡처 위에 「도착하는 행」을 얹는다.
 * 행 자리를 눈대중으로 코드에 박으면 캡처가 다시 찍힐 때마다 어긋난다
 * (2026-09-18 Paper 장면에서 육안 격자 측정이 120px 틀린 전례가 있다).
 *
 * 재는 것:
 *   ① 우측 「문서 상태/이력」 패널과의 세로 구분선 x  → 크롭 오른쪽 경계
 *   ② 목록 영역의 가로 구분선 y 들                    → 행 경계
 *   ③ 1행의 선택 하이라이트(회색) 밴드의 상·하·좌·우  → 행 높이와 좌우 범위
 *
 * 쓰는 법:
 *   node tools/measure-inbox.mjs                 # 측정값 출력
 *   node tools/measure-inbox.mjs --overlay       # out/check/inbox-bands.png 에 근거 오버레이
 *
 * 출력 좌표는 **캡처 원본 화소**(2400x1350) 기준이다. 이 값을 src/shots.ts 의
 * INBOX_SHOT 기술서(crop/bands)에 옮겨 적는다.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "public/shots/D/D01-document-list.png");

const args = process.argv.slice(2);
const wantOverlay = args.includes("--overlay");

if (!fs.existsSync(SRC)) {
  console.error(`캡처가 없다: ${SRC}`);
  process.exit(1);
}

/** ffprobe 로 크기, ffmpeg 로 rgb24 원시 화소를 읽는다 */
function decode(file) {
  const probe = JSON.parse(
    execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "json", file,
    ]).toString()
  );
  const { width, height } = probe.streams[0];
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1 << 30 }
  );
  return { width, height, buf };
}

const { width, height, buf } = decode(SRC);
const px = (x, y) => {
  const i = (y * width + x) * 3;
  return [buf[i], buf[i + 1], buf[i + 2]];
};
const isWhite = (c) => c[0] > 249 && c[1] > 249 && c[2] > 249;
/** 목록의 구분선·하이라이트는 무채색 회색이다 */
const grayLevel = (c) =>
  Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) <= 4 ? c[0] : null;

// ① 우측 패널 구분선: 화면 세로 중앙부(행이 없는 빈 구간)에서 흰색이 끊기는 x
const probeY = Math.round(height * 0.6);
let dividerX = null;
for (let x = Math.round(width * 0.55); x < width; x++) {
  const g = grayLevel(px(x, probeY));
  if (g !== null && g < 245) {
    dividerX = x;
    break;
  }
}

// ② 목록 영역 가로 구분선: 제목 열 근처 x 에서 위→아래로 회색 가로선을 찾는다
const scanX = Math.round(width * 0.3);
const lines = [];
for (let y = 1; y < height - 1; y++) {
  const g = grayLevel(px(scanX, y));
  if (g === null || g > 243) continue;
  // 같은 y 의 가로 방향 연속성(목록 폭 전체에 걸친 선인가)
  let run = 0;
  for (let x = 100; x < (dividerX ?? width) - 40; x += 8) {
    const gg = grayLevel(px(x, y));
    if (gg !== null && gg < 246) run++;
  }
  const total = Math.floor(((dividerX ?? width) - 140) / 8);
  if (run / total > 0.9) lines.push({ y, level: g });
}
// 인접한 y 묶기
const bands = [];
for (const l of lines) {
  const last = bands[bands.length - 1];
  if (last && l.y - last.y1 <= 2) last.y1 = l.y;
  else bands.push({ y0: l.y, y1: l.y });
}

// ③ 1행 선택 하이라이트(흰색이 아닌 밝은 회색 면)의 세로 범위
let hlTop = null;
let hlBottom = null;
for (let y = 0; y < height; y++) {
  const g = grayLevel(px(scanX, y));
  const isHl = g !== null && g >= 235 && g <= 248;
  if (isHl && hlTop === null) hlTop = y;
  if (isHl) hlBottom = y;
  if (!isHl && hlTop !== null && y - hlBottom > 30) break;
}
// 하이라이트 좌·우 끝
let hlLeft = null;
let hlRight = null;
if (hlTop !== null) {
  const y = Math.round((hlTop + hlBottom) / 2);
  for (let x = 0; x < width; x++) {
    const g = grayLevel(px(x, y));
    if (g !== null && g >= 235 && g <= 248) {
      if (hlLeft === null) hlLeft = x;
      hlRight = x;
    }
  }
}

const out = {
  capture: { width, height },
  dividerX,
  highlight: { top: hlTop, bottom: hlBottom, left: hlLeft, right: hlRight },
  separators: bands.map((b) => ({ y0: b.y0, y1: b.y1 })),
};
console.log(JSON.stringify(out, null, 1));

if (wantOverlay) {
  const dir = path.join(ROOT, "out/check");
  fs.mkdirSync(dir, { recursive: true });
  const marks = [];
  for (const b of bands) marks.push(`drawbox=x=0:y=${b.y0 - 2}:w=${width}:h=6:color=red@0.7:t=fill`);
  if (hlTop !== null)
    marks.push(
      `drawbox=x=${hlLeft}:y=${hlTop}:w=${hlRight - hlLeft}:h=${hlBottom - hlTop}:color=lime@0.9:t=4`
    );
  if (dividerX) marks.push(`drawbox=x=${dividerX - 2}:y=0:w=6:h=${height}:color=blue@0.7:t=fill`);
  const dst = path.join(dir, "inbox-bands.png");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", SRC, "-vf", marks.join(","), dst]);
  console.log(`오버레이: ${dst}`);
}
