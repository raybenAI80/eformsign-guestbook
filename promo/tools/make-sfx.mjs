#!/usr/bin/env node
/**
 * 훅 장면(0~3초) 효과음 합성기.
 *
 *   node tools/make-sfx.mjs            # public/sfx/*.wav 를 다시 만든다
 *   node tools/make-sfx.mjs --check    # 만들지 않고 현재 파일의 레벨만 잰다
 *
 * 🔴 효과음을 **내려받지 않는다**. 라이선스가 걸리지 않게 ffmpeg 합성으로만 만든다.
 *    (aevalsrc = 사인 합성 · anoisesrc = 핑크 노이즈 → 필터 → 레벨 정규화)
 *
 * 만드는 소리 두 개 — 톤은 「기업 SaaS 광고」. 장난스러운 소리·8bit 금지.
 *   ① ui-tick.wav  : 문서 한 행이 도착할 때의 짧은 알림음.
 *                    C6(1046.5Hz) → G6(1568Hz) 두 음, 150ms, 피크 -16 dBFS.
 *                    지수 감쇠 + 부드러운 어택(클릭 방지) + 7kHz 로우패스.
 *                    🔴 v3(2026-09-21)부터 **훅에서 쓰지 않는다** — 훅에 문서함 도착
 *                    모션이 없어졌다. 파일은 남겨 둔다(다른 장면이 쓸 수 있다).
 *   ② room-tone.wav: 훅 0~4초 전체에 아주 낮게 깔리는 사무실 룸톤.
 *                    핑크 노이즈 → 320Hz 로우패스 → 피크 -26 dBFS.
 *                    3.70~4.00초 페이드아웃 = 장면이 끝나기 전에 공기가 빠진다.
 *                    v3 훅에는 나레이션이 있으므로 룸톤은 그 아래 깔리는 바닥이다.
 *
 * 48kHz 로 만든다(본편 오디오가 48kHz). 배치는 src/scenes/Hook.tsx 가 한다.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "sfx");
const SR = 48000;

const run = (args) =>
  execFileSync("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** volumedetect 로 최대·평균 레벨(dBFS)을 잰다. ffmpeg 는 통계를 stderr 로 낸다 */
function measure(file) {
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostdin", "-i", file, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" }
  );
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(out);
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(out);
  return {
    max: max ? Number(max[1]) : NaN,
    mean: mean ? Number(mean[1]) : NaN,
  };
}

/** 임시 파일을 만들고 피크가 targetPeak dBFS 가 되도록 이득을 걸어 최종 파일로 굽는다 */
function bakeToPeak(buildArgs, finalPath, targetPeak) {
  const tmp = `${finalPath}.tmp.wav`;
  run([...buildArgs, tmp]);
  const { max } = measure(tmp);
  if (!Number.isFinite(max)) throw new Error(`레벨 측정 실패: ${tmp}`);
  const gain = (targetPeak - max).toFixed(2);
  run(["-i", tmp, "-af", `volume=${gain}dB`, "-c:a", "pcm_s16le", "-ar", String(SR), finalPath]);
  fs.rmSync(tmp, { force: true });
  return { rawPeak: max, gain: Number(gain), ...measure(finalPath) };
}

/* ── ① 알림음 ─────────────────────────────────────────────────────────── */
const TICK_D = 0.15; // s
const N2 = 0.055; // 둘째 음이 들어오는 시각(s)
// (1-exp(-t*k)) = 부드러운 어택(클릭 방지), exp(-t*k) = 지수 감쇠
const note = (f, t0, dec, amp) =>
  `(gt(t,${t0}))*(1-exp(-(t-${t0})*600))*exp(-(t-${t0})*${dec})*${amp}*sin(2*PI*${f}*(t-${t0}))`;
