#!/usr/bin/env node
/**
 * 믹스 검증기 — 렌더된 영상의 **소리**를 기계로 잰다.
 *
 *   node tools/check-mix.mjs out/check/v3-audio.mp4
 *   node tools/check-mix.mjs out/check/v3-audio.mp4 --md out/check/mix-report.md
 *
 * 무엇을 재는가 (브리프 C 의 완료 조건을 기계가 잴 수 있는 것으로 분해)
 *   ① 통합 라우드니스 I · LRA · 트루피크 TP   목표 -16 LUFS 근처 · TP ≤ -1 dBTP
 *   ② 초당 RMS 표                             나레이션 구간에서 BGM 이 내려갔는지(덕킹)
 *   ③ 나레이션 개시 시각                        장면 경계 +0.5초 이내인지
 *
 * 🔴 ffmpeg 통계는 stderr 로 나온다 — spawnSync 로 stdout+stderr 를 합쳐 읽는다.
 *
 * ── 나레이션 개시 판정이 세 번 바뀐 내력 (같은 함정을 다시 밟지 말 것) ──
 *  1차: `silencedetect` → BGM 이 깔리면 영상에 **무음이 없어** 개시가 0개로 잡혔다.
 *  2차: `highpass=f=2000` 을 통과시킨 신호로 판정 → 「BGM 은 1.6 kHz 로우패스라 2 kHz 위가
 *       비어 있다」는 **BGM 의 성질에 기댄 전제**였다.
 *  🔴 3차(2026-09-21, 현재): BGM 재작곡으로 그 전제가 깨졌다 — 새 BGM 은 11~13 kHz 까지
 *       열려 있고 햇·플럭이 2 kHz 위에 상시 존재한다(4 kHz↑ 에너지 3~9%, `bgm-candidates.md`).
 *       그래서 **BGM 이 어떤 음악이든 성립하는** 방법으로 바꿨다:
 *       장면별 나레이션 원본(`public/voice/<id>.mp3`)의 **음량 포락선을 믹스와 상호상관**
 *       (normalized cross-correlation)해 실제 재생 위치를 찾는다. 평균을 뺀 포락선끼리
 *       맞추므로 꾸준히 깔린 BGM 성분은 상관에 거의 기여하지 않는다.
 *       부수 효과로 「첫 소리」가 아니라 **그 장면의 나레이션인지**까지 확인된다(상관계수 r).
 *
 * 🔴 효과음 구간 국소 피크 항목은 **삭제했다**. ① 훅의 알림음 ui-tick 3발은 2026-09-21 훅
 *    재구성에서 의도적으로 빠졌고(`src/scenes/Hook.tsx` 머리말) ② 그 측정 자체가 위 2차
 *    전제(highpass=2000) 위에 서 있어 새 BGM 에서는 BGM 의 햇을 세게 된다. 남겨두면
 *    「13개 검출」 같은 무의미한 숫자가 리포트에 남아 판정을 흐린다.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadScript } from "./tts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ff = (args) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", ...args], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
};

export function ebur128(file) {
  const out = ff(["-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const tail = out.slice(out.lastIndexOf("Summary:"));
  const num = (label) => {
    const m = new RegExp(`${label}:\\s*(-?[\\d.]+|-inf)`).exec(tail);
    return m ? (m[1] === "-inf" ? -Infinity : Number(m[1])) : NaN;
  };
  return { I: num("I"), LRA: num("LRA"), TP: num("Peak") };
}

/**
 * 창 길이 win 초마다의 RMS(dBFS).
 *
 * 🔴 astats 의 `reset` 은 **초가 아니라 프레임 수**다(2026-09-21 오판 정정 —
 *    reset=1 을 1초로 읽어 21ms 창의 값을 초 단위 표로 찍었고, 나레이션 구간이
 *    -39.6 dB 로 나오는 엉뚱한 결과가 나왔다). asetnsamples 로 한 프레임을
 *    정확히 win 초로 만든 뒤 reset=1 을 준다.
 */
