#!/usr/bin/env node
/**
 * 나레이션 음성 진단기 — public/voice/*.mp3 를 기계로 잰다.
 *
 *   node tools/check-voice.mjs                 표 출력 + out/check/voice-report.md
 *   node tools/check-voice.mjs --json          JSON 만
 *
 * 무엇을 재는가 (사용자 지적 「나레이션이 뭔가 이상하다」를 기계가 잴 수 있는 것으로 분해)
 *   ① 길이      음성 길이 vs 장면 길이(스토리보드) — 넘치면 잘린다
 *   ② 앞뒤 여백  첫 유성음 전 여백 < 50ms 면 「잘린 느낌」, 끝 여백도 같다
 *   ③ 문장 휴지  silencedetect 로 문장 사이 무음 구간 — 0.8초 넘으면 늘어지고
 *                0.12초 미만이면 문장이 붙어 들린다
 *   ④ 라우드니스 장면별 통합 라우드니스(ebur128 I) — 장면 간 차이 3 dB 초과면 들쑥날쑥
 *   ⑤ 피크·클리핑 astats peak_level / 0 dBFS 근접 표본 수
 *
 * 🔴 ffmpeg 통계는 stderr 로 나온다 — spawnSync 로 stdout+stderr 를 합쳐 읽는다.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOICE_DIR = path.join(ROOT, "public", "voice");
const OUT_DIR = path.join(ROOT, "out", "check");

/** 판정 기준 (근거는 파일 머리말) */
export const THRESHOLDS = {
  edgePadMs: 50, // 앞뒤 여백이 이보다 짧으면 잘린 느낌
  pauseLongSec: 0.8, // 이보다 긴 문장 사이 휴지는 늘어진다
  pauseShortSec: 0.12, // 이보다 짧으면 문장이 붙는다
  loudnessSpreadDb: 3, // 장면 간 통합 라우드니스 차이 상한
  targetLufs: -16,
  truePeakDbtp: -1,
};

const ff = (args) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
};

export function probeSeconds(file) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return Math.round(parseFloat((r.stdout ?? "").trim()) * 1000) / 1000;
}

/** silencedetect → [{start,end,dur}] (무음 구간) */
export function silences(file, noiseDb = -40, minDur = 0.08) {
  const out = ff(["-i", file, "-af", `silencedetect=noise=${noiseDb}dB:d=${minDur}`, "-f", "null", "-"]);
  const res = [];
  let start = null;
  for (const line of out.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) start = Number(s[1]);
    const e = /silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line);
    if (e) {
      res.push({ start: Math.max(0, start ?? Number(e[1]) - Number(e[2])), end: Number(e[1]), dur: Number(e[2]) });
      start = null;
    }
  }
  if (start !== null) res.push({ start, end: null, dur: null }); // 끝까지 무음
  return res;
}

/** astats → peak/rms(dBFS), 0dBFS 근접 표본 수 */
export function stats(file) {
  const out = ff(["-i", file, "-af", "astats=metadata=1:reset=0", "-f", "null", "-"]);
  const pick = (re) => {
    const m = [...out.matchAll(re)].map((x) => Number(x[1])).filter((n) => Number.isFinite(n));
    return m.length ? Math.max(...m) : NaN;
  };
  return {
    peakDb: pick(/Peak level dB:\s*(-?[\d.inf]+)/g),
    rmsDb: pick(/RMS level dB:\s*(-?[\d.inf]+)/g),
    flatSamples: pick(/Flat factor:\s*([\d.]+)/g),
    clipped: pick(/Number of samples:\s*(\d+)/g) && (out.match(/Peak count:\s*(\d+)/) ? Number(out.match(/Peak count:\s*(\d+)/)[1]) : 0),
  };
}

