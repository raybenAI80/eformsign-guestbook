#!/usr/bin/env node
/**
 * check-shot-framing.mjs — Manage 장면 문서함 컷(D01~D03) 프레이밍과 D02 검색칸 검출을 기계로 판정한다.
 *
 * 사용: node tools/check-shot-framing.mjs            (exit 0 = 통과, 1 = 실패)
 *       node tools/check-shot-framing.mjs --self-test (과거 결함값을 넣어 실패하는지 확인)
 *
 * 왜 (2026-09-28 레인 M4·M5, 사용자 지적 2건)
 *   ① 「문서함 컷 오른쪽 잘림」: 캡처 비(2400x1350 = 1.78) > 노트북 화면 비(≈1.58)인데 높이 기준 crop 이라
 *      우측 「문서 상태 / 이력」 패널이 잘렸다. 규칙 = 폭 기준(measure-scenes `widthFirstFrame`).
 *      → 판정: D01~D03 `frame` 이 있고 frame.w = 캡처 폭, x=y=0, h = round(폭/화면비).
 *   ② 「D02 파란 박스」: 헤더 높이 비율 상수 가정이 재촬영 후 결과 행 링크를 잡았다(360,111 840x127).
 *      → 판정: search 사각형이 헤더 아래·입력칸 크기(폭 ≤ 30%, 높이 ≤ 6%)·x 10~55% 안.
 *   ③ 재촬영 후 measure-scenes 를 안 돌린 경우: PNG 실제 크기 ≠ geometry 크기면 실패.
 *   ④ 배선: Manage.tsx crop 우선순위에 `c.cap.frame` 이 있어야 규칙이 화면에 반영된다.
 * 🔴 화면 비 식은 measure-scenes `screenAspect` · src/shots-scenes.ts `quadAspect` 와 같다(바꾸면 셋 다).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIDTH_FIRST = ["D01", "D02", "D03"];
const SHOT_FILE = { D01: "D/D01-document-list.png", D02: "D/D02-search.png", D03: "D/D03-pdf-preview.png" };

function screenAspect(prompts, sceneNo) {
  const q = prompts.scenes.find((x) => x.scene === sceneNo)?.screenQuad;
  if (!q || q.points.length !== 4) return null;
  const [tl, tr, br, bl] = q.points;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return (d(tl, tr) + d(bl, br)) / 2 / ((d(tl, bl) + d(tr, br)) / 2);
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** 순수 판정 — geometry·aspect·실제 PNG 크기·Manage 소스를 받아 실패 목록을 돌려준다 */
export function judge({ captures, aspect, pngSizes = {}, manageSrc = "" }) {
  const fail = [];
  if (!aspect) fail.push("prompts.json scene 6 screenQuad 없음 — 화면 비를 못 구함");
  for (const k of WIDTH_FIRST) {
    const c = captures[k];
    if (!c) { fail.push(`${k}: scene-geometry.json captures 에 없음`); continue; }
    const real = pngSizes[k];
    if (real && (real.width !== c.width || real.height !== c.height))
      fail.push(`${k}: PNG ${real.width}x${real.height} ≠ geometry ${c.width}x${c.height} — measure-scenes 재실행 필요`);
    if (!aspect) continue;
    const wide = c.width / c.height > aspect;
    if (!wide) { if (c.frame) fail.push(`${k}: 캡처 비 ≤ 화면 비인데 frame 이 있음`); continue; }
    const f = c.frame;
    if (!f) { fail.push(`${k}: 캡처 비 ${(c.width / c.height).toFixed(3)} > 화면 비 ${aspect.toFixed(3)} 인데 frame 없음(폭 기준 규칙 미적용)`); continue; }
    if (f.x !== 0 || f.y !== 0) fail.push(`${k}: frame 원점 (${f.x},${f.y}) ≠ (0,0) — 위 정렬 아님`);
    if (f.w !== c.width) fail.push(`${k}: frame 폭 ${f.w} ≠ 캡처 폭 ${c.width} — 우측 패널이 잘린다`);
    const wantH = Math.round(c.width / aspect);
    if (Math.abs(f.h - wantH) > 1) fail.push(`${k}: frame 높이 ${f.h} ≠ round(폭/화면비) ${wantH} — 화면에서 늘어난다`);
  }
  const d02 = captures.D02;
  const s = d02?.search;
  if (!s) fail.push("D02: search 사각형 없음(measureD02 검출 실패)");
  else {
    const W = d02.width, H = d02.height;
    if (s.headerH == null || s.y < s.headerH) fail.push(`D02: search.y ${s.y} 가 헤더(${s.headerH}) 아래가 아님`);
    if (s.w > W * 0.3) fail.push(`D02: search 폭 ${s.w} > 캡처 30% — 입력칸이 아닌 것을 잡음`);
    if (s.h > H * 0.06) fail.push(`D02: search 높이 ${s.h} > 캡처 6% — 표 머리글·행까지 덮음`);
    if (s.x < W * 0.1 || s.x + s.w > W * 0.55) fail.push(`D02: search x 범위 ${s.x}..${s.x + s.w} 가 10~55% 밖`);
  }
  if (manageSrc && !/c\.crop\s*\?\?\s*c\.cap\.frame\s*\?\?/.test(manageSrc))
    fail.push("Manage.tsx: crop 우선순위 `c.crop ?? c.cap.frame ?? …` 배선 없음 — frame 이 화면에 반영 안 됨");
  return fail;
}