export function rmsSeries(file, win = 1, pre = "", sr = 48000) {
  const n = Math.max(1, Math.round(win * sr));
  const out = ff([
    "-i", file,
    "-af", `${pre}aresample=${sr},asetnsamples=n=${n}:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`,
    "-f", "null", "-",
  ]);
  const vals = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf|nan)/.exec(line);
    if (m) vals.push(m[1] === "-inf" || m[1] === "nan" ? -Infinity : Number(m[1]));
  }
  return vals.map((v, i) => ({ sec: i * win, rmsDb: Math.round(v * 10) / 10 }));
}

/* ── 나레이션 정렬(상호상관) ───────────────────────────────────────────
 * BGM 의 대역이 아니라 **나레이션 원본과의 닮음**으로 개시를 찾는다.
 */

const ENV_SR = 100; // 포락선 표본율(10 ms)

/** 파일의 음량 포락선(선형 RMS, 10 ms 간격). ffmpeg 으로 8 kHz 모노 PCM 을 받아 직접 센다 */
export function envelope(file, fromSec = null, durSec = null) {
  const sr = 8000, hop = Math.round(sr / ENV_SR), win = hop * 4;
  const args = ["-hide_banner", "-nostdin"];
  if (fromSec !== null) args.push("-ss", String(Math.max(0, fromSec)));
  args.push("-i", file);
  if (durSec !== null) args.push("-t", String(durSec));
  args.push("-ac", "1", "-ar", String(sr), "-f", "f32le", "-");
  const r = spawnSync("ffmpeg", args, { maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`디코드 실패: ${file}`);
  const n = Math.floor(r.stdout.length / 4);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = r.stdout.readFloatLE(i * 4);
  const frames = Math.max(0, Math.floor((n - win) / hop));
  const env = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < win; i++) { const v = x[f * hop + i]; s += v * v; }
    env[f] = Math.sqrt(s / win);
  }
  return env;
}

/** 평균 0·표준편차 1 로 정규화 — 꾸준히 깔린 성분(BGM)이 상관에서 빠진다 */
const normalize = (a) => {
  const m = a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const d = a.map((v) => v - m);
  const s = Math.sqrt(d.reduce((x, y) => x + y * y, 0) / (d.length || 1)) || 1e-9;
  return d.map((v) => v / s);
};

/**
 * 믹스 안에서 나레이션 원본이 **실제로 시작되는 시각**을 찾는다.
 * 경계 ±searchSec 를 10 ms 씩 훑어 상관계수가 최대인 지점을 고른다.
 *
 * @returns {{sec:number, r:number}} 최적 위치와 상관계수(1 = 완전히 같은 모양)
 */
export function alignNarration(mixFile, voiceFile, boundarySec, { searchSec = 1.5, tmplSec = 2.5 } = {}) {
  const tmpl = normalize(Array.from(envelope(voiceFile, 0, tmplSec)));
  const from = Math.max(0, boundarySec - searchSec);
  const mix = envelope(mixFile, from, searchSec * 2 + tmplSec + 0.5);
  const steps = Math.min(mix.length - tmpl.length, Math.round(searchSec * 2 * ENV_SR));
  let best = { sec: NaN, r: -2 };
  for (let s = 0; s <= steps; s++) {
    const seg = normalize(Array.from(mix.slice(s, s + tmpl.length)));
    let r = 0;
    for (let i = 0; i < tmpl.length; i++) r += tmpl[i] * seg[i];
    r /= tmpl.length;
    if (r > best.r) best = { sec: Math.round((from + s / ENV_SR) * 1000) / 1000, r: Math.round(r * 1000) / 1000 };
  }
  return best;
}

/* ── 장면 경계·덕킹 설정(정본에서 읽는다) ─────────────────────────────── */

/** 장면 경계(초) — src/scene-durations.json. 없으면 script.ts 리터럴로 떨어진다 */
export function sceneBounds() {
  const f = path.join(ROOT, "src", "scene-durations.json");
  if (fs.existsSync(f)) {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const bounds = {};
    let first = 0;
    for (const [id, v] of Object.entries(j.scenes)) {
      bounds[id] = Math.round((v.startFrame / j.fps) * 1000) / 1000;
      if (!first) first = Math.round(((v.startFrame + v.frames) / j.fps) * 1000) / 1000;
    }
    return { bounds, sfxEnd: first };
  }
  const scenes = loadScript().scenes;
  return {
    bounds: Object.fromEntries(scenes.map((s) => [s.id, s.startSec])),
    sfxEnd: scenes.length ? scenes[0].endSec : 0,
  };
}

