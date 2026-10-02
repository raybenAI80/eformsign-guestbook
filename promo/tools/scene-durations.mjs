#!/usr/bin/env node
/**
 * 장면 길이 산출기 — **나레이션 실측**에서 타임라인을 만든다.
 *
 *   node tools/scene-durations.mjs            public/voice/voice.json → src/scene-durations.json
 *   node tools/scene-durations.mjs --check     쓰지 않고 표만 (CI·게이트용, 값이 다르면 exit 1)
 *   node tools/scene-durations.mjs --json      JSON 만
 *   node tools/scene-durations.mjs --set demo  실제 화면 편: public/voice/voice-demo.json → src/scene-durations-demo.json
 *                                              (DEMO_SCENES 순서 · 시각 최소 DEMO_MIN_VISUAL_FRAMES · 총길이 DEMO_BOUNDS)
 *
 * 왜 이 도구가 있는가 (2026-09-21 레인 I)
 *   v2 까지 장면 길이는 `src/script.ts` 에 손으로 적은 startSec/endSec 였다. 화자를 바꾸거나
 *   (선히 +10% → 인준 0%) 원고를 고칠 때마다 나레이션이 장면을 넘거나 남아, 사람이 표를 다시
 *   계산해야 했다. 카피는 사용자 확정본이라 줄일 수 없으므로 **장면이 음성에 맞춰야** 한다.
 *   그래서 길이를 하드코딩하지 않고 이 도구가 음성 실측에서 계산해 JSON 으로 내보내고,
 *   `src/script.ts` 가 그 JSON 을 읽어 타임라인을 만든다.
 *
 * 산출 규칙
 *   장면 프레임 = max( 올림fps( leadSec + 나레이션 실측초 + tailSec ), 시각 최소 프레임 )
 *   · leadSec 0.30s  장면이 바뀌고 말이 시작되기까지의 숨
 *   · tailSec 0.50s  말이 끝나고 컷이 넘어가기까지의 여운
 *     (나레이션 mp3 는 이미 앞 0.19s·뒤 ~0.30s 여백을 품고 있다 — tools/voice-post.mjs.
 *      여기 값은 그 위에 더 얹는 **연출** 여유다.)
 *   · 시각 최소 프레임 = 장면 컴포넌트가 깨지지 않는 하한(아래 MIN_VISUAL_FRAMES, 근거 주석)
 *
 * 총길이 규약 (사용자: 60초 초과 허용, 상한 70초)
 *   · 합이 60초 미만이면 모자란 프레임을 여운(tail)으로 **고르게** 나눠 60초를 채운다.
 *   · 합이 70초를 넘으면 lead/tail 을 비례 축소해 맞춘다. 그래도 넘으면 exit 1 로 보고한다
 *     (카피 축약은 이 도구가 하지 않는다 — 사용자 확정본이다).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSet } from "./tts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOICE_JSON = path.join(ROOT, "public", "voice", "voice.json");
const OUT_JSON = path.join(ROOT, "src", "scene-durations.json");

export const FPS = 30;
export const PAD = { leadSec: 0.3, tailSec: 0.5 };
export const BOUNDS = { minSec: 60, maxSec: 70 };

/**
 * 장면별 **시각 최소 프레임** — 나레이션이 짧아도 이보다 줄이면 화면이 깨지거나 못 읽는다.
 * 숫자마다 근거가 있다(장면 컴포넌트의 절대 프레임 또는 연출 최소 단위).
 */
export const MIN_VISUAL_FRAMES = {
  // 사진 한 장 느린 줌뿐 — TOTAL 에 비례한다. 하한 없음.
  hook: 0,
  // 앞 컷 55% 안에서 카메라 푸시인이 끝나고 최대 배율에 머물러야 한다(레인 F 설계 = 6초).
  paper: 180,
  // 캡처 3컷(A01·A02·A04)을 TOTAL/3 로 나눠 쓴다. 한 컷 2초 아래로 내려가면 못 읽는다.
  designer: 180,
  // 🔴 Fill.tsx 의 TAIL_CUTS 는 절대 프레임이다 — B05(전송 팝업)가 at=256 에서 시작한다.
  //    맺음 컷 30프레임을 남기려면 286 이 하한. 이보다 짧으면 팝업이 사라진다.
  fill: 286,
  // 🔴 Repeat.tsx 뒤 컷 = TOTAL*0.45 + FADE. 카운트다운 8장 × 10프레임 = 80 에
  //    빈 서식 20프레임을 더한 100프레임이 들어가야 한다 → (100-12)/0.45 ≈ 196.
  repeat: 196,
  // 커서 이동 계획이 TOTAL 가중치로 늘고 준다. 하한 없음.
  manage: 0,
  // Appear 가 3·6·9·12프레임에 계단식으로 뜨고 Inbox 가 from=92 에서 도착한다 → 5초.
  branch: 150,
  // 로고·문구 3단 등장이 58프레임에 끝난다. 머무름 2초를 더해 4초.
  cta: 120,
};

