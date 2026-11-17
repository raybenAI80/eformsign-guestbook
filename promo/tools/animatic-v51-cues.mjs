#!/usr/bin/env node
/**
 * v5.1 애니매틱 — 2분할 장면의 스틸 교체 시점(cue) 산출.
 *
 *   node tools/animatic-v51-cues.mjs           → src/animatic-v51-cues.json
 *   node tools/animatic-v51-cues.mjs --check   쓰지 않고 표만
 *
 * 규칙(2026-10-13 브리프)
 *   promise  오른쪽 스틸로 교체 = 마지막 문장(「이폼사인 방명록은 …」) 시작 시점
 *   visitor  장면 중간 지점
 *   staff    컷 2 = 「찾고,」 시작 시점
 *
 * 문장 시작 시점 = public/voice/voice-v51.json 의 sentences[].startSec(voice-import 실측)이 있으면 그것.
 * 없으면 나레이션 mp3 의 문장 사이 휴지(ffmpeg silencedetect) 중
 * 「글자 비율 추정 시점」에 가장 가까운 휴지의 끝. mp3 가 없으면 글자 비율 추정만 쓴다(source=estimate).
 * 시점은 **장면 시작 기준 프레임**이다(= leadSec + mp3 안 시각).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DUR = path.join(ROOT, "src", "scene-durations-v51.json");
const OUT = path.join(ROOT, "src", "animatic-v51-cues.json");
const FPS = 30;

/** 장면 → 교체 기준 문구(나레이션 안에서 이 문구가 시작하는 시점) */
const ANCHORS = { promise: "이폼사인 방명록은", staff: "찾고," };

function narrationOf(id) {
  const src = fs.readFileSync(path.join(ROOT, "src", "script.ts"), "utf8");
  const m = src.match(/export const V51_SCENES[^=]*=\s*\[/);
  let i = m.index + m[0].length - 1, depth = 0, end = i;
  for (; end < src.length; end++) {
    if (src[end] === "[") depth++;
    else if (src[end] === "]" && --depth === 0) break;
  }
  // eslint-disable-next-line no-new-func
  return new Function(`return ${src.slice(i, end + 1)};`)().find((s) => s.id === id).narration;
}

function silences(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "silencedetect=noise=-38dB:d=0.12", "-f", "null", "-"], { encoding: "utf8" });
  const out = r.stderr ?? "";
  const starts = [...out.matchAll(/silence_start: ([\d.]+)/g)].map((x) => +x[1]);
  const ends = [...out.matchAll(/silence_end: ([\d.]+)/g)].map((x) => +x[1]);
  return ends.map((e, k) => ({ start: starts[k], end: e }));
}

const dur = JSON.parse(fs.readFileSync(DUR, "utf8"));
const lead = dur.leadSec;
const cues = {};
const rows = [];
for (const [id, anchor] of Object.entries(ANCHORS)) {
  const narr = narrationOf(id);
  const idx = narr.indexOf(anchor);
  if (idx < 0) throw new Error(`${id}: 나레이션에 「${anchor}」 가 없다`);
  const s = dur.scenes[id];
  const ratio = narr.slice(0, idx).replace(/\s/g, "").length / narr.replace(/\s/g, "").length;
  const estSec = s.narrationSec * ratio; // 글자(공백 제외) 비율
  const mp3 = path.join(ROOT, "public", "voice", `v51-${id}.mp3`);
  let atSec = estSec;
  let source = "estimate";
  // 1순위: tools/voice-import.mjs 가 기록한 문장 시작 실측(장면 mp3 안 초) — 10-13 클로바 더빙
  const vj = path.join(ROOT, "public", "voice", "voice-v51.json");
  const sent = fs.existsSync(vj) ? JSON.parse(fs.readFileSync(vj, "utf8")).scenes?.[id]?.sentences?.find((x) => x.text.startsWith(anchor)) : null;
  if (sent) {
    atSec = sent.startSec;
    source = `voice-import #${sent.n}`;
  } else if (fs.existsSync(mp3) && s.narrationSec > 0) {
    const sil = silences(mp3).filter((x) => x.start > 0.3 && x.end < s.narrationSec - 0.3);
    if (sil.length) {
      const best = sil.reduce((a, b) => (Math.abs(b.end - estSec) < Math.abs(a.end - estSec) ? b : a));
      atSec = best.end;
      source = "silencedetect";
    }
  }
  cues[id] = Math.round((lead + atSec) * FPS);
  rows.push({ 장면: id, 기준: anchor, 추정초: +estSec.toFixed(2), 채택초: +atSec.toFixed(2), 근거: source, 장면내프레임: cues[id] });
}
cues.visitor = Math.round(dur.scenes.visitor.frames / 2);
rows.push({ 장면: "visitor", 기준: "장면 중간", 추정초: null, 채택초: null, 근거: "midpoint", 장면내프레임: cues.visitor });

console.table(rows);
if (!process.argv.includes("--check")) {
  fs.writeFileSync(OUT, `${JSON.stringify({ fps: FPS, note: "장면 시작 기준 프레임. tools/animatic-v51-cues.mjs 산출", cues, rows }, null, 2)}\n`, "utf8");
  console.log("->", OUT);
}