/**
 * 덕킹 레벨(dB) — `src/audio.tsx` 의 DUCK 이 정본이다. 여기서 복사하지 않고 **읽는다**.
 * 형식이 바뀌면 조용히 틀린 값을 쓰지 않도록 못 찾으면 예외를 던진다.
 */
export function duckConfig() {
  const src = fs.readFileSync(path.join(ROOT, "src", "audio.tsx"), "utf8");
  const num = (key) => {
    const re = new RegExp(`${key}:[ \\t]*(-?[0-9.]+)`);
    const m = re.exec(src);
    if (!m) throw new Error(`src/audio.tsx 에서 DUCK.${key} 를 못 찾았다 — check-mix 를 맞춰라`);
    return Number(m[1]);
  };
  return { baseDb: num("baseDb"), narrationDb: num("narrationDb"), sfxCapDb: num("sfxCapDb") };
}

/**
 * 파일 전체의 평균 RMS(dBFS). pre 에 ffmpeg 필터를 넣으면 그 대역만 잰다.
 *
 * 🔴 초당 RMS 표(rmsSeries)의 **dB 값을 산술평균 내면 안 된다**(2026-09-21 레인 I 오판).
 *    처음에 그렇게 쟀더니 4.4초짜리 hook 이 -31.7 dB 로 나왔다 — 끝의 조용한 창 하나가
 *    -60 dB 대라 평균을 끌어내린 것이다(실측 volumedetect 는 -16.8 dB). dB 는 로그라
 *    평균은 **에너지**로 내야 한다. volumedetect 가 파일 전체 에너지로 정확히 준다.
 */
export function meanRms(file, pre = "") {
  const out = ff(["-i", file, "-af", `${pre}volumedetect`, "-f", "null", "-"]);
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(out);
  return m ? Number(m[1]) : NaN;
}

/**
 * 나레이션 대비 BGM 분리도 — **스템을 직접 재서** 판정한다(믹스에서는 둘이 섞여 분리 불가).
 *   · 전대역   덕킹 중 BGM 이 나레이션보다 몇 dB 아래인가 (목표 ≥ 12 dB)
 *   · 4 kHz↑  새 BGM 의 햇이 나레이션 치찰음과 겹치는가 (목표 ≥ 10 dB 아래)
 * 믹스 쪽 교차검증: 나레이션 없는 구간의 믹스 RMS ≈ BGM RMS + baseDb 여야 덕킹 배선이 살아 있다.
 */
export function stemSeparation(voiceIds) {
  const duck = duckConfig();
  const bgm = path.join(ROOT, "public", "bgm", "track.mp3");
  const bgmFull = meanRms(bgm);
  const bgmHi = meanRms(bgm, "highpass=f=4000,");
  const rows = voiceIds.map((id) => {
    const f = path.join(ROOT, "public", "voice", `${id}.mp3`);
    const full = meanRms(f);
    const hi = meanRms(f, "highpass=f=4000,");
    return {
      id,
      voiceFull: full,
      voiceHi: hi,
      sepFull: Math.round((full - (bgmFull + duck.narrationDb)) * 10) / 10,
      sepHi: Math.round((hi - (bgmHi + duck.narrationDb)) * 10) / 10,
    };
  });
  return { duck, bgmFull, bgmHi, rows };
}

export const SEP_LIMITS = { fullDb: 12, hiDb: 10 };