/**
 * 실제 화면 편(demo set) — 2026-10-03 레인 D1.
 * 총길이 규약 = 스토리보드 §0 「45~60초(나레이션 길이가 결정)」.
 */
export const DEMO_BOUNDS = { minSec: 45, maxSec: 60 };
/**
 * 실제 화면 편 시각 최소 프레임. 장면 컴포넌트가 아직 없다(다음 레인) — 재사용이 확정된
 * 두 장면만 본편 근거를 빌려 온다. 새 장면 컴포넌트가 절대 프레임을 쓰면 여기에 근거와 함께 올린다.
 */
export const DEMO_MIN_VISUAL_FRAMES = {
  hook: 0,
  arrive: 0,
  fill: 0,
  next: 0,
  stack: 0,
  manage: 0,
  // 홍보편 Branch 재사용 — 본편 MIN_VISUAL_FRAMES.branch 와 같은 근거(Inbox from=92 → 5초)
  branch: 150,
  // 홍보편 CTA 재사용 — 3단 등장 58프레임 + 머무름 2초
  cta: 120,
};

const ceilFrames = (sec) => Math.ceil(sec * FPS - 1e-9);

/**
 * @param {{scenes: Record<string, {seconds: number|null}>}} voice
 * @param {string[]} order 장면 순서(script.ts 의 SCENES 순서)
 */
export function computeDurations(voice, order, opts = {}) {
  const pad = { ...PAD, ...(opts.pad ?? {}) };
  const bounds = opts.bounds ?? BOUNDS;
  const minVisualTable = opts.minVisual ?? MIN_VISUAL_FRAMES;
  const minFrames = Math.round(bounds.minSec * FPS);
  const maxFrames = Math.round(bounds.maxSec * FPS);

  const build = (p) =>
    order.map((id) => {
      const v = voice.scenes[id];
      const narrationSec = v && typeof v.seconds === "number" ? v.seconds : 0;
      const minVisual = minVisualTable[id] ?? 0;
      const fromVoice = ceilFrames(p.leadSec + narrationSec + p.tailSec);
      return {
        id,
        narrationSec,
        minVisualFrames: minVisual,
        voiceFrames: fromVoice,
        frames: Math.max(fromVoice, minVisual),
        driver: fromVoice >= minVisual ? "voice" : "visual",
      };
    });

  let usedPad = { ...pad };
  let rows = build(usedPad);
  let total = rows.reduce((a, r) => a + r.frames, 0);
  const notes = [];

  // 너무 길면 lead/tail 을 비례 축소한다(카피는 건드리지 않는다)
  if (total > maxFrames) {
    for (let i = 0; i < 12 && total > maxFrames; i++) {
      const k = 0.9;
      usedPad = { leadSec: usedPad.leadSec * k, tailSec: usedPad.tailSec * k };
      rows = build(usedPad);
      total = rows.reduce((a, r) => a + r.frames, 0);
    }
    notes.push(
      `총길이가 상한(${bounds.maxSec}초)을 넘어 여유를 축소했다 → lead ${usedPad.leadSec.toFixed(3)}s · tail ${usedPad.tailSec.toFixed(3)}s`,
    );
  }

  // 모자라면 여운을 고르게 더한다 — 나머지는 나레이션이 긴 장면부터
  let padded = 0;
  if (total < minFrames) {
    const deficit = minFrames - total;
    const each = Math.floor(deficit / rows.length);
    let rest = deficit - each * rows.length;
    const byLen = [...rows].sort((a, b) => b.narrationSec - a.narrationSec);
    for (const r of rows) r.frames += each;
    for (const r of byLen) {
      if (rest <= 0) break;
      r.frames += 1;
      rest -= 1;
    }
    padded = deficit;
    total = rows.reduce((a, r) => a + r.frames, 0);
    notes.push(`총길이가 하한(${bounds.minSec}초)에 모자라 ${deficit}프레임을 여운으로 고르게 더했다`);
  }

  let at = 0;
  const scenes = {};
  for (const r of rows) {
    scenes[r.id] = {
      narrationSec: r.narrationSec,
      minVisualFrames: r.minVisualFrames,
      voiceFrames: r.voiceFrames,
      startFrame: at,
      frames: r.frames,
      seconds: Math.round((r.frames / FPS) * 1000) / 1000,
      driver: r.frames > r.voiceFrames && r.frames === r.minVisualFrames ? "visual" : r.driver,
    };
    at += r.frames;
  }

  const ok = total >= minFrames && total <= maxFrames;
  if (!ok) notes.push(`🔴 총길이 ${(total / FPS).toFixed(2)}초 — 규약 ${bounds.minSec}~${bounds.maxSec}초를 벗어난다`);

  return {
    fps: FPS,
    voice: voice.voice ?? null,
    rate: voice.rate ?? null,
    leadSec: Math.round(usedPad.leadSec * 1000) / 1000,
    tailSec: Math.round(usedPad.tailSec * 1000) / 1000,
    paddedFrames: padded,
    totalFrames: total,
    totalSec: Math.round((total / FPS) * 1000) / 1000,
    ok,
    notes,
    scenes,
  };
}