/** ebur128 → {I, LRA, TP} */
export function ebur128(file) {
  const out = ff(["-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const tail = out.slice(out.lastIndexOf("Summary:"));
  const num = (label) => {
    const m = new RegExp(`${label}:\\s*(-?[\\d.]+|-inf)`).exec(tail);
    return m ? (m[1] === "-inf" ? -Infinity : Number(m[1])) : NaN;
  };
  return { I: num("I"), LRA: num("LRA"), TP: num("Peak") };
}

/** 한 파일 진단 */
export function diagnose(file, storyboardSec = null) {
  const dur = probeSeconds(file);
  const sil = silences(file);
  const head = sil.find((s) => s.start <= 0.02);
  const leadMs = head && head.end !== null ? Math.round(head.end * 1000) : 0;
  const tailSil = sil[sil.length - 1];
  const tailMs =
    tailSil && (tailSil.end === null || Math.abs(dur - tailSil.end) < 0.03)
      ? Math.round((dur - tailSil.start) * 1000)
      : 0;
  const inner = sil.filter((s) => s !== head && s.end !== null && s.start > 0.05 && s.end < dur - 0.05);
  const st = stats(file);
  const eb = ebur128(file);

  const issues = [];
  if (leadMs < THRESHOLDS.edgePadMs) issues.push(`시작 여백 ${leadMs}ms (<${THRESHOLDS.edgePadMs}ms · 잘린 느낌)`);
  if (tailMs < THRESHOLDS.edgePadMs) issues.push(`끝 여백 ${tailMs}ms (<${THRESHOLDS.edgePadMs}ms · 말이 끊긴 느낌)`);
  for (const p of inner) {
    if (p.dur > THRESHOLDS.pauseLongSec) issues.push(`${p.start.toFixed(2)}초에 ${p.dur.toFixed(2)}초 휴지 (늘어짐)`);
  }
  if (Number.isFinite(st.peakDb) && st.peakDb > -0.5) issues.push(`피크 ${st.peakDb} dBFS (클리핑 위험)`);
  // 🔴 판정 기준 정정(2026-09-21 레인 I). 예전에는 `dur + 1.05 > 장면초` 였다 — leadIn 0.35 +
  //    tailOut 0.70 을 **또** 더한 값인데, 후처리본은 이미 앞 0.195초·뒤 0.69초 여백을 품고 있고
  //    장면 길이 자체가 그 여유를 포함해 산출된다(tools/scene-durations.mjs). 삼중계산이라
  //    맞춘 장면이 전부 「여유 부족」으로 잡혔다. 지금은 **음성이 장면에 들어가는가**만 본다.
  if (storyboardSec !== null && dur > storyboardSec - 0.05) issues.push(`장면 ${storyboardSec}초에 음성 ${dur}초 — 넘친다`);

  return {
    file: path.basename(file),
    durSec: dur,
    storyboardSec,
    leadMs,
    tailMs,
    pauses: inner.map((p) => ({ at: Math.round(p.start * 100) / 100, dur: Math.round(p.dur * 100) / 100 })),
    peakDb: st.peakDb,
    rmsDb: st.rmsDb,
    lufs: eb.I,
    lra: eb.LRA,
    tpDb: eb.TP,
    issues,
  };
}

function main() {
  const jsonOnly = process.argv.includes("--json");
  // --dir <경로> : public/voice 대신 다른 폴더를 잰다(후처리 전·후 비교용)
  const di = process.argv.indexOf("--dir");
  const dir = di >= 0 ? path.resolve(ROOT, process.argv[di + 1]) : VOICE_DIR;
  // --out <파일> : 리포트 경로(기본 out/check/voice-report.md)
  const oi = process.argv.indexOf("--out");
  const reportPath = oi >= 0 ? path.resolve(ROOT, process.argv[oi + 1]) : path.join(OUT_DIR, "voice-report.md");
  const voiceJson = JSON.parse(fs.readFileSync(path.join(VOICE_DIR, "voice.json"), "utf8"));
  // 🔴 「장면초」는 src/scene-durations.json 이 정본이다(2026-09-21 레인 I).
  //    voice.json 의 storyboardSec 은 script.ts 리터럴에서 온 **스토리보드 초안**이라
  //    이제 실제 장면 길이와 다르다. 그대로 두면 장면이 음성에 맞춰졌는데도
  //    hook·paper·branch 가 「여유 부족」으로 잡힌다(실제로는 전부 들어간다).
  const sdPath = path.join(ROOT, "src", "scene-durations.json");
  const sd = fs.existsSync(sdPath) ? JSON.parse(fs.readFileSync(sdPath, "utf8")) : null;
  const sceneSec = (id, fallback) => {
    const v = sd?.scenes?.[id];
    return v ? Math.round((v.frames / sd.fps) * 1000) / 1000 : fallback;
  };
  const rows = [];
  for (const [id, v] of Object.entries(voiceJson.scenes)) {
    const file = path.join(dir, `${id}.mp3`);
    if (!fs.existsSync(file)) continue;
    rows.push({ id, ...diagnose(file, sceneSec(id, v.storyboardSec ?? null)) });
  }

  const lufsVals = rows.map((r) => r.lufs).filter((n) => Number.isFinite(n));
  const spread = Math.max(...lufsVals) - Math.min(...lufsVals);
  if (spread > THRESHOLDS.loudnessSpreadDb) {
    rows.forEach((r) => {
      if (Math.abs(r.lufs - (Math.max(...lufsVals) + Math.min(...lufsVals)) / 2) > THRESHOLDS.loudnessSpreadDb / 2) {
        r.issues.push(`라우드니스 ${r.lufs} LUFS — 장면 간 편차 ${spread.toFixed(1)} dB`);
      }
    });
  }

  if (jsonOnly) {
    console.log(JSON.stringify({ spreadDb: Math.round(spread * 10) / 10, rows }, null, 2));
    return;
  }

  console.table(
    rows.map((r) => ({
      장면: r.id,
      "장면초": r.storyboardSec,
      "음성초": r.durSec,
      "앞ms": r.leadMs,
      "끝ms": r.tailMs,
      "휴지수": r.pauses.length,
      "피크dB": r.peakDb,
      "LUFS": r.lufs,
      "TPdB": r.tpDb,
      "문제": r.issues.length,
    })),
  );
  console.log(`장면 간 라우드니스 편차 ${spread.toFixed(1)} dB (상한 ${THRESHOLDS.loudnessSpreadDb} dB)`);

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const md = [
    `# 나레이션 진단 (${path.relative(ROOT, dir).replace(/\\/g, "/")}/*.mp3)`,
    "",
    `측정 시각: ${new Date().toISOString()} · 음성 ${voiceJson.voice} · rate ${voiceJson.rate}`,
    "",
    "| 장면 | 장면(초) | 음성(초) | 앞여백(ms) | 끝여백(ms) | 문장휴지 | 피크(dBFS) | RMS(dBFS) | LUFS | TP(dBTP) |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.storyboardSec} | ${r.durSec} | ${r.leadMs} | ${r.tailMs} | ${
          r.pauses.map((p) => `${p.at}s:${p.dur}s`).join(", ") || "-"
        } | ${r.peakDb} | ${r.rmsDb} | ${r.lufs} | ${r.tpDb} |`,
    ),
    "",
    `장면 간 통합 라우드니스 편차 **${spread.toFixed(1)} dB** (상한 ${THRESHOLDS.loudnessSpreadDb} dB)`,
    "",
    "## 장면별 지적",
    ...rows.flatMap((r) => (r.issues.length ? [`- **${r.id}**`, ...r.issues.map((i) => `  - ${i}`)] : [`- ${r.id}: 문제 없음`])),
    "",
  ].join("\n");
  fs.writeFileSync(reportPath, md, "utf8");
  console.log(`-> ${reportPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
