#!/usr/bin/env node
/**
 * 나레이션 템포 조정 — ffmpeg atempo(음높이 유지).
 *
 *   node tools/voice-tempo.mjs --in public/voice/gemini/v51-full.wav --rate 1.07 [--out public/voice/gemini/v51-full-x107]
 *
 * 산출: <out>.wav(입력과 같은 샘플레이트) · <out>.mp3(48kHz mono 192k) · <out>.meta.json(원 길이·새 길이·rate)
 *
 * 왜 있는가(2026-10-15): 사용자 시사에서 「속도만 살짝 빠르게」 요청이 왔다.
 * Gemini 재생성 대신 이 도구로 템포만 바꾸면 Gemini 한도를 0 소모하고, 같은 음성·같은 억양이 유지된다.
 * 무음 구간도 같은 비율로 짧아진다(rate 1.07 이면 약 6.5%).
 * rate 허용 범위 0.5~2.0(atempo 단일 필터 한계).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const inFile = arg("in");
const rate = Number(arg("rate", "1.07"));
if (!inFile || !fs.existsSync(inFile)) { console.error("사용: --in <wav> --rate 1.07 [--out <접두>]"); process.exit(1); }
if (!(rate >= 0.5 && rate <= 2)) { console.error("rate 는 0.5~2.0"); process.exit(1); }
const tag = `x${Math.round(rate * 100)}`;
const outBase = arg("out", path.join(path.dirname(inFile), `${path.basename(inFile, path.extname(inFile))}-${tag}`));

const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const run = (args) => { const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" }); if (r.status !== 0) process.exit(r.status ?? 1); };

const af = `atempo=${rate}`;
run(["-i", inFile, "-af", af, "-c:a", "pcm_s16le", `${outBase}.wav`]);
run(["-i", `${outBase}.wav`, "-ar", "48000", "-ac", "1", "-b:a", "192k", `${outBase}.mp3`]);
const meta = {
  source: path.basename(inFile), rate, filter: af,
  originalSec: Math.round(dur(inFile) * 1000) / 1000,
  newWavSec: Math.round(dur(`${outBase}.wav`) * 1000) / 1000,
  newMp3Sec: Math.round(dur(`${outBase}.mp3`) * 1000) / 1000,
  note: "Gemini 재생성 대신 atempo 로 한도 0 소모",
};
fs.writeFileSync(`${outBase}.meta.json`, JSON.stringify(meta, null, 2) + "\n");
console.log(JSON.stringify(meta));