/** script.ts 에서 장면 순서만 뽑는다(타입 없이 — tools/tts.mjs 와 같은 방식) */
export function sceneOrder(arrayName = "SCENES") {
  const src = fs.readFileSync(path.join(ROOT, "src", "script.ts"), "utf8");
  const m = src.match(new RegExp(`export const ${arrayName}[^=]*=\\s*\\[`));
  if (!m) throw new Error(`${arrayName} 를 못 찾았다`);
  let i = m.index + m[0].length - 1;
  let depth = 0;
  let end = i;
  for (; end < src.length; end++) {
    if (src[end] === "[") depth++;
    else if (src[end] === "]" && --depth === 0) break;
  }
  // eslint-disable-next-line no-new-func
  return new Function(`return ${src.slice(i, end + 1)};`)().map((s) => s.id);
}

export function run({ write = true, set: setName } = {}) {
  const set = resolveSet(setName);
  const isMain = set.name === "main";
  const voicePath = isMain ? VOICE_JSON : path.join(ROOT, "public", "voice", set.voiceJson);
  const outPath = isMain ? OUT_JSON : path.join(ROOT, "src", set.sceneDurations);
  const voice = JSON.parse(fs.readFileSync(voicePath, "utf8"));
  const res = isMain
    ? computeDurations(voice, sceneOrder())
    : computeDurations(voice, sceneOrder(set.array), { bounds: DEMO_BOUNDS, minVisual: DEMO_MIN_VISUAL_FRAMES });
  if (!isMain) res.set = set.name;
  if (write) fs.writeFileSync(outPath, `${JSON.stringify(res, null, 2)}\n`, "utf8");
  return { ...res, outPath };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const setArg = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;
  const res = run({ write: !check, set: setArg });
  const OUT_PATH = res.outPath;
  delete res.outPath;
  if (args.includes("--json")) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.table(
      Object.entries(res.scenes).map(([id, s]) => ({
        장면: id,
        "나레이션(초)": s.narrationSec,
        "여유포함(프레임)": s.voiceFrames,
        "시각최소": s.minVisualFrames,
        "장면(프레임)": s.frames,
        "장면(초)": s.seconds,
        결정: s.driver === "visual" ? "시각최소" : "음성",
      })),
    );
    console.log(
      `총 ${res.totalFrames}프레임 = ${res.totalSec}초 (lead ${res.leadSec}s · tail ${res.tailSec}s · 보충 ${res.paddedFrames}프레임)`,
    );
    for (const n of res.notes) console.log(`  ${n}`);
  }
  if (check) {
    const cur = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, "utf8")) : null;
    const same = cur && JSON.stringify(cur.scenes) === JSON.stringify(res.scenes);
    if (!same) {
      console.error(`🔴 ${path.relative(ROOT, OUT_PATH)} 이 현재 음성과 다르다 — node tools/scene-durations.mjs${setArg ? ` --set ${setArg}` : ""} 를 다시 돌려라`);
      process.exit(1);
    }
  }
  if (!res.ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
