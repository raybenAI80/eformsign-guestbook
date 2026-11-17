#!/usr/bin/env node
/**
 * 나레이션 한 방 빌드 — 생성 → 휴지 축약 → 라우드니스 정합 → 길이표 갱신.
 *
 *   node tools/voice-build.mjs                              기본 음성·속도로 본편 빌드
 *   node tools/voice-build.mjs --voice InJoon --rate 0      화자·속도를 바꿔 본편 빌드
 *   node tools/voice-build.mjs --voice InJoon --rate 0 \
 *        --out-dir out/check/voice-trial --scenes paper,fill 시험 빌드(본편 건드리지 않음)
 *
 *   node tools/voice-build.mjs --set demo                   실제 화면 편(DEMO_SCENES) — demo-<id>.mp3 · voice-demo.json
 *
 *   🔴 edge-tts 는 네트워크를 쓴다 — PowerShell 에서 실행한다(Bash 는 샌드박스).
 *
 * 왜 한 명령인가 (2026-09-21 오케스트레이터 지시)
 *   화자와 원고가 바뀔 예정이므로 **완성된 mp3 를 손질해 보관하는 것은 버려질 작업**이다.
 *   바뀌지 않는 것은 「생성하고 다듬는 절차」뿐이다. 그래서 절차를 한 명령으로 굳혔고
 *   음성·속도·원고·장면 목록은 전부 인자·입력이 되었다.
 *
 * 파이프라인
 *   ① tools/tts.mjs         script.ts 의 narration/tts → <out>/_raw/<scene>.mp3 + voice.json
 *   ② tools/voice-post.mjs  긴 무음 축약 · 앞뒤 여백 정돈 · 고정 게인 + 리미터
 *   ③ voice.json / src/voice-durations.json  후처리 **후** 길이로 갱신
 *
 * 🔴 원본(①의 산출)은 <out>/_raw/ 에 남는다. 두 번 돌려도 계속 깎이지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { run as ttsRun, resolveSet } from "./tts.mjs";
import { postProcess, DEFAULTS as POST_DEFAULTS } from "./voice-post.mjs";
import { diagnose } from "./check-voice.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const probeSeconds = (file) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
    encoding: "utf8",
  });
  return Math.round(parseFloat((r.stdout ?? "").trim()) * 1000) / 1000;
};

/**
 * @param {object} o
 * @param {string} [o.voice]   음성 별칭(InJoon) 또는 전체 이름
 * @param {string} [o.rate]    "0" · "+10%" 등
 * @param {string} [o.outDir]  기본 public/voice
 * @param {string[]} [o.scenes] 이 장면만 (시험 빌드용). 없으면 전부
 * @param {boolean} [o.force]  TTS 캐시 무시
 * @param {object} [o.post]    voice-post 옵션 덮어쓰기
 */