function main() {
  const file = path.resolve(ROOT, process.argv[2] ?? "out/check/v3-audio.mp4");
  if (!fs.existsSync(file)) {
    console.error(`없는 파일: ${file}`);
    process.exit(2);
  }
  const mi = process.argv.indexOf("--md");
  const mdPath = mi >= 0 ? path.resolve(ROOT, process.argv[mi + 1]) : path.join(ROOT, "out", "check", "mix-report.md");

  const voice = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "voice", "voice.json"), "utf8"));
  // 🔴 장면 경계는 src/scene-durations.json 이 정본이다(나레이션 실측 파생, tools/scene-durations.mjs).
  //    2026-09-21 레인 I 정정: 예전에는 script.ts 의 SCENES 리터럴에서 읽었는데, 그 리터럴의
  //    startSec/endSec 는 이제 **스토리보드 초안**이라 실제 타임라인과 다르다. 그대로 두었더니
  //    개시 지연이 최대 1.5초로 나와 「나레이션이 밀렸다」는 엉뚱한 판정이 나왔다(실제로는 정확).
  const { bounds, sfxEnd } = sceneBounds();

  const eb = ebur128(file);
  const per = rmsSeries(file, 1);

  // 나레이션 개시 — 장면별 나레이션 원본을 믹스에 맞춰 찾는다(BGM 대역에 기대지 않는다)
  const starts = [];
  for (const [id, start] of Object.entries(bounds)) {
    if (!voice.scenes[id] || voice.scenes[id].seconds === null) continue;
    const vf = path.join(ROOT, "public", "voice", `${id}.mp3`);
    if (!fs.existsSync(vf)) { starts.push({ 장면: id, 경계: start, 개시: null, 지연: null, r: null }); continue; }
    const a = alignNarration(file, vf, start);
    starts.push({ 장면: id, 경계: start, 개시: a.sec, 지연: Math.round((a.sec - start) * 1000) / 1000, r: a.r });
  }
  // 🔴 상관계수가 낮으면 그 장면의 나레이션이 아예 안 들어갔거나 다른 음성이 들어간 것이다
  const weak = starts.filter((s) => s.r !== null && s.r < 0.5);

  const narr = Object.entries(bounds)
    .filter(([id]) => voice.scenes[id] && voice.scenes[id].seconds !== null)
    .map(([id, s]) => ({ id, s, e: s + voice.scenes[id].seconds }));
  const inNarr = (sec) => narr.some((w) => sec >= w.s && sec < w.e - 0.5);

  const narrRms = per.filter((p) => inNarr(p.sec)).map((p) => p.rmsDb).filter(Number.isFinite);
  const gapRms = per.filter((p) => p.sec >= sfxEnd && !inNarr(p.sec)).map((p) => p.rmsDb).filter(Number.isFinite);
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : NaN);

  console.log(`파일 ${path.relative(ROOT, file)}`);
  console.log(`통합 라우드니스 I=${eb.I} LUFS · LRA=${eb.LRA} · TP=${eb.TP} dBTP`);
  console.table(starts);
  if (weak.length) console.warn(`⚠ 상관계수가 낮은 장면 ${weak.length}개:`, weak.map((s) => `${s.장면}(r=${s.r})`).join(", "));
  console.log(`나레이션 구간 평균 RMS ${avg(narrRms)} dB · 나레이션 없는 구간 ${avg(gapRms)} dB`);

  // 덕킹 분리도 — 스템을 직접 재서 판정(믹스에서는 둘이 섞여 분리되지 않는다)
  const sep = stemSeparation(starts.map((s) => s.장면));
  const worstFull = Math.min(...sep.rows.map((r) => r.sepFull));
  const worstHi = Math.min(...sep.rows.map((r) => r.sepHi));
  const expectedGap = Math.round((sep.bgmFull + sep.duck.baseDb) * 10) / 10;
  const gapDelta = Math.round((avg(gapRms) - expectedGap) * 10) / 10;
  console.table(sep.rows);
  console.log(
    `BGM RMS ${sep.bgmFull} dB(4kHz↑ ${sep.bgmHi}) · 덕킹 ${sep.duck.narrationDb} dB → ` +
      `분리도 최소 전대역 ${worstFull} dB(기준 ≥${SEP_LIMITS.fullDb}) · 4kHz↑ ${worstHi} dB(기준 ≥${SEP_LIMITS.hiDb})`,
  );
  // 🔴 기대치와 ±4 dB 안이면 덕킹 배선이 살아 있다고 본다. 정확히 맞지 않는 이유:
  //    ① 여기 gap 평균은 초당 RMS 의 dB 평균이라 조용한 창에 끌린다(에너지 평균이 아니다)
  //    ② 어택 0.15s·릴리스 0.6s 램프 구간과 첫 장면 효과음 상한(-9 dB)이 섞여 있다
  const gapOk = Math.abs(gapDelta) <= 4;
  console.log(
    `덕킹 배선 교차검증: 나레이션 없는 구간 ${avg(gapRms)} dB vs 기대 ${expectedGap} dB (차 ${gapDelta} dB) — ${gapOk ? "정상" : "🔴 배선 의심"}`,
  );
  if (worstFull < SEP_LIMITS.fullDb || worstHi < SEP_LIMITS.hiDb) console.warn("⚠ 분리도 기준 미달 — 덕킹 깊이나 햇 레벨을 조정하라");

  const md = [
    "# 믹스 검증",
    "",
    `파일 \`${path.relative(ROOT, file).replace(/\\/g, "/")}\` · 측정 ${new Date().toISOString()}`,
    "",
    `- 통합 라우드니스 **I = ${eb.I} LUFS** · LRA = ${eb.LRA} · **TP = ${eb.TP} dBTP**`,
    `- 나레이션 구간 평균 RMS **${avg(narrRms)} dB** · 나레이션 없는 구간 **${avg(gapRms)} dB**`,
    `- 상관계수 0.5 미만 장면 **${weak.length}개**${weak.length ? " — " + weak.map((s) => `${s.장면}(r=${s.r})`).join(", ") : ""}`,
    `- 덕킹 분리도(스템) — 전대역 최소 **${worstFull} dB**(기준 ≥${SEP_LIMITS.fullDb}) · 4 kHz↑ 최소 **${worstHi} dB**(기준 ≥${SEP_LIMITS.hiDb})`,
    `- 덕킹 배선 교차검증 — 나레이션 없는 구간 ${avg(gapRms)} dB vs 기대(BGM ${sep.bgmFull} ${sep.duck.baseDb} dB) ${expectedGap} dB, 차 ${gapDelta} dB`,
    "",
    "## 덕킹 분리도 (스템 직접 측정)",
    "",
    "믹스 안에서는 나레이션과 BGM 이 더해져 분리되지 않는다. 그래서 **스템**(`public/bgm/track.mp3`,",
    "`public/voice/<장면>.mp3`)을 각각 재고 `src/audio.tsx` 의 DUCK 값을 적용해 계산한다.",
    "4 kHz↑ 항목은 새 BGM 의 햇(8~19 kHz 상시)이 나레이션 치찰음과 겹치는지를 본다.",
    "",
    `BGM RMS **${sep.bgmFull} dB** · 4 kHz↑ **${sep.bgmHi} dB** · 나레이션 구간 덕킹 **${sep.duck.narrationDb} dB**`,
    "",
    "| 장면 | 나레이션 RMS | 나레이션 4kHz↑ | 분리도(전대역) | 분리도(4kHz↑) |",
    "|---|---|---|---|---|",
    ...sep.rows.map((r) => `| ${r.id} | ${r.voiceFull} | ${r.voiceHi} | ${r.sepFull} | ${r.sepHi} |`),
    "",
    "## 나레이션 개시 (장면 경계 대비)",
    "",
    "나레이션 원본 `public/voice/<장면>.mp3` 의 음량 포락선을 믹스와 상호상관해 실제 재생 위치를 찾았다.",
    "`r` 은 상관계수 — 1 에 가까울수록 그 장면의 나레이션이 그 자리에 그대로 들어가 있다는 뜻이다.",
    "",
    "| 장면 | 경계(초) | 개시(초) | 지연(초) | r |",
    "|---|---|---|---|---|",
    ...starts.map((s) => `| ${s.장면} | ${s.경계} | ${s.개시 ?? "-"} | ${s.지연 ?? "-"} | ${s.r ?? "-"} |`),
    "",
    "## 초당 RMS",
    "",
    "| 초 | RMS(dB) | 나레이션 |",
    "|---|---|---|",
    ...per.map((p) => `| ${p.sec} | ${Number.isFinite(p.rmsDb) ? p.rmsDb : "-inf"} | ${inNarr(p.sec) ? "있음" : ""} |`),
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, md, "utf8");
  console.log(`-> ${mdPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
