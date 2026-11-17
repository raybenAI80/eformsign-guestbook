#!/usr/bin/env node
/**
 * 나레이션 후처리 — 문장 사이 휴지 줄이기 · 앞뒤 여백 정돈 · 라우드니스 정합.
 *
 *   node tools/voice-post.mjs --in public/voice/paper.mp3 --out out/check/paper-fix.mp3
 *   node tools/voice-post.mjs --all --out-dir out/check/voice-fix   (public/voice 전부)
 *
 * 🔴 본편 빌드는 이 도구를 직접 부르지 않는다 — tools/voice-build.mjs 가
 *    생성 → 후처리 → 길이표 갱신을 한 명령으로 묶는다. 여기는 그 중 후처리 한 단계다.
 *
 * 왜 필요한가 (2026-09-21 실측, out/check/voice-report-before.md)
 *   edge-tts 는 마침표마다 **0.90~0.94초** 무음을 넣는다. 6~11초짜리 광고 장면에서
 *   0.9초는 장면의 8~15% 가 죽은 구간이라는 뜻이고, 「안내 방송처럼 들린다」의
 *   가장 큰 기계적 원인이다. 광고 나레이션의 문장 사이는 보통 0.25~0.40초다.
 *
 * 🔴 음성·rate 는 건드리지 않는다. 이 도구는 **무음 길이와 레벨만** 만진다.
 *
 * 왜 「20ms 크로스페이드」가 아니라 양끝 20ms 페이드인가 (설계 판단)
 *   무음을 깎는 지점은 -40 dB 이하 구간 **내부**라 파형이 사실상 0 이다 — 거기서
 *   하드 스플라이스를 해도 클릭이 생기지 않는다. 실제로 클릭이 날 수 있는 곳은
 *   파일의 시작·끝이므로 거기에만 20ms 페이드를 넣는다.
 *
 * 왜 loudnorm 이 아니라 「측정 → 고정 게인 → 리미터」인가
 *   loudnorm 단일 패스는 구간마다 게인을 움직여(펌핑) 나레이션의 강약을 눌러버린다.
 *   여기서는 ebur128 로 통합 라우드니스를 먼저 재고, 그 차이만큼 고정 게인을 걸고
 *   alimiter 로 트루피크만 잡는다 — 원래의 강약이 남는다.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULTS = {
  /** 문장 사이에 남길 무음(초) — 이보다 긴 휴지만 이 값까지 깎는다 */
  maxPauseSec: 0.38,
  /** 첫 유성음 앞 여백(초) — 원본 190ms 를 유지한다(나레이션 개시가 장면 경계와 붙지 않게) */
  leadSec: 0.19,
  /** 끝 여백(초) */
  tailSec: 0.3,
  /** 양끝 클릭 방지 페이드(초) */
  edgeFadeSec: 0.02,
  /** 무음 판정 문턱 */
  thresholdDb: -40,
  /** 통합 라우드니스 목표 */
  lufs: -16,
  truePeak: -1.5,
};

const ff = (args) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // 🔴 ffmpeg 통계는 stderr 로 나온다
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

/** ebur128 통합 라우드니스(I, LUFS) */
export function measureLufs(file) {
  const { out } = ff(["-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const tail = out.slice(out.lastIndexOf("Summary:"));
  const m = /\bI:\s*(-?[\d.]+|-inf)/.exec(tail);
  if (!m) return NaN;
  return m[1] === "-inf" ? -Infinity : Number(m[1]);
}

function probeSeconds(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
    encoding: "utf8",
  });
  return Math.round(parseFloat((r.stdout ?? "").trim()) * 1000) / 1000;
}

/**
 * 한 파일 후처리.
 *  1) silenceremove 로 긴 무음(앞·중간·뒤)을 maxPauseSec 까지 깎는다
 *     — stop_duration 은 「남길 무음 길이」이므로 그보다 짧은 휴지는 그대로 남는다
 *  2) adelay/apad 로 앞뒤 여백을 규정값으로 다시 붙이고 양끝에 20ms 페이드
 *  3) 라우드니스를 재서 고정 게인 + 리미터로 목표에 맞춘다
 */
export function postProcess(inFile, outFile, opt = {}) {
  const o = { ...DEFAULTS, ...opt };
  const trimmed = `${outFile}.trim.wav`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const trimFilters = [
    `silenceremove=start_periods=1:start_duration=0:start_threshold=${o.thresholdDb}dB:` +
      `stop_periods=-1:stop_duration=${o.maxPauseSec}:stop_threshold=${o.thresholdDb}dB:detection=peak`,
    `adelay=${Math.round(o.leadSec * 1000)}|${Math.round(o.leadSec * 1000)}`,
    `apad=pad_dur=${o.tailSec}`,
  ].join(",");

  let r = ff(["-y", "-i", inFile, "-af", trimFilters, "-ar", "48000", "-c:a", "pcm_s16le", trimmed]);
  if (r.status !== 0) throw new Error(`ffmpeg(trim) 실패: ${r.out.slice(-800)}`);

  const lufs = measureLufs(trimmed);
  const gainDb = Number.isFinite(lufs) ? Math.round((o.lufs - lufs) * 100) / 100 : 0;
  const dur = probeSeconds(trimmed) || 0;

  const levelFilters = [
    `volume=${gainDb}dB`,
    `alimiter=limit=${Math.pow(10, o.truePeak / 20).toFixed(4)}:level=false`,
    `afade=t=in:st=0:d=${o.edgeFadeSec}`,
    `afade=t=out:st=${Math.max(0, dur - o.edgeFadeSec).toFixed(3)}:d=${o.edgeFadeSec}`,
  ].join(",");

  r = ff(["-y", "-i", trimmed, "-af", levelFilters, "-ar", "48000", "-b:a", "192k", outFile]);
  if (r.status !== 0) throw new Error(`ffmpeg(level) 실패: ${r.out.slice(-800)}`);
  fs.rmSync(trimmed, { force: true });
  return { outFile, gainDb, lufsBefore: lufs };
}

function main() {
  const args = process.argv.slice(2);
  const get = (k, d = null) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : d;
  };
  const opt = {};
  if (get("--max-pause")) opt.maxPauseSec = Number(get("--max-pause"));

  if (args.includes("--all")) {
    const dir = path.join(ROOT, "public", "voice");
    const outDir = path.resolve(ROOT, get("--out-dir", "out/check/voice-fix"));
    const made = [];
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".mp3"))) {
      made.push(postProcess(path.join(dir, f), path.join(outDir, f), opt).outFile);
    }
    console.log(`후처리 ${made.length}개 -> ${outDir}`);
    return;
  }
  const inF = get("--in");
  const outF = get("--out");
  if (!inF || !outF) {
    console.error("사용법: --in <mp3> --out <mp3>  |  --all [--out-dir <dir>]");
    process.exit(2);
  }
  console.log(postProcess(path.resolve(ROOT, inF), path.resolve(ROOT, outF), opt));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
