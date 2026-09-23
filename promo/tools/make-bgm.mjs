#!/usr/bin/env node
/**
 * BGM 합성기 — 음원을 **직접 만든다**(다운로드 금지: 라이선스·샌드박스 양쪽 이유).
 *
 *   node tools/make-bgm.mjs                          public/bgm/track.mp3 생성(없을 때만)
 *   node tools/make-bgm.mjs --preset a --force       후보 A 로 본편 트랙 교체
 *   node tools/make-bgm.mjs --candidates             후보 3종 미리듣기 + 지표 + 스펙트럼 + 합본
 *   node tools/make-bgm.mjs --preset b --seconds 45 --out out/check/x.mp3
 *
 * 🔴 사용자 라이선스 음원 분기
 *   public/bgm/track.mp3|wav 가 있는데 public/bgm/.synthesized 마커가 **없으면**
 *   그건 사용자가 넣은 라이선스 음원이므로 건드리지 않고 그대로 쓴다.
 *
 * ── 2026-09-21 재작곡(레인 G) ────────────────────────────────────────────
 * 사용자 판정: 이전 버전(92 BPM · F장조 패드 4초 크로스페이드 · 1.6 kHz 로우패스)은
 * **「장례식 같다」**. 원인은 톤이 아니라 곡 자체였다 — 느리고, 리듬 요소가 없고,
 * 고역이 통째로 잘려 「움직임」이 0이었다.
 *
 * 그래서 구조를 바꿨다. ffmpeg 필터그래프 조합이 아니라 **Node 안의 소형 신스**다:
 *   오실레이터(sine/tri/saw/square) · ADSR · 상태변수 필터(SVF, 레조넌스/스윕 가능) ·
 *   노이즈 타악 · 딜레이 · 사이드체인 펌핑 · 소프트클립 리미터.
 * ffmpeg 은 **잔향·페이드·라우드니스·인코딩**만 맡는다.
 *
 * 곡 자체의 하한(「장송곡 금지」 규약, PRESETS 가 전부 만족해야 한다)
 *   · 템포 ≥ 100 BPM   · 장조   · 8분음 이상 리듬 요소 상시
 *   · 로우패스 컷오프 ≥ 5 kHz   · 사각파 원음 그대로 쓰지 않는다(필터·디튠 필수)
 *
 * 이벤트 스케줄 방식인 이유
 *   마디를 버퍼로 만들어 이어붙이면 길이(--seconds)가 바뀔 때마다 이음매 처리가 필요하다.
 *   여기서는 전체 구간의 **노트 이벤트 목록**을 먼저 만들고 한 버퍼에 렌더한다 —
 *   길이가 바뀌어도 마디 수만 달라지고, 꼬리(잔향·릴리스)가 잘리지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BGM_DIR = path.join(ROOT, "public", "bgm");
const MARKER = path.join(BGM_DIR, ".synthesized");
const SR = 48000;

/* ────────────────────────────── DSP 기본 ────────────────────────────── */

const TAU = Math.PI * 2;
export const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

const wave = {
  sine: (p) => Math.sin(TAU * p),
  tri: (p) => 4 * Math.abs((p % 1) - 0.5) - 1,
  saw: (p) => 2 * ((p % 1) - 0.5),
  square: (p) => ((p % 1) < 0.5 ? 1 : -1),
};

/** ADSR 대신 쓰는 짧은 감쇠 엔벨로프 — 어택 ms + 지수 감쇠. 플럭·타악 공용 */
function pluckEnv(t, dur, attack = 0.004, decay = 0.25) {
  if (t < 0 || t > dur) return 0;
  const a = t < attack ? t / attack : 1;
  const d = Math.exp(-t / decay);
  // 노트 끝 12ms 페이드 — 버퍼 경계 클릭 방지
  const tail = t > dur - 0.012 ? Math.max(0, (dur - t) / 0.012) : 1;
  return a * d * tail;
}

/** 패드용 ADSR(선형 어택·릴리스, 지속 구간 유지) */
function padEnv(t, dur, attack = 0.35, release = 0.6) {
  if (t < 0 || t > dur) return 0;
  const a = t < attack ? t / attack : 1;
  const r = t > dur - release ? Math.max(0, (dur - t) / release) : 1;
  return a * r;
}

/**
 * Chamberlin 상태변수 필터. cutoff 를 샘플마다 바꿀 수 있어 **스윕**에 쓴다.
 * 🔴 f = 2·sin(π·fc/sr) 근사는 fc 가 sr/4 를 넘으면 발산한다 — 상한을 건다.
 */
function makeSVF() {
  let low = 0, band = 0;
  return (x, cutoffHz, q = 1.0) => {
    const fc = Math.min(cutoffHz, SR * 0.24);
    const f = 2 * Math.sin(Math.PI * fc / SR);
    const damp = Math.min(1, 1 / q);
    const high = x - low - damp * band;
    band += f * high;
    low += f * band;
    return { low, band, high };
  };
}

/** 1극 하이패스 — 노이즈 타악 성형용(가볍고 충분하다) */
function makeHP(cutoffHz) {
  const rc = 1 / (TAU * cutoffHz);
  const a = rc / (rc + 1 / SR);
  let prevIn = 0, prevOut = 0;
  return (x) => {
    const y = a * (prevOut + x - prevIn);
    prevIn = x; prevOut = y;
    return y;
  };
}

/** 결정론적 노이즈 — 시드 고정(재현 가능해야 한다) */
function makeNoise(seed = 12345) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0x7fffffff) - 1;
  };
}

const softClip = (x) => Math.tanh(x * 0.8) / Math.tanh(0.8);

/* ────────────────────────────── 보이스(음색) ────────────────────────────── */

/**
 * 플럭 — 마림바/일렉피아노 계열. 배음을 **몇 개만** 얹고 빠르게 감쇠시킨다.
 * 배음비 2·3·4.2 중 4.2 가 비정수라 금속질(마림바)이 난다.
 */