function selfTest() {
  const aspect = 1.58;
  const good = { width: 2400, height: 1350, frame: { x: 0, y: 0, w: 2400, h: Math.round(2400 / aspect) } };
  const cases = [
    ["v3.1 높이 기준(frame 없음)", { D01: { width: 2400, height: 1350 }, D02: { ...good, search: { x: 543, y: 132, w: 450, h: 51, headerH: 87 } }, D03: good }],
    ["M4 이전 D02 박스(360,111 840x127)", { D01: good, D02: { ...good, search: { x: 360, y: 111, w: 840, h: 127, headerH: 58 } }, D03: good }],
    ["폭 2133 frame", { D01: { ...good, frame: { x: 0, y: 0, w: 2133, h: 1350 } }, D02: { ...good, search: { x: 543, y: 132, w: 450, h: 51, headerH: 87 } }, D03: good }],
  ];
  let ok = true;
  for (const [name, captures] of cases) {
    const f = judge({ captures, aspect });
    console.log(`${f.length ? "✓ 잡음" : "✗ 놓침"}  ${name}${f.length ? " — " + f[0] : ""}`);
    if (!f.length) ok = false;
  }
  const pass = judge({ captures: { D01: good, D02: { ...good, search: { x: 543, y: 132, w: 450, h: 51, headerH: 87 } }, D03: good }, aspect });
  console.log(`${pass.length ? "✗ 오탐" : "✓ 통과"}  정상값(v3.2)${pass.length ? " — " + pass[0] : ""}`);
  if (pass.length) ok = false;
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) selfTest();
  const geo = JSON.parse(fs.readFileSync(path.join(ROOT, "src/scene-geometry.json"), "utf8"));
  const prompts = JSON.parse(fs.readFileSync(path.join(ROOT, "public/gen/prompts.json"), "utf8"));
  const aspect = screenAspect(prompts, 6);
  const pngSizes = {};
  for (const [k, rel] of Object.entries(SHOT_FILE)) {
    const f = path.join(ROOT, "public/shots", rel);
    if (fs.existsSync(f)) pngSizes[k] = pngSize(f);
  }
  const manageSrc = fs.readFileSync(path.join(ROOT, "src/scenes/Manage.tsx"), "utf8");
  const fail = judge({ captures: geo.captures, aspect, pngSizes, manageSrc });
  console.log(`화면 비(scene 6) = ${aspect?.toFixed(4)}`);
  for (const k of WIDTH_FIRST) {
    const c = geo.captures[k];
    console.log(`${k}: 캡처 ${c?.width}x${c?.height} frame ${c?.frame ? `${c.frame.x},${c.frame.y} ${c.frame.w}x${c.frame.h}` : "-"}`);
  }
  console.log(`D02 search: ${JSON.stringify(geo.captures.D02?.search)}`);
  if (fail.length) { fail.forEach((m) => console.log("✗ " + m)); console.log(`실패 ${fail.length}건`); process.exit(1); }
  console.log("통과 — 문서함 컷 폭 기준 프레이밍·D02 검색칸·배선 OK");
}