const TICK_EXPR = [
  note(1046.5, 0, 34, 0.62), // C6
  note(1568.0, N2, 30, 0.5), // G6 — 완전5도 위, 「도착했다」로 읽히는 상행 2음
  note(2093.0, 0, 60, 0.12), // 살짝의 배음(너무 둔탁해지지 않게)
].join("+");

const TICK_ARGS = [
  "-f",
  "lavfi",
  "-i",
  `aevalsrc=exprs='${TICK_EXPR}':s=${SR}:d=${TICK_D}`,
  "-af",
  [
    "lowpass=f=7000",
    "highpass=f=200",
    `afade=t=out:st=${(TICK_D - 0.02).toFixed(3)}:d=0.02`,
    "aformat=channel_layouts=stereo",
  ].join(","),
  "-c:a",
  "pcm_s16le",
  "-ar",
  String(SR),
];

/* ── ② 룸톤 ──────────────────────────────────────────────────────────── */
/**
 * 룸톤 길이 = **훅 장면 길이**. 🔴 2026-09-21 레인 I: 예전에는 `ROOM_D = 4.0` 하드코딩이었는데,
 * 장면 길이가 나레이션 실측에서 나오게 되면서(훅 4.0 → 5.333초) 룸톤이 장면보다 짧아져
 * 훅 뒷부분이 **완전 무음**이 되었다. 이제 `src/scene-durations.json` 에서 파생한다.
 * 페이드아웃은 끝 0.3초에 걸쳐 장면 끝에 맞춘다.
 */
const hookSeconds = () => {
  const f = path.join(ROOT, "src", "scene-durations.json");
  if (!fs.existsSync(f)) return 4.0; // 산출 전(스토리보드)
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const h = j.scenes?.hook;
  return h ? Math.round((h.frames / j.fps) * 1000) / 1000 : 4.0;
};

const ROOM_D = hookSeconds();
const FADE_OUT_AT = Math.max(0, Math.round((ROOM_D - 0.3) * 1000) / 1000);

const ROOM_ARGS = [
  "-f",
  "lavfi",
  "-i",
  `anoisesrc=c=pink:r=${SR}:d=${ROOM_D}:a=0.6`,
  "-af",
  [
    "highpass=f=45", // 스피커에서 웅웅거리는 초저역 제거
    "lowpass=f=320", // 사무실 룸톤 = 저역만 남은 공기
    "lowpass=f=320",
    "afade=t=in:st=0:d=0.5",
    `afade=t=out:st=${FADE_OUT_AT}:d=0.3`,
    "aformat=channel_layouts=stereo",
  ].join(","),
  "-c:a",
  "pcm_s16le",
  "-ar",
  String(SR),
];

/* ── 실행 ────────────────────────────────────────────────────────────── */
const checkOnly = process.argv.includes("--check");
fs.mkdirSync(OUT_DIR, { recursive: true });

const TICK = path.join(OUT_DIR, "ui-tick.wav");
const ROOM = path.join(OUT_DIR, "room-tone.wav");

if (checkOnly) {
  for (const f of [TICK, ROOM]) {
    if (!fs.existsSync(f)) {
      console.log(`❌ 없음  ${path.relative(ROOT, f)}`);
      continue;
    }
    const m = measure(f);
    console.log(
      `${path.relative(ROOT, f)}  peak ${m.max} dBFS · mean ${m.mean} dBFS · ${fs.statSync(f).size} bytes`
    );
  }
  process.exit(0);
}

const t = bakeToPeak(TICK_ARGS, TICK, -16);
console.log(
  `✅ public/sfx/ui-tick.wav    ${TICK_D * 1000}ms · peak ${t.max} dBFS · mean ${t.mean} dBFS (gain ${t.gain} dB)`
);

const r = bakeToPeak(ROOM_ARGS, ROOM, -26);
console.log(
  `✅ public/sfx/room-tone.wav  ${ROOM_D}s · peak ${r.max} dBFS · mean ${r.mean} dBFS (gain ${r.gain} dB) · ${FADE_OUT_AT}s 부터 페이드아웃`
);