function renderPluck(L, R, ev) {
  const { t0, dur, hz, gain, pan = 0, decay = 0.25, bright = 0 } = ev;
  const i0 = Math.round(t0 * SR);
  const n = Math.round(dur * SR);
  const gl = gain * (1 - Math.max(0, pan)) , gr = gain * (1 + Math.min(0, pan));
  for (let i = 0; i < n; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= L.length) continue;
    const t = i / SR;
    const e = pluckEnv(t, dur, 0.003, decay);
    if (e <= 0) continue;
    const p = hz * t;
    let v = wave.sine(p)
      + 0.32 * wave.sine(2 * p) * Math.exp(-t / (decay * 0.5))
      + 0.14 * wave.sine(3 * p) * Math.exp(-t / (decay * 0.35))
      + 0.08 * wave.sine(4.2 * p) * Math.exp(-t / (decay * 0.2));
    if (bright > 0) v += bright * 0.22 * wave.sine(2 * p) * Math.exp(-t / (decay * 0.6));
    v *= e;
    L[idx] += v * gl; R[idx] += v * gr;
  }
}

/** 서브 베이스 — 사인 + 아주 약한 3배음(작은 스피커에서 근음이 들리게) */
function renderBass(L, R, ev) {
  const { t0, dur, hz, gain, decay = 0.3 } = ev;
  const i0 = Math.round(t0 * SR);
  const n = Math.round(dur * SR);
  for (let i = 0; i < n; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= L.length) continue;
    const t = i / SR;
    const e = pluckEnv(t, dur, 0.008, decay);
    const v = (wave.sine(hz * t) + 0.12 * wave.sine(3 * hz * t)) * e * gain;
    L[idx] += v; R[idx] += v;
  }
}

/**
 * 필터 스윕 신스(preset C 아르페지오). 사각파를 **그대로 쓰지 않고**
 * 디튠 2보이스 + SVF 로우패스로 깎는다 — 원음 그대로면 8bit 로 들린다.
 */
function renderSweepSynth(L, R, ev) {
  const { t0, dur, hz, gain, cutoffHz, pan = 0, decay = 0.18 } = ev;
  const i0 = Math.round(t0 * SR);
  const n = Math.round(dur * SR);
  const svf = makeSVF();
  const gl = gain * (1 - Math.max(0, pan)), gr = gain * (1 + Math.min(0, pan));
  for (let i = 0; i < n; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= L.length) continue;
    const t = i / SR;
    const e = pluckEnv(t, dur, 0.002, decay);
    if (e <= 0) continue;
    const raw = 0.5 * wave.square(hz * t) + 0.5 * wave.square(hz * 1.005 * t + 0.31);
    const v = svf(raw, cutoffHz, 1.6).low * e;
    L[idx] += v * gl; R[idx] += v * gr;
  }
}

/** 기타 스트럼 — 같은 화음의 음을 staggerSec 씩 어긋나게 친 플럭 묶음 */
function renderStrum(L, R, { t0, notes, gain, stagger = 0.014, dur = 1.2, decay = 0.6, pan = 0, bright = 0 }) {
  notes.forEach((n, k) => {
    renderPluck(L, R, {
      t0: t0 + k * stagger, dur, hz: midiHz(n),
      gain: gain * (1 - k * 0.07), pan, decay, bright,
    });
  });
}

/** 패드 — 사인+삼각 3음, 아주 느린 디튠 비트. 뒤에 「얇게」 깔린다 */
function renderPad(L, R, { t0, dur, notes, gain, bright = 0, cutoffHz = 3500 }) {
  const i0 = Math.round(t0 * SR);
  const n = Math.round(dur * SR);
  const svfL = makeSVF(), svfR = makeSVF();
  for (let i = 0; i < n; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= L.length) continue;
    const t = i / SR;
    const e = padEnv(t, dur, 0.4, 0.7);
    if (e <= 0) continue;
    let l = 0, r = 0;
    for (const m of notes) {
      const hz = midiHz(m);
      l += 0.6 * wave.sine((hz - 0.3) * (t0 + t)) + 0.14 * wave.tri((hz - 0.3) * (t0 + t));
      r += 0.6 * wave.sine((hz + 0.3) * (t0 + t)) + 0.14 * wave.tri((hz + 0.3) * (t0 + t));
      if (bright > 0) {
        l += bright * 0.18 * wave.sine(hz * 2 * (t0 + t));
        r += bright * 0.18 * wave.sine(hz * 2 * (t0 + t) + 0.7);
      }
    }
    L[idx] += svfL(l, cutoffHz, 0.8).low * e * gain;
    R[idx] += svfR(r, cutoffHz, 0.8).low * e * gain;
  }
}

/** 킥 — 사인 피치 스윕(60→40 Hz). 「소프트」라 클릭을 넣지 않는다 */
function renderKick(L, R, { t0, gain = 0.9, f0 = 60, f1 = 40, dur = 0.24 }) {
  const i0 = Math.round(t0 * SR);
  const n = Math.round(dur * SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= L.length) continue;
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / 0.035);
    phase += f / SR;
    const e = Math.exp(-t / 0.075) * (t < 0.002 ? t / 0.002 : 1);
    const v = wave.sine(phase) * e * gain;
    L[idx] += v; R[idx] += v;
  }
}

/** 클로즈드 햇 — 화이트노이즈 하이패스 6 kHz, 30 ms */
function renderHat(L, R, { t0, gain = 0.16, dur = 0.05, hp = 6000, decay = 0.018, pan = 0 }, noise) {
  const i0 = Math.round(t0 * SR);
  const n = Math.round(dur * SR);
  const f = makeHP(hp);
  const gl = gain * (1 - Math.max(0, pan)), gr = gain * (1 + Math.min(0, pan));
  for (let i = 0; i < n; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= L.length) continue;
    const v = f(noise()) * Math.exp(-(i / SR) / decay);
    L[idx] += v * gl; R[idx] += v * gr;
  }
}