export function build(o = {}) {
  const set = resolveSet(o.set);
  const outDir = path.resolve(ROOT, o.outDir ?? path.join("public", "voice"));
  const rawDir = path.join(outDir, "_raw");
  const isMain = path.resolve(outDir) === path.resolve(ROOT, "public", "voice");

  // ① 생성 — 원본은 _raw 에 둔다(후처리 입력)
  const gen = ttsRun({
    voice: o.voice,
    rate: o.rate,
    outDir: rawDir,
    force: o.force,
    writeDurations: false,
    quiet: true,
    set: set.name,
  });

  const wanted = o.scenes && o.scenes.length ? new Set(o.scenes) : null;
  const rows = [];

  // ② 후처리
  for (const [id, v] of Object.entries(gen.scenes)) {
    if (v.seconds === null || v.seconds === undefined) continue; // 나레이션 없는 장면
    if (wanted && !wanted.has(id)) continue;
    const src = path.join(rawDir, `${set.prefix}${id}.mp3`);
    const dst = path.join(outDir, `${set.prefix}${id}.mp3`);
    const before = diagnose(src, v.storyboardSec ?? null);
    postProcess(src, dst, o.post ?? {});
    const after = diagnose(dst, v.storyboardSec ?? null);
    const seconds = probeSeconds(dst);
    // 🔴 장면에 들어가는지는 **후처리 후** 길이로 판정한다.
    //    tts.mjs 의 경고는 원본 길이 + leadIn/tailOut 기준이라 과하게 잡힌다 —
    //    후처리본은 앞여백 0.19s · 끝여백 ~0.69s 를 이미 품고 있어서 그 여유를 또 더하면 이중계산이다.
    const storyboardSec = v.storyboardSec ?? null;
    const fits = storyboardSec === null ? null : seconds <= storyboardSec - 0.1;
    rows.push({ id, before, after, seconds, storyboardSec, fits });
  }

  // ③ 길이표 — 후처리 **후** 길이가 진실이다
  const vj = { ...gen };
  delete vj.outDir;
  delete vj.warnings;
  vj.postProcess = { ...POST_DEFAULTS, ...(o.post ?? {}) };
  vj.postProcessedAt = new Date().toISOString();
  for (const r of rows) {
    if (vj.scenes[r.id]) {
      vj.scenes[r.id].rawSeconds = gen.scenes[r.id].seconds;
      vj.scenes[r.id].seconds = r.seconds;
      vj.scenes[r.id].bytes = fs.statSync(path.join(outDir, `${set.prefix}${r.id}.mp3`)).size;
    }
  }
  fs.writeFileSync(path.join(outDir, set.voiceJson), `${JSON.stringify(vj, null, 2)}\n`, "utf8");

  if (isMain) {
    const durations = {};
    for (const [id, v] of Object.entries(vj.scenes)) if (typeof v.seconds === "number") durations[id] = v.seconds;
    fs.writeFileSync(path.join(ROOT, "src", set.voiceDurations), `${JSON.stringify(durations, null, 2)}\n`, "utf8");
  }

  return { outDir, voice: vj.voice, rate: vj.rate, rows, warnings: gen.warnings ?? [] };
}

/** 전·후 휴지 표(마크다운) */
export function reportMd(res) {
  const pl = (d) => d.pauses.map((p) => `${p.at}s:${p.dur}s`).join(", ") || "-";
  return [
    "# 나레이션 빌드 전·후",
    "",
    `음성 **${res.voice}** · 속도 **${res.rate}** · 출력 \`${path.relative(ROOT, res.outDir).replace(/\\/g, "/")}\` · ${new Date().toISOString()}`,
    "",
    "| 장면 | 장면(초) | 길이 전→후(초) | 문장휴지 전 | 문장휴지 후 | 앞여백 전→후(ms) | LUFS 전→후 | 후처리후 판정 |",
    "|---|---|---|---|---|---|---|---|",
    ...res.rows.map(
      (r) =>
        `| ${r.id} | ${r.storyboardSec ?? "-"} | ${r.before.durSec} → ${r.after.durSec} | ${pl(r.before)} | ${pl(r.after)} | ${r.before.leadMs} → ${r.after.leadMs} | ${r.before.lufs} → ${r.after.lufs} | ${r.fits === null ? "-" : r.fits ? "들어감" : "넘침"} |`,
    ),
    "",
    ...(res.warnings.length
      ? [
          "## tts.mjs 경고 (원본 길이 기준 — 후처리 전)",
          "",
          "후처리로 긴 휴지가 줄면 대부분 해소된다. 위 표의 「후처리후 판정」이 최종이다.",
          "",
          ...res.warnings.map((w) => `- ${w}`),
          "",
        ]
      : []),
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const get = (k, d = null) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : d;
  };
  const res = build({
    voice: get("--voice"),
    rate: get("--rate"),
    outDir: get("--out-dir"),
    scenes: (get("--scenes") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    force: args.includes("--force"),
    set: get("--set"),
  });
  console.table(
    res.rows.map((r) => ({
      장면: r.id,
      "전(초)": r.before.durSec,
      "후(초)": r.after.durSec,
      "긴휴지 전": r.before.pauses.filter((p) => p.dur > 0.8).length,
      "긴휴지 후": r.after.pauses.filter((p) => p.dur > 0.8).length,
      "LUFS 후": r.after.lufs,
      "장면초": r.storyboardSec ?? "-",
      "후처리후 판정": r.fits === null ? "-" : r.fits ? "들어감" : "넘침",
    })),
  );
  for (const w of res.warnings) console.log(`  WARN ${w}`);
  const md = path.resolve(ROOT, get("--md", "out/check/voice-build.md"));
  fs.mkdirSync(path.dirname(md), { recursive: true });
  fs.writeFileSync(md, reportMd(res), "utf8");
  console.log(`음성 ${res.voice} · 속도 ${res.rate} -> ${res.outDir}`);
  console.log(`-> ${md}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