/** 사이드스틱/손뼉/셰이커 — 대역 제한 노이즈 버스트(centerHz 로 성격이 갈린다) */
function renderNoiseHit(L, R, { t0, gain = 0.2, dur = 0.12, centerHz = 1500, q = 2.2, decay = 0.035, pan = 0, spread = 0 }, noise) {
  const i0 = Math.round(t0 * SR);
  const n = Math.round(dur * SR);
  const svf = makeSVF();
  const gl = gain * (1 - Math.max(0, pan)), gr = gain * (1 + Math.min(0, pan));
  for (let i = 0; i < n; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= L.length) continue;
    const t = i / SR;
    // spread>0 이면 여러 사람이 친 손뼉처럼 시작이 흩어진다
    const on = spread > 0 ? Math.min(1, t / spread) : 1;
    const v = svf(noise(), centerHz, q).band * Math.exp(-t / decay) * on;
    L[idx] += v * gl; R[idx] += v * gr;
  }
}

/* ────────────────────────────── 곡 구조 ────────────────────────────── */

/** 화음 진행은 전부 **장조 I–V–vi–IV** (밝고 상승감 있는 팝 표준) */
const PROG = {
  // D 장조: D – A – Bm – G
  a: [
    { root: 50, triad: [50, 54, 57] },
    { root: 45, triad: [49, 52, 57] },
    { root: 47, triad: [47, 50, 54] },
    { root: 43, triad: [47, 50, 55] },
  ],
  // G 장조: G – D – Em – C
  b: [
    { root: 43, triad: [55, 59, 62, 67] },
    { root: 38, triad: [54, 57, 62, 66] },
    { root: 40, triad: [52, 55, 59, 64] },
    { root: 36, triad: [52, 55, 60, 64] },
  ],
  // A 장조: A – E – F#m – D
  c: [
    { root: 45, triad: [57, 61, 64] },
    { root: 40, triad: [56, 59, 64] },
    { root: 42, triad: [54, 57, 61] },
    { root: 38, triad: [54, 57, 62] },
  ],
};

export const PRESETS = {
  /** A 업비트 코퍼레이트 — 플럭 아르페지오 + 소프트 킥/햇. 가장 「광고」다운 톤 */
  a: {
    id: "a",
    label: "업비트 코퍼레이트",
    bpm: 118,
    key: "D 장조",
    prog: "a",
    lowpassHz: 12000,
    reverb: "aecho=0.8:0.75:45|110:0.20|0.11",
    lufs: -17,
    truePeak: -1.5,
  },
  /** B 라이트 팝/포크 — 기타 스트럼 + 손뼉/셰이커 + 펜타토닉 모티프 */
  b: {
    id: "b",
    label: "라이트 팝·포크",
    bpm: 104,
    key: "G 장조",
    prog: "b",
    lowpassHz: 11000,
    reverb: "aecho=0.8:0.7:70|150:0.22|0.12",
    lufs: -17,
    truePeak: -1.5,
  },
  /** C 미니멀 테크 — 16분 아르페지오 + 필터 스윕 + 사이드체인 펌핑 패드 */
  c: {
    id: "c",
    label: "미니멀 테크",
    bpm: 122,
    key: "A 장조",
    prog: "c",
    lowpassHz: 13000,
    reverb: "aecho=0.75:0.7:35|90:0.16|0.09",
    lufs: -17,
    truePeak: -1.5,
  },
  /** 현행(2026-09-21 「장례식」 판정본) — 비교용으로 남긴다. 본편 track.mp3 가 이것이다 */
  pad: {
    id: "pad",
    label: "현행 앰비언트 패드(장송곡 판정)",
    bpm: 92,
    key: "F 장조",
    prog: "legacy",
    lowpassHz: 1600,
    reverb: "aecho=0.85:0.8:60|140|230:0.28|0.18|0.10",
    lufs: -20,
    truePeak: -2,
  },
};

/** 「장송곡 금지」 규약 — 프리셋이 이 하한을 지키는지 기계로 본다 */
export function checkNotFuneral(p) {
  const fails = [];
  if (p.bpm < 100) fails.push(`템포 ${p.bpm} < 100 BPM`);
  if (!/장조/.test(p.key)) fails.push(`조성 ${p.key} 이 장조가 아니다`);
  if (p.lowpassHz < 5000) fails.push(`로우패스 ${p.lowpassHz} < 5000 Hz`);
  return { ok: fails.length === 0, fails };
}

/**
 * CTA 상승 레이어 — **마지막 CTA_LIFT_SEC 초**에 한 옥타브 위가 들어온다.
 *
 * 🔴 2026-09-21 레인 I: 예전에는 `BRIGHTEN_FROM = 52` 상수였다. 본편이 60초일 때만 맞는
 *    숫자라 장면 길이를 나레이션 실측에서 산출하게 되면서(총길이 가변) 깨진다.
 *    이제 **총길이에서 파생**한다 — `--seconds` 가 62든 68이든 상승은 늘 끝 8초다.
 *
 * 미리듣기(20초)에는 상승을 넣지 않는다: 도입부만 들려주는 용도이고, 20초짜리에
 * 「끝 8초 상승」을 넣으면 후보 비교가 본편과 달라진다. 그래서 MIN_FULL_SEC 미만은 0.
 */
const CTA_LIFT_SEC = 8;
const MIN_FULL_SEC = 40;
const FADE_IN = 1.0;
const FADE_TAIL = 1.5;

/** 상승이 시작되는 시각(초). 짧은 미리듣기면 Infinity = 상승 없음 */
export const brightenFrom = (seconds) => (seconds < MIN_FULL_SEC ? Infinity : seconds - CTA_LIFT_SEC);

/** 해당 시각의 밝기(0~1) — CTA 에서 위 옥타브가 들어오는 정도 */
const brightAt = (t, seconds) => {
  const from = brightenFrom(seconds);
  if (!Number.isFinite(from) || from >= seconds) return 0;
  const x = Math.min(1, Math.max(0, (t - from) / 2.5));
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
};

/* ── A 업비트 코퍼레이트 ── */
function composeA(L, R, seconds) {
  const p = PRESETS.a;
  const beat = 60 / p.bpm;
  const bar = beat * 4;
  const prog = PROG[p.prog];
  const noise = makeNoise(0xA11CE);
  const nBars = Math.ceil((seconds + 1) / bar);

  for (let b = 0; b < nBars; b++) {
    const t0 = b * bar;
    if (t0 > seconds) break;
    const ch = prog[b % prog.length];
    const br = brightAt(t0, seconds);
    // 아르페지오 8분음 8개 — 근음·3음·5음·8도 를 올라갔다 내려온다
    const arp = [0, 1, 2, 3, 2, 1, 2, 3];
    for (let e = 0; e < 8; e++) {
      const t = t0 + e * beat / 2;
      if (t > seconds) break;
      const deg = arp[e];
      const note = (deg === 3 ? ch.triad[0] + 12 : ch.triad[deg]) + 12;
      renderPluck(L, R, {
        t0: t, dur: beat * 0.55, hz: midiHz(note),
        gain: e % 2 === 0 ? 0.30 : 0.22, pan: e % 2 === 0 ? -0.25 : 0.25,
        decay: 0.20, bright: br,
      });
      if (br > 0.05) {
        renderPluck(L, R, { t0: t, dur: beat * 0.4, hz: midiHz(note + 12), gain: 0.10 * br, pan: 0.15, decay: 0.14 });
      }
      // 서브 베이스 8분음
      renderBass(L, R, { t0: t, dur: beat * 0.45, hz: midiHz(ch.root - 12), gain: 0.42, decay: 0.16 });
    }
    // 드럼 — 킥 1·3박, 사이드스틱 2·4박, 햇 8분음 전부
    for (const k of [0, 2]) renderKick(L, R, { t0: t0 + k * beat, gain: 0.85 });
    for (const s of [1, 3]) renderNoiseHit(L, R, { t0: t0 + s * beat, gain: 0.17, centerHz: 1900, q: 3.0, decay: 0.03 }, noise);
    for (let h = 0; h < 8; h++) {
      renderHat(L, R, { t0: t0 + h * beat / 2, gain: h % 2 === 0 ? 0.11 : 0.07, pan: 0.2 }, noise);
    }
    // 얇은 패드
    renderPad(L, R, { t0, dur: bar * 1.02, notes: ch.triad.map((n) => n + 12), gain: 0.10, bright: br, cutoffHz: 4200 });
  }
}

/* ── B 라이트 팝·포크 ── */
function composeB(L, R, seconds) {
  const p = PRESETS.b;
  const beat = 60 / p.bpm;
  const bar = beat * 4;
  const prog = PROG[p.prog];
  const noise = makeNoise(0xB0B);
  const nBars = Math.ceil((seconds + 1) / bar);
  // 2마디 펜타토닉 모티프(G 펜타토닉) — 짝수 마디쌍마다 변주
  const MOTIF = [
    [{ b: 0, n: 74 }, { b: 1, n: 71 }, { b: 1.5, n: 69 }, { b: 2, n: 67 }, { b: 3, n: 69 }],
    [{ b: 0, n: 71 }, { b: 0.5, n: 74 }, { b: 1.5, n: 76 }, { b: 2.5, n: 74 }, { b: 3, n: 71 }],
  ];

  for (let b = 0; b < nBars; b++) {
    const t0 = b * bar;
    if (t0 > seconds) break;
    const ch = prog[b % prog.length];
    const br = brightAt(t0, seconds);
    // 스트럼 패턴: 다운(1) · 다운(2.5) · 업(3) · 다운(4) — 4분+8분 혼합
    const strums = [
      { at: 0, g: 0.26, up: false }, { at: 1.5, g: 0.17, up: true },
      { at: 2, g: 0.23, up: false }, { at: 2.5, g: 0.15, up: true },
      { at: 3, g: 0.20, up: false }, { at: 3.5, g: 0.14, up: true },
    ];
    for (const s of strums) {
      const t = t0 + s.at * beat;
      if (t > seconds) break;
      const notes = s.up ? [...ch.triad].reverse() : ch.triad;
      renderStrum(L, R, {
        t0: t, notes, gain: s.g, stagger: s.up ? 0.010 : 0.016,
        dur: beat * 1.6, decay: 0.45, pan: s.up ? 0.18 : -0.18, bright: br,
      });
    }
    // 베이스 — 1박 근음, 3박 5도
    renderBass(L, R, { t0, dur: beat * 0.9, hz: midiHz(ch.root), gain: 0.40, decay: 0.34 });
    renderBass(L, R, { t0: t0 + 2 * beat, dur: beat * 0.9, hz: midiHz(ch.root + 7), gain: 0.32, decay: 0.30 });
    // 손뼉 2·4박 + 셰이커 8분음
    for (const c of [1, 3]) {
      renderNoiseHit(L, R, { t0: t0 + c * beat, gain: 0.20, centerHz: 1500, q: 1.6, decay: 0.045, spread: 0.012 }, noise);
    }
    for (let h = 0; h < 8; h++) {
      renderHat(L, R, { t0: t0 + h * beat / 2, gain: h % 2 === 0 ? 0.075 : 0.05, hp: 8000, decay: 0.012, pan: -0.15 }, noise);
    }
    // 멜로디 — 2마디 모티프
    const motif = MOTIF[Math.floor(b / 2) % MOTIF.length];
    if (b % 2 === 0) {
      for (const m of motif) {
        const t = t0 + m.b * beat;
        if (t > seconds) break;
        renderPluck(L, R, { t0: t, dur: beat * 0.9, hz: midiHz(m.n), gain: 0.16, decay: 0.42, pan: 0.1, bright: br });
        if (br > 0.05) renderPluck(L, R, { t0: t, dur: beat * 0.7, hz: midiHz(m.n + 12), gain: 0.07 * br, decay: 0.3 });
      }
    }
    renderPad(L, R, { t0, dur: bar * 1.02, notes: ch.triad.slice(0, 3), gain: 0.08, bright: br, cutoffHz: 3800 });
  }
}

/* ── C 미니멀 테크 ── */
function composeC(L, R, seconds) {
  const p = PRESETS.c;
  const beat = 60 / p.bpm;
  const bar = beat * 4;
  const prog = PROG[p.prog];
  const noise = makeNoise(0xC0FFEE);
  const nBars = Math.ceil((seconds + 1) / bar);
  const sweepBars = 8; // 컷오프 1 → 5 kHz 를 8마디 주기로

  // 킥 시각을 모아 두었다가 패드 펌핑(사이드체인 느낌)에 쓴다
  const kicks = [];

  for (let b = 0; b < nBars; b++) {
    const t0 = b * bar;
    if (t0 > seconds) break;
    const ch = prog[b % prog.length];
    const br = brightAt(t0, seconds);
    const phase = (b % sweepBars) / sweepBars;
    const cutoff = 1000 + 4000 * (0.5 - 0.5 * Math.cos(TAU * phase)); // 1k↔5k 왕복

    // 16분 아르페지오
    const arp = [0, 1, 2, 3];
    for (let e = 0; e < 16; e++) {
      const t = t0 + e * beat / 4;
      if (t > seconds) break;
      const deg = arp[e % 4];
      const note = (deg === 3 ? ch.triad[0] + 12 : ch.triad[deg]) + 12;
      renderSweepSynth(L, R, {
        t0: t, dur: beat * 0.3, hz: midiHz(note),
        gain: e % 4 === 0 ? 0.16 : 0.11,
        cutoffHz: cutoff + (br > 0 ? 2500 * br : 0),
        pan: e % 2 === 0 ? -0.2 : 0.2, decay: 0.09,
      });
    }
    // 베이스 4분음
    for (let q = 0; q < 4; q++) {
      renderBass(L, R, { t0: t0 + q * beat, dur: beat * 0.7, hz: midiHz(ch.root - 12), gain: 0.40, decay: 0.22 });
    }
    // 드럼 — 4온더플로어 킥 + 오프비트 햇
    for (let q = 0; q < 4; q++) {
      const kt = t0 + q * beat;
      renderKick(L, R, { t0: kt, gain: 0.80, f0: 58, f1: 42 });
      kicks.push(kt);
      renderHat(L, R, { t0: kt + beat / 2, gain: 0.13, hp: 7000, decay: 0.016, pan: q % 2 ? 0.25 : -0.25 }, noise);
      renderHat(L, R, { t0: kt + beat * 0.75, gain: 0.06, hp: 9000, decay: 0.010 }, noise);
    }
    if (br > 0.05) {
      // CTA — 한 옥타브 위 레이어
      for (let e = 0; e < 8; e++) {
        const t = t0 + e * beat / 2;
        if (t > seconds) break;
        renderPluck(L, R, { t0: t, dur: beat * 0.4, hz: midiHz(ch.triad[e % 3] + 24), gain: 0.10 * br, decay: 0.13, pan: 0.2 });
      }
    }
  }

  // 펌핑 패드 — 킥 직후 눌렸다가 되돌아온다
  const padL = new Float32Array(L.length), padR = new Float32Array(R.length);
  for (let b = 0; b < nBars; b++) {
    const t0 = b * bar;
    if (t0 > seconds) break;
    const ch = prog[b % prog.length];
    renderPad(padL, padR, { t0, dur: bar * 1.02, notes: ch.triad, gain: 0.26, bright: brightAt(t0, seconds), cutoffHz: 5200 });
  }
  let ki = 0;
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    while (ki + 1 < kicks.length && kicks[ki + 1] <= t) ki++;
    const since = t - (kicks[ki] ?? -10);
    const duck = since >= 0 && since < 0.45 ? 1 - 0.62 * Math.exp(-since / 0.13) : 1;
    L[i] += padL[i] * duck;
    R[i] += padR[i] * duck;
  }
}

/* ── 현행 패드(비교용, 이전 버전 그대로) ── */
function composeLegacy(L, R, seconds) {
  const HZ = { F2: 87.31, C3: 130.81, D3: 146.83, Bb2: 116.54, F3: 174.61, A3: 220.0, C4: 261.63, E3: 164.81, G3: 196.0, Bb3: 233.08 };
  const CH = [
    { bass: HZ.F2, triad: [HZ.F3, HZ.A3, HZ.C4] },
    { bass: HZ.C3, triad: [HZ.C3 * 2, HZ.E3, HZ.G3] },
    { bass: HZ.D3 / 2, triad: [HZ.D3, HZ.F3, HZ.A3] },
    { bass: HZ.Bb2, triad: [HZ.Bb3, HZ.D3 * 2, HZ.F3] },
  ];
  const chordSec = 4, crossfadeSec = 1.2, pulseEvery = (60 / 92) * 2;
  const smooth = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  const smp = (c, t, d, bright) => {
    let v = 0.5 * Math.sin(TAU * c.bass * t);
    for (const f of c.triad) {
      const ph = TAU * (f + d) * t;
      v += 0.26 * Math.sin(ph) + 0.06 * wave.tri(ph / TAU);
      if (bright > 0) v += bright * 0.09 * Math.sin(TAU * (f * 2 + d) * t);
    }
    return v;
  };
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    const ci = Math.floor(t / chordSec);
    const into = t - ci * chordSec;
    const cur = CH[ci % CH.length], prev = CH[(ci - 1 + CH.length * 2) % CH.length];
    const w = into < crossfadeSec && ci > 0 ? smooth(into / crossfadeSec) : 1;
    const bright = brightAt(t, seconds);
    const lfo = 1 + 0.07 * Math.sin(TAU * 0.06 * t);
    let l = smp(cur, t, -0.35, bright) * w * lfo, r = smp(cur, t, 0.35, bright) * w * lfo;
    if (w < 1) { l += smp(prev, t, -0.35, bright) * (1 - w) * lfo; r += smp(prev, t, 0.35, bright) * (1 - w) * lfo; }
    const sp = t % pulseEvery;
    if (sp < 0.18) { const pv = 0.07 * Math.exp(-sp / 0.05) * Math.sin(TAU * cur.bass * 2 * t); l += pv; r += pv; }
    L[i] += l; R[i] += r;
  }
}

const COMPOSERS = { a: composeA, b: composeB, c: composeC, pad: composeLegacy };

/* ────────────────────────────── 렌더·마스터 ────────────────────────────── */

export function writeWav(outWav, L, R, sampleRate = SR) {
  const n = L.length;
  const pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * 32767))), i * 4);
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * 32767))), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 4, 28);
  h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  fs.writeFileSync(outWav, Buffer.concat([h, pcm]));
  return outWav;
}

/**
 * 프리셋 한 개를 seconds 초 길이의 WAV 로 합성한다.
 * 🔴 리미터 없이 파트를 합치면 클리핑한다 — 정규화 후 소프트클립을 반드시 통과시킨다.
 */
export function synthWav(outWav, presetId = "a", seconds = 60) {
  const p = PRESETS[presetId];
  if (!p) throw new Error(`모르는 프리셋: ${presetId}`);
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  COMPOSERS[presetId](L, R, seconds);

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = peak > 0 ? 0.92 / peak : 1;
  for (let i = 0; i < n; i++) {
    L[i] = softClip(L[i] * g) * 0.82;
    R[i] = softClip(R[i] * g) * 0.82;
  }
  writeWav(outWav, L, R);
  return outWav;
}

const ff = (args) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

export function measureEbur128(file) {
  const { out } = ff(["-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const tail = out.slice(out.lastIndexOf("Summary:"));
  const num = (label) => {
    const m = new RegExp(`${label}:\\s*(-?[\\d.]+|-inf)`).exec(tail);
    return m ? (m[1] === "-inf" ? -Infinity : Number(m[1])) : NaN;
  };
  return { I: num("I"), LRA: num("LRA"), TP: num("Peak") };
}

/** 로우패스 → 잔향 → 페이드 → 라우드니스 정합 → 인코딩 */
export function master(inWav, outFile, presetId = "a", seconds = 60) {
  const p = PRESETS[presetId];
  const tmp = `${outFile}.mastered.wav`;
  const shaped = [
    `lowpass=f=${p.lowpassHz}:poles=2`,
    p.reverb,
    `afade=t=in:st=0:d=${FADE_IN}`,
    `afade=t=out:st=${Math.max(0, seconds - FADE_TAIL)}:d=${FADE_TAIL}`,
  ].join(",");
  let r = ff(["-y", "-i", inWav, "-af", shaped, "-ar", String(SR), "-c:a", "pcm_s16le", tmp]);
  if (r.status !== 0) throw new Error(`ffmpeg(shape) 실패: ${r.out.slice(-800)}`);

  const before = measureEbur128(tmp).I;
  const gainDb = Number.isFinite(before) ? Math.round((p.lufs - before) * 100) / 100 : 0;
  const limit = Math.pow(10, p.truePeak / 20).toFixed(4);
  const enc = outFile.endsWith(".wav")
    ? ["-c:a", "pcm_s16le"]
    : ["-b:a", "192k"];
  r = ff(["-y", "-i", tmp, "-af", `volume=${gainDb}dB,alimiter=limit=${limit}:level=false`, "-ar", String(SR), ...enc, outFile]);
  if (r.status !== 0) throw new Error(`ffmpeg(level) 실패: ${r.out.slice(-800)}`);
  fs.rmSync(tmp, { force: true });
  return { outFile, gainDb, lufsBefore: before, ...measureEbur128(outFile) };
}

export function spectrum(inFile, outPng) {
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  const r = ff(["-y", "-i", inFile, "-lavfi", "showspectrumpic=s=1200x500:mode=separate:legend=1", outPng]);
  if (r.status !== 0) throw new Error(`ffmpeg(spectrum) 실패: ${r.out.slice(-800)}`);
  return outPng;
}

/* ────────────────────────────── 객관 지표 ────────────────────────────── */

/** 모노 float32 로 디코드 — ffmpeg 이 stdout 으로 raw PCM 을 준다 */
function decodeMono(file, sr = SR) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-ac", "1", "-ar", String(sr), "-f", "f32le", "-"],
    { maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`디코드 실패: ${file}`);
  const buf = r.stdout;
  const n = Math.floor(buf.length / 4);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

/** 반복 radix-2 FFT(제자리). re/im 길이는 2의 거듭제곱 */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/**
 * 스펙트럼 지표 — 중심주파수 · 4 kHz 위 에너지 비율 · 온셋 밀도.
 *
 * 🔴 오판 정정 2건(2026-09-21, 첫 구현이 후보를 구분하지 못했다)
 *  ① 중심주파수를 **파워**(mag²) 가중으로 재면 베이스·킥이 압도해 어떤 곡이든 110~130 Hz 로
 *     수렴한다(현재본 129 · 후보 A 130 — 구분 불가). 표준 정의대로 **크기(mag)** 가중으로 잰다.
 *  ② 온셋을 플럭스의 「지역 중앙값 × 1.6」으로 잡으면 패드처럼 거의 정적인 신호에서도
 *     미세한 요동이 전부 피크로 걸린다(현재본이 11.9/초로 후보보다 높게 나왔다 — 명백한 오판).
 *     타악은 **직전 프레임 대비 에너지가 큰 비율로 튄다**는 성질을 쓴다 →
 *     정규화 플럭스 = flux / (직전 프레임 크기합). 패드는 이 값이 0.05 를 못 넘고,
 *     킥·플럭·햇은 0.3 을 쉽게 넘는다.
 */
export function analyze(file) {
  const x = decodeMono(file);
  const N = 2048, HOP = 512;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(TAU * i / (N - 1));
  const nFrames = Math.max(1, Math.floor((x.length - N) / HOP));
  const binHz = SR / N;
  const hiBin = Math.ceil(4000 / binHz);

  let sumW = 0, sumM = 0, sumHi = 0;
  let prev = null, prevSum = 0;
  const nf = [];
  for (let f = 0; f < nFrames; f++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[f * HOP + i] * win[i];
    fft(re, im);
    const mag = new Float64Array(N / 2);
    let fsum = 0;
    for (let k = 1; k < N / 2; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      fsum += mag[k];
      sumM += mag[k]; sumW += mag[k] * k * binHz;
      if (k >= hiBin) sumHi += mag[k];
    }
    let fl = 0;
    if (prev) for (let k = 1; k < N / 2; k++) { const d = mag[k] - prev[k]; if (d > 0) fl += d; }
    nf.push(prevSum > 1e-9 ? fl / prevSum : 0);
    prev = mag; prevSum = fsum;
  }

  // 온셋 = 정규화 플럭스의 국소 최댓값이 0.30 을 넘는 지점(50 ms 이내 중복 제거)
  const frameSec = HOP / SR;
  const THRESH = 0.30;
  let onsets = 0, last = -1;
  for (let i = 1; i < nf.length - 1; i++) {
    if (nf[i] > nf[i - 1] && nf[i] >= nf[i + 1] && nf[i] > THRESH) {
      const t = i * frameSec;
      if (last < 0 || t - last > 0.05) { onsets++; last = t; }
    }
  }
  const durSec = x.length / SR;
  return {
    seconds: Math.round(durSec * 100) / 100,
    centroidHz: sumM > 0 ? Math.round(sumW / sumM) : 0,
    above4kRatio: sumM > 0 ? Math.round((sumHi / sumM) * 10000) / 100 : 0, // %
    onsetsPerSec: Math.round((onsets / Math.max(1, durSec)) * 10) / 10,
  };
}

/* ────────────────────────────── 후보 만들기 ────────────────────────────── */

const CHECK = path.join(ROOT, "out", "check");

export function buildCandidates({ previewSec = 20, ids = ["a", "b", "c"] } = {}) {
  fs.mkdirSync(CHECK, { recursive: true });
  const rows = [];
  const previews = [];

  for (const id of ids) {
    const p = PRESETS[id];
    const raw = path.join(CHECK, `bgm-${id}-raw.wav`);
    const mp3 = path.join(CHECK, `bgm-${id}-preview.mp3`);
    // 🔴 미리듣기는 **도입부 20초**만 쓴다 — CTA 상승은 총길이 끝 8초에서 일어나므로
    //    (brightenFrom) 20초짜리에는 아예 들어가지 않는다. 밝아짐은 본편에서 확인한다.
    synthWav(raw, id, previewSec);
    const m = master(raw, mp3, id, previewSec);
    fs.rmSync(raw, { force: true });
    spectrum(mp3, path.join(CHECK, `bgm-${id}-spectrum.png`));
    const a = analyze(mp3);
    const g = checkNotFuneral(p);
    rows.push({ id, label: p.label, bpm: p.bpm, key: p.key, lowpassHz: p.lowpassHz, file: mp3, ...a, I: m.I, TP: m.TP, gate: g });
    previews.push(mp3);
  }

  // 현재본(본편 track.mp3) 은 그대로 잰다 — 새로 만들지 않는다
  const cur = path.join(BGM_DIR, "track.mp3");
  let curRow = null;
  if (fs.existsSync(cur)) {
    const a = analyze(cur);
    const e = measureEbur128(cur);
    const p = PRESETS.pad;
    curRow = { id: "현재", label: p.label, bpm: p.bpm, key: p.key, lowpassHz: p.lowpassHz, file: cur, ...a, I: e.I, TP: e.TP, gate: checkNotFuneral(p) };
  }

  // 합본 — 각 앞에 0.7초 무음, A→B→C
  const all = path.join(CHECK, "bgm-candidates-all.mp3");
  const inputs = previews.flatMap((f) => ["-i", f]);
  const parts = previews.map((_, i) => `[${i}:a]adelay=700|700,apad=pad_dur=0.3[p${i}]`).join(";");
  const concat = previews.map((_, i) => `[p${i}]`).join("") + `concat=n=${previews.length}:v=0:a=1[o]`;
  const r = ff(["-y", ...inputs, "-filter_complex", `${parts};${concat}`, "-map", "[o]", "-ar", String(SR), "-b:a", "192k", all]);
  if (r.status !== 0) throw new Error(`ffmpeg(concat) 실패: ${r.out.slice(-800)}`);

  const md = [
    "# BGM 후보 지표",
    "",
    `측정 ${new Date().toISOString()} · 미리듣기 ${previewSec}초 · 합성기 \`tools/make-bgm.mjs\``,
    "",
    "사용자 판정: 현재본은 **「장례식 같다」**. 아래 지표가 그 판정을 수치로 보여준다 —",
    "현재본은 템포가 느리고(92), 고역이 1.6 kHz 에서 잘려 중심주파수가 낮으며, 1초당 온셋이 사실상 0이다(리듬 요소 없음).",
    "",
    "| 후보 | 성격 | BPM(설계) | 조 | 로우패스 | 중심주파수 | 4 kHz↑ 에너지 | 온셋/초 | I (LUFS) | TP (dBTP) | 장송곡 게이트 |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...[...rows, ...(curRow ? [curRow] : [])].map((r) =>
      `| ${r.id.toUpperCase()} | ${r.label} | ${r.bpm} | ${r.key} | ${r.lowpassHz} Hz | ${r.centroidHz} Hz | ${r.above4kRatio} % | ${r.onsetsPerSec} | ${r.I} | ${r.TP} | ${r.gate.ok ? "통과" : "실패: " + r.gate.fails.join(" · ")} |`),
    "",
    "## 지표가 무엇인가",
    "",
    "- **중심주파수(spectral centroid)** — 스펙트럼 크기의 무게중심. 높을수록 밝게 들린다. 자체 FFT(2048/512, Hann).",
    "  🔴 파워(mag²) 가중으로 재면 베이스·킥이 압도해 어떤 곡이든 110~130 Hz 로 수렴한다 — 표준대로 크기(mag) 가중이다.",
    "- **4 kHz↑ 에너지** — 스펙트럼 크기 합 대비 4 kHz 위 비율. 「공기감」이 있는지. 현재본은 로우패스가 1.6 kHz 라 0 에 가깝다.",
    "- **온셋/초** — **정규화 스펙트럴 플럭스**(직전 프레임 크기합 대비 증가분)가 0.30 을 넘는 국소 피크 수 ÷ 길이.",
    "  「타악·플럭이 실제로 들리는지」의 대리 지표다. 정규화하지 않으면 패드의 미세한 요동까지 세어",
    "  현재본이 후보보다 높게 나온다(첫 구현의 오판: 현재본 11.9/초).",
    "- **장송곡 게이트** — `checkNotFuneral()`: 템포 ≥ 100 BPM · 장조 · 로우패스 ≥ 5 kHz.",
    "",
    "## 파일",
    "",
    ...[...rows].map((r) => `- **${r.id.toUpperCase()} ${r.label}** — \`${path.relative(ROOT, r.file).replace(/\\/g, "/")}\` · 스펙트럼 \`out/check/bgm-${r.id}-spectrum.png\``),
    `- **합본(A→B→C, 각 앞 0.7초 무음)** — \`${path.relative(ROOT, all).replace(/\\/g, "/")}\``,
    curRow ? `- 현재본 — \`${path.relative(ROOT, curRow.file).replace(/\\/g, "/")}\` (바꾸지 않았다)` : "",
    "",
    "## 공통 설계",
    "",
    "- 장조 I–V–vi–IV · 8분음 이상 리듬 요소 상시 · 로우패스 ≥ 11 kHz",
    "- 끝 8초(CTA)부터 한 옥타브 위 레이어가 들어와 밝아진다 — 시작 시각은 총길이에서 파생된다(미리듣기 20초에는 넣지 않는다).",
    "- 사각파는 원음 그대로 쓰지 않는다(디튠 2보이스 + SVF 로우패스) — 8bit 로 들리는 것을 막는다.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(CHECK, "bgm-candidates.md"), md, "utf8");
  return { rows, curRow, all, md: path.join(CHECK, "bgm-candidates.md") };
}

/* ────────────────────────────── CLI ────────────────────────────── */

/**
 * 본편 총길이(초) — `src/scene-durations.json` 이 정본이다(나레이션 실측 파생).
 * 파일이 없으면(음성 빌드 전) 스토리보드 60초로 떨어진다.
 */
export function mainSeconds() {
  const f = path.join(ROOT, "src", "scene-durations.json");
  if (!fs.existsSync(f)) return 60;
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  return typeof j.totalSec === "number" ? j.totalSec : 60;
}

function argOf(args, name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}

function main() {
  const args = process.argv.slice(2);
  fs.mkdirSync(BGM_DIR, { recursive: true });

  if (args.includes("--candidates")) {
    const res = buildCandidates({ previewSec: Number(argOf(args, "seconds", 20)) });
    console.table(res.rows.map(({ gate, file, ...r }) => ({ ...r, 게이트: gate.ok ? "통과" : gate.fails.join(";") })));
    if (res.curRow) console.log("현재본:", { centroidHz: res.curRow.centroidHz, above4kRatio: res.curRow.above4kRatio, onsetsPerSec: res.curRow.onsetsPerSec, I: res.curRow.I });
    console.log("합본 ->", res.all);
    console.log("표  ->", res.md);
    return;
  }

  const preset = argOf(args, "preset", "pad");
  // 🔴 기본 길이 = 본편 총길이(src/scene-durations.json). 60 하드코딩이 아니다 —
  //    장면 길이가 나레이션 실측에서 나오므로 총길이는 빌드마다 달라진다.
  const seconds = Number(argOf(args, "seconds", mainSeconds()));
  const out = path.resolve(ROOT, argOf(args, "out", path.join(BGM_DIR, "track.mp3")));
  const isTrack = path.resolve(out) === path.resolve(path.join(BGM_DIR, "track.mp3"));

  if (isTrack) {
    const wavUser = path.join(BGM_DIR, "track.wav");
    const userSupplied = (fs.existsSync(out) || fs.existsSync(wavUser)) && !fs.existsSync(MARKER);
    if (userSupplied) {
      console.log("사용자 라이선스 음원이 public/bgm 에 있다 — 합성하지 않는다.");
      console.log(fs.existsSync(wavUser) ? wavUser : out);
      return;
    }
    if (fs.existsSync(out) && !args.includes("--force")) {
      console.log(`이미 있다(합성본): ${out} — 다시 만들려면 --force`);
      return;
    }
  }

  const g = checkNotFuneral(PRESETS[preset]);
  if (!g.ok) console.warn(`⚠ 장송곡 게이트 실패(${preset}): ${g.fails.join(" · ")}`);

  const raw = path.join(CHECK, `bgm-${preset}-raw.wav`);
  synthWav(raw, preset, seconds);
  const res = master(raw, out, preset, seconds);
  fs.rmSync(raw, { force: true });
  if (isTrack) {
    fs.writeFileSync(MARKER,
      `tools/make-bgm.mjs 가 합성한 파일이다. 사용자가 라이선스 음원을 넣으려면 이 마커를 지우고 track.mp3|wav 를 놓는다.\n프리셋: ${preset}\n생성: ${new Date().toISOString()}\n`,
      "utf8");
  }
  console.log(res);
  console.log("지표:", analyze(out));
  if (args.includes("--spectrum")) console.log(spectrum(out, path.join(CHECK, `bgm-${preset}-spectrum.png`)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
