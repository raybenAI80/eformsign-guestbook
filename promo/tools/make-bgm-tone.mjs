#!/usr/bin/env node
/**
 * BGM 합성기 — Tone.js 엔진 (v3.3 레인 U, 2026-09-30 사용자 지시 「Tone.js 도 사용하고」).
 *
 *   node tools/make-bgm-tone.mjs --preset a --force        본편 트랙(public/bgm/track.mp3) 교체
 *   node tools/make-bgm-tone.mjs --preview                 20초 미리듣기 + 스펙트럼 + 두 엔진 A/B 표
 *   node tools/make-bgm-tone.mjs --determinism             같은 입력 2회 렌더 → 샘플 최대 차이 ≤ -100 dBFS(exit 1 = 비결정)
 *   node tools/make-bgm.mjs --engine tone --preset a --force   (같은 일 — 기존 CLI 에서 엔진만 고른다)
 *
 * 왜 이 구조인가
 *   🔴 Remotion 렌더는 Web Audio 를 캡처하지 않는다. Tone.js 는 **빌드 단계**에서 `Tone.Offline` 로
 *      WAV 를 미리 만들고, 기존 파일명(public/bgm/track.mp3)으로 내보내 `<Audio>`(src/audio.tsx)가
 *      그대로 읽게 한다 — audio.tsx 는 손대지 않는다.
 *   🔴 Tone.js 는 브라우저 Web Audio 위에서 돈다. Node 에서 실행하는 방법 두 가지 중
 *      **Remotion 이 이미 받아 둔 chrome-headless-shell** 을 CDP 로 띄우는 쪽을 골랐다.
 *      - node-web-audio-api(네이티브 모듈)는 새 바이너리 의존 + Tone 의 전역 window 가정을 흉내내야 한다.
 *      - 헤드리스 Chrome 은 추가 설치가 없고(Remotion 렌더와 같은 브라우저), 실제 Web Audio 구현 그대로다.
 *   🔴 결정성: Tone 의 노이즈 버퍼·Reverb 임펄스는 `Math.random` 으로 만든다. Tone 을 올리기 **전에**
 *      Math.random 을 시드 고정 PRNG(mulberry32)로 바꾼다. 검증 = `--determinism`(2회 렌더 샘플 차이 ≤ -100 dBFS — 비트 동일은 안 된다, determinism() 참조).
 *   라우드니스 정규화·페이드·인코딩은 기존 make-bgm.mjs 의 `master()`(ffmpeg) 를 그대로 쓴다.
 *   잔향·로우패스는 Tone 그래프 안에서 하므로 master 의 ffmpeg 잔향·로우패스는 끈다(`ffmpegFx:false`).
 *
 * 음악 설계 = 프리셋 A(사용자 확정) 그대로: 118 BPM · D장조 I–V–vi–IV(D–A–Bm–G) ·
 *   플럭(마림바계) 8분 아르페지오 [근·3·5·8·5·3·5·8] · 소프트 킥 1·3박 · 사이드스틱 2·4박 ·
 *   클로즈드 햇 8분 · 서브베이스 8분 · 얇은 패드 · 끝 8초(brightenFrom) 한 옥타브 위 레이어.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRESETS, checkNotFuneral, brightenFrom, writeWav, master, analyze, spectrum, mainSeconds, synthWav,
} from "./make-bgm.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = path.join(ROOT, "out", "check");
const BGM_DIR = path.join(ROOT, "public", "bgm");
const MARKER = path.join(BGM_DIR, ".synthesized");
export const SR = 48000;
export const SEED = 0xA11CE;

/* ────────────────────────────── Tone.Offline 러너 (CDP) ────────────────────────────── */

const TONE_JS = path.join(ROOT, "node_modules", "tone", "build", "Tone.js");
const CHROME = path.join(ROOT, "node_modules", ".remotion", "chrome-headless-shell",
  "win64", "chrome-headless-shell-win64", "chrome-headless-shell.exe");

export function toneVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", "tone", "package.json"), "utf8")).version;
}

function findChrome() {
  if (process.env.TONE_CHROME && fs.existsSync(process.env.TONE_CHROME)) return process.env.TONE_CHROME;
  if (fs.existsSync(CHROME)) return CHROME;
  // 다른 OS 에서 Remotion 이 받은 위치
  const base = path.join(ROOT, "node_modules", ".remotion", "chrome-headless-shell");
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base)) {
      const dir = path.join(base, d);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const sub of fs.readdirSync(dir)) {
        for (const exe of ["chrome-headless-shell.exe", "chrome-headless-shell"]) {
          const p = path.join(dir, sub, exe);
          if (fs.existsSync(p)) return p;
        }
      }
    }
  }
  throw new Error("chrome-headless-shell 을 찾지 못했다 — `npx remotion browser ensure` 로 받거나 TONE_CHROME 에 경로를 준다");
}

/** 헤드리스 셸을 띄우고 DevTools ws 주소를 받는다. 🔴 종료는 이 PID 만(이름 일괄 종료 금지) */
function launchChrome() {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "tone-offline-"));
  const proc = spawn(findChrome(), [
    "--remote-debugging-port=0", `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu",
    "--disable-extensions", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`헤드리스 Chrome 기동 시간 초과: ${buf.slice(-400)}`)), 30000);
    proc.stderr.on("data", (d) => {
      buf += d.toString();
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve({ proc, wsUrl: m[1], userDir }); }
    });
    proc.on("exit", (c) => { clearTimeout(timer); reject(new Error(`Chrome 종료(${c}): ${buf.slice(-400)}`)); });
  });
}

function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { ready, send, close: () => ws.close() };
}

/**
 * `composeFn(Tone, P)` 를 Tone.Offline 안에서 실행하고 채널별 Float32Array 를 돌려준다.
 * composeFn 은 **문자열화되어 브라우저로 간다** — 바깥 스코프 변수를 참조하면 안 된다(P 로만 받는다).
 */
export async function renderToneOffline(composeFn, P, { seconds, channels = 2, sampleRate = SR, seed = SEED } = {}) {
  const { proc, wsUrl, userDir } = await launchChrome();
  const cdp = cdpClient(wsUrl);
  try {
    await cdp.ready;
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(`브라우저 예외: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    // ① 시드 고정 — Tone 을 올리기 **전에** Math.random 을 바꾼다
    await ev(`(()=>{let a=${seed >>> 0};Math.random=function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};return true})()`);
    // ② Tone UMD
    await ev(fs.readFileSync(TONE_JS, "utf8") + "\n;typeof Tone");
    // ③ 오프라인 렌더
    const t0 = Date.now();
    const info = await ev(`(async()=>{
      const P=${JSON.stringify(P)};
      const compose=${composeFn.toString()};
      const buf=await Tone.Offline(async()=>{await compose(Tone,P);}, ${seconds}, ${channels}, ${sampleRate});
      window.__ch=[];for(let c=0;c<${channels};c++)window.__ch.push(buf.getChannelData(c));
      return {length:buf.length, sampleRate:buf.sampleRate, tone:Tone.version};
    })()`);
    const renderMs = Date.now() - t0;
    // ④ 청크로 회수(한 번에 수십 MB 를 CDP 로 넘기지 않는다)
    const CH = 1 << 19;
    const out = [];
    for (let c = 0; c < channels; c++) {
      const arr = new Float32Array(info.length);
      for (let off = 0; off < info.length; off += CH) {
        const b64 = await ev(`(()=>{const a=window.__ch[${c}].subarray(${off},${Math.min(info.length, off + CH)});
          const u=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);let s="";
          for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)})()`);
        const bytes = Buffer.from(b64, "base64");
        arr.set(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4), off);
      }
      out.push(arr);
    }
    return { channels: out, renderMs, tone: info.tone, sampleRate: info.sampleRate };
  } finally {
    cdp.close();
    try { proc.kill(); } catch { /* 이미 종료 */ }
    await new Promise((r) => setTimeout(r, 300));
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* 잠금 잔여는 무시 */ }
  }
}

/**
 * 피크 정규화 + 소프트클립(make-bgm.mjs synthWav 와 같은 단 — tanh(0.8x)/tanh(0.8), ×0.82) 후 16bit WAV.
 * 🔴 소프트클립 없이 피크만 맞추면 크레스트(피크−라우드니스)가 ~20 dB 라 ffmpeg alimiter 가 라우드니스를
 *    0.8~1 dB 깎아 I 가 -18 LUFS 하한까지 내려갔다(2026-09-30 실측). Tone.Limiter 는 DynamicsCompressor 라
 *    어택 3 ms 사이 과도 피크가 새어 +1.8 dBFS 까지 나왔다 — 그래서 Node 엔진과 같은 소프트클립을 쓴다.
 */
export function writeNormalized(outWav, chans, { soft = true } = {}) {
  let peak = 0;
  for (const ch of chans) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const g = peak > 0 ? 0.92 / peak : 1;
  const sc = (x) => Math.tanh(x * 0.8) / Math.tanh(0.8);
  const src = chans.length > 1 ? chans : [chans[0], chans[0]];
  const L = new Float32Array(src[0].length), R = new Float32Array(src[0].length);
  for (let i = 0; i < L.length; i++) {
    L[i] = soft ? sc(src[0][i] * g) * 0.82 : src[0][i] * g;
    R[i] = soft ? sc(src[1][i] * g) * 0.82 : src[1][i] * g;
  }
  writeWav(outWav, L, R, SR);
  return { peakBefore: peak, gain: g };
}

/* ────────────────────────────── 프리셋 A 작곡 (브라우저에서 실행) ────────────────────────────── */

/**
 * 🔴 이 함수는 toString() 으로 브라우저에 보내진다 — 바깥 식별자(import·상수) 참조 금지.
 * P = { seconds, bpm, prog:[{root,triad}], brightFrom, liftSec, lowpassHz }
 */
export async function composeToneA(Tone, P) {
  const beat = 60 / P.bpm;
  const bar = beat * 4;
  const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const dest = Tone.getDestination();

  // ── 마스터 버스: 로우패스 → 가벼운 글루 컴프 → 드라이브 +6 dB → 리미터
  // 🔴 드라이브 없이는 원시 피크가 -3.5 dBFS 라 리미터가 한 번도 안 물렸다 → 크레스트 19 dB 그대로
  //    ffmpeg alimiter 가 라우드니스를 0.8 dB 깎아 I 가 -17.8(하한 -18 근처)로 떨어졌다(2026-09-30 실측).
  const bus = new Tone.Gain(1);
  const drive = new Tone.Gain(Math.pow(10, 6 / 20));
  const lp = new Tone.Filter({ type: "lowpass", frequency: P.lowpassHz, rolloff: -12, Q: 0.5 });
  const glue = new Tone.Compressor({ threshold: -16, ratio: 2, attack: 0.012, release: 0.18, knee: 8 });
  const limiter = new Tone.Limiter(-1.5);
  bus.chain(lp, glue, drive, limiter, dest);

  // ── 센드: 짧은 룸 잔향 + 점8분 딜레이(8분음 아르페지오 사이를 메운다)
  const reverb = new Tone.Reverb({ decay: 1.6, preDelay: 0.015, wet: 1 });
  await reverb.ready;
  const revIn = new Tone.Gain(1).connect(reverb);
  reverb.connect(bus);
  const delay = new Tone.FeedbackDelay({ delayTime: beat * 0.75, feedback: 0.22, wet: 1 });
  const delayHp = new Tone.Filter({ type: "highpass", frequency: 500 });
  const delayIn = new Tone.Gain(1).chain(delayHp, delay);
  delay.connect(bus);

  /**
   * 고정 배정 보이스 풀 — 노트 i → 보이스 i % N. Tone.PolySynth 의 가용 보이스 탐색 대신
   * 배정을 코드로 못박아 둔다(보이스 수·배정이 렌더마다 같다는 걸 읽어서 확인할 수 있게).
   * 🔴 이걸로 **비트 동일은 되지 않는다** — 아래 「결정성」 절(--determinism) 참조.
   */
  const pool = (Voice, opts, n) => {
    const voices = Array.from({ length: n }, () => new Voice(opts));
    const out = new Tone.Gain(1);
    voices.forEach((v) => v.connect(out));
    let k = 0;
    return {
      connect: (d) => out.connect(d),
      chain: (...d) => out.chain(...d),
      triggerAttackRelease(freqs, dur, t, vel = 1) {
        for (const f of Array.isArray(freqs) ? freqs : [freqs]) voices[k++ % n].triggerAttackRelease(f, dur, t, vel);
      },
    };
  };

  /** 채널 스트립: 볼륨(dB) → 팬 → 버스 + 센드 */
  const strip = (node, { db = 0, pan = 0, rev = 0, dly = 0 } = {}) => {
    const vol = new Tone.Volume(db);
    const pn = new Tone.Panner(pan);
    node.chain(vol, pn, bus);
    if (rev > 0) pn.connect(new Tone.Gain(rev).connect(revIn));
    if (dly > 0) pn.connect(new Tone.Gain(dly).connect(delayIn));
    return { vol, pn };
  };

  // ── 플럭(마림바계): 정수배음 1·2·3 + 비정수 4.2배음(금속질)을 별도 보이스로
  const pluckOpts = {
    oscillator: { type: "custom", partials: [1, 0.32, 0.14] },
    envelope: { attack: 0.003, decay: 0.2, sustain: 0, release: 0.04 },
  };
  const pluckL = pool(Tone.Synth, pluckOpts, 4);
  const pluckR = pool(Tone.Synth, pluckOpts, 4);
  strip(pluckL, { db: -14, pan: -0.25, rev: 0.22, dly: 0.12 });
  strip(pluckR, { db: -14, pan: 0.25, rev: 0.22, dly: 0.12 });
  const tine = pool(Tone.Synth, {
    oscillator: { type: "sine" }, envelope: { attack: 0.002, decay: 0.04, sustain: 0, release: 0.02 },
  }, 2);
  strip(tine, { db: -30, pan: 0, rev: 0.1 });
  // 🔴 Tone.PluckSynth(카플러스-스트롱)는 쓰지 않는다 — 이 러너(헤드리스 Chrome + Tone.Offline)에서
  //    **완전 무음**이었다(2026-09-30 스템 단독 렌더 peak -inf). 내부 FeedbackCombFilter 가 AudioWorklet 인데
  //    오프라인 컨텍스트에서 워클릿이 준비되기 전에 렌더가 끝나는 것으로 본다(원인 미확정). 뜯는 어택은 tine 이 맡는다.

  // ── CTA 상승 레이어: 한 옥타브 위 플럭 + 패드 필터가 열린다(끝 8초, 2.5초 코사인)
  const liftGain = new Tone.Gain(0);
  const lift = pool(Tone.Synth, {
    oscillator: { type: "custom", partials: [1, 0.2] },
    envelope: { attack: 0.002, decay: 0.14, sustain: 0, release: 0.03 },
  }, 3);
  lift.connect(liftGain);
  strip(liftGain, { db: -18, pan: 0.15, rev: 0.3, dly: 0.2 });

  // ── 서브베이스: 사인 + 약한 3배음
  const bass = pool(Tone.Synth, {
    oscillator: { type: "custom", partials: [1, 0, 0.12] },
    envelope: { attack: 0.008, decay: 0.16, sustain: 0, release: 0.05 },
  }, 2);
  strip(bass, { db: -13.5 });

  // ── 소프트 킥: 60→40 Hz 스윕, 클릭 없음
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.035, octaves: Math.log2(60 / 40),
    oscillator: { type: "sine" },
    envelope: { attack: 0.002, decay: 0.13, sustain: 0, release: 0.05 },
  });
  // 🔴 킥·베이스가 무가중 RMS 를 지배한다(스템 단독 RMS 각 -20.6 dB, 플럭 -23.8). RMS 가 LUFS 보다 높으면
  //    check-mix 의 나레이션 분리도(무가중 RMS 기준 ≥12 dB)가 깨진다 — 11.9 dB 로 떨어졌던 첫 버전의 원인.
  strip(kick, { db: -7 });

  // ── 사이드스틱: 화이트노이즈 → 대역 1.9 kHz Q3
  const stick = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 } });
  const stickBp = new Tone.Filter({ type: "bandpass", frequency: 1900, Q: 3 });
  stick.connect(stickBp);
  strip(stickBp, { db: -8, pan: -0.05, rev: 0.12 });

  // ── 클로즈드 햇: 화이트노이즈 → 하이패스 6 kHz, 18 ms
  const hat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.018, sustain: 0, release: 0.01 } });
  const hatHp = new Tone.Filter({ type: "highpass", frequency: 6000, Q: 0.7 });
  hat.connect(hatHp);
  strip(hatHp, { db: -22, pan: 0.2 });

  // ── 얇은 패드: 디튠 삼각 → 로우패스 4.2 kHz(상승 구간에 6.5 kHz 로 열린다)
  const padLp = new Tone.Filter({ type: "lowpass", frequency: 4200, Q: 0.8 });
  const pad = pool(Tone.Synth, {
    oscillator: { type: "fattriangle", count: 2, spread: 14 },
    envelope: { attack: 0.4, decay: 0.2, sustain: 0.85, release: 0.7 },
  }, 6);
  pad.connect(padLp);
  strip(padLp, { db: -27, rev: 0.35 });

  // ── 상승 곡선(코사인) — brightFrom 이 유한할 때만
  if (Number.isFinite(P.brightFrom) && P.brightFrom < P.seconds) {
    const n = 64, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = 0.5 - 0.5 * Math.cos(Math.PI * (i / (n - 1)));
    liftGain.gain.setValueCurveAtTime(curve, P.brightFrom, P.liftSec);
    const fc = new Float32Array(n);
    for (let i = 0; i < n; i++) fc[i] = 4200 + (6500 - 4200) * curve[i];
    padLp.frequency.setValueCurveAtTime(fc, P.brightFrom, P.liftSec);
  }

  // ── 스케줄(절대 시각 — 트랜스포트를 쓰지 않아 --seconds 가 바뀌어도 마디 수만 달라진다)
  const arp = [0, 1, 2, 3, 2, 1, 2, 3];
  // 스템 진단용: P.solo = ["kick", ...] 이면 그 파트만 친다(레벨·크레스트 튜닝에 썼다)
  const on = (k) => !P.solo || P.solo.includes(k);
  const nBars = Math.ceil((P.seconds + 1) / bar);
  const hz = (n) => mtof(n);
  for (let b = 0; b < nBars; b++) {
    const t0 = b * bar;
    if (t0 > P.seconds) break;
    const ch = P.prog[b % P.prog.length];
    for (let e = 0; e < 8; e++) {
      const t = t0 + (e * beat) / 2;
      if (t > P.seconds) break;
      const deg = arp[e];
      const note = (deg === 3 ? ch.triad[0] + 12 : ch.triad[deg]) + 12;
      const vel = e % 2 === 0 ? 1 : 0.73;
      if (on("pluck")) (e % 2 === 0 ? pluckL : pluckR).triggerAttackRelease(hz(note), beat * 0.55, t, vel);
      if (on("tine")) tine.triggerAttackRelease(hz(note) * 4.2, 0.05, t, vel * 0.6);
      if (Number.isFinite(P.brightFrom) && t >= P.brightFrom - 0.01) {
        if (on("lift")) lift.triggerAttackRelease(hz(note + 12), beat * 0.4, t, 0.9);
      }
      if (on("bass")) bass.triggerAttackRelease(hz(ch.root - 12), beat * 0.45, t, 0.9);
    }
    if (on("kick")) for (const k of [0, 2]) kick.triggerAttackRelease(40, 0.24, t0 + k * beat, 0.95);
    if (on("stick")) for (const s of [1, 3]) stick.triggerAttackRelease(0.05, t0 + s * beat, 0.9);
    if (on("hat")) for (let h = 0; h < 8; h++) hat.triggerAttackRelease(0.04, t0 + (h * beat) / 2, h % 2 === 0 ? 1 : 0.64);
    if (on("pad")) pad.triggerAttackRelease(ch.triad.map((n) => hz(n + 12)), bar * 1.02, t0, 0.8);
  }
}

/** 프리셋 → 브라우저로 보낼 파라미터(직렬화 가능한 값만) */
function paramsFor(presetId, seconds) {
  const p = PRESETS[presetId];
  if (presetId !== "a") throw new Error(`Tone 엔진은 프리셋 A 만 구현했다(사용자 확정 = A). 요청: ${presetId}`);
  const PROG_A = [
    { root: 50, triad: [50, 54, 57] }, // D
    { root: 45, triad: [49, 52, 57] }, // A
    { root: 47, triad: [47, 50, 54] }, // Bm
    { root: 43, triad: [47, 50, 55] }, // G
  ];
  const bf = brightenFrom(seconds);
  return { seconds, bpm: p.bpm, prog: PROG_A, brightFrom: Number.isFinite(bf) ? bf : null, liftSec: 2.5, lowpassHz: p.lowpassHz };
}

/** 프리셋·길이 → Float32 채널(정규화 전). 결정성 검사도 이 값을 비교한다 */
export async function renderRaw(presetId = "a", seconds = 60, extra = {}) {
  const P = { ...paramsFor(presetId, seconds), ...extra };
  // JSON 은 Infinity 를 못 싣는다(null 이 된다) — 작곡 함수가 Number.isFinite 로 거른다
  const r = await renderToneOffline(composeToneA, P, { seconds: seconds + 0.25 });
  // 꼬리 0.25초는 렌더 여유 — 길이를 정확히 seconds 로 자른다
  const n = Math.round(seconds * SR);
  return { ...r, channels: r.channels.map((c) => c.subarray(0, n)) };
}

/** make-bgm.mjs 의 synthWav 와 같은 계약: 프리셋·길이 → 원시 WAV(마스터 전) */
export async function synthWavTone(outWav, presetId = "a", seconds = 60) {
  const r = await renderRaw(presetId, seconds);
  const norm = writeNormalized(outWav, r.channels);
  return { outWav, renderMs: r.renderMs, tone: r.tone, ...norm };
}

/**
 * 결정성 — 같은 입력을 두 번 렌더해 **샘플 차이**를 잰다.
 *
 * 🔴 2026-09-30 실측: 시드를 고정해도 **비트 동일은 나오지 않는다**. 차이는 최대 ~2.4e-7
 *    (float32 1ulp 수준, 약 -132 dBFS)이고 개별 부품(노이즈·잔향·플럭·멤브레인·컴프·리미터·
 *    필터·딜레이·패너)은 각각 단독으로는 비트 동일이었다. 여러 소스가 **한 노드로 합쳐질 때**만
 *    생긴다 → Chrome 이 한 입력에 붙은 연결들을 더하는 **순서**가 렌더마다 달라지는 것으로 본다
 *    (가설 — Chromium 소스로 확인하지 않았다). 그래서 sha256 비교는 늘 실패한다.
 *    판정 = 최대 차이 ≤ 1e-5(-100 dBFS, 16bit 1LSB 3e-5 의 1/3) 이면 결정적(청감·지표 동일).
 */
export async function determinism(seconds = 8, tol = 1e-5) {
  const a = await renderRaw("a", seconds), b = await renderRaw("a", seconds);
  let maxd = 0, cnt = 0, sq = 0, n = 0;
  for (let c = 0; c < a.channels.length; c++) {
    const A = a.channels[c], B = b.channels[c];
    for (let i = 0; i < A.length; i++) { const d = Math.abs(A[i] - B[i]); if (d > 0) cnt++; if (d > maxd) maxd = d; sq += d * d; n++; }
  }
  const rmsDb = sq > 0 ? Math.round(10 * Math.log10(sq / n) * 10) / 10 : -Infinity;
  return { seconds, maxDiff: maxd, maxDiffDb: maxd > 0 ? Math.round(20 * Math.log10(maxd) * 10) / 10 : -Infinity, diffRmsDb: rmsDb, samplesDiffer: cnt, total: n, tol, ok: maxd <= tol };
}


/* ────────────────────────────── CLI ────────────────────────────── */

function argOf(args, name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}

/** 20초 미리듣기(두 엔진) + 스펙트럼 + A/B 지표표 */
export async function buildPreview(previewSec = 20) {
  fs.mkdirSync(CHECK, { recursive: true });
  const rows = [];
  // Tone
  const rawT = path.join(CHECK, "bgm-tone-raw.wav");
  const mp3T = path.join(CHECK, "bgm-tone-preview.mp3");
  const s = await synthWavTone(rawT, "a", previewSec);
  const mT = master(rawT, mp3T, "a", previewSec, { ffmpegFx: false, refine: true });
  fs.rmSync(rawT, { force: true });
  spectrum(mp3T, path.join(CHECK, "bgm-tone-spectrum.png"));
  rows.push({ engine: "tone", file: mp3T, renderMs: s.renderMs, ...analyze(mp3T), I: mT.I, TP: mT.TP });
  // Node(기존) — 같은 길이·같은 마스터
  const rawN = path.join(CHECK, "bgm-node-raw.wav");
  const mp3N = path.join(CHECK, "bgm-node-preview.mp3");
  const t0 = Date.now();
  synthWav(rawN, "a", previewSec);
  const nodeMs = Date.now() - t0;
  const mN = master(rawN, mp3N, "a", previewSec);
  fs.rmSync(rawN, { force: true });
  spectrum(mp3N, path.join(CHECK, "bgm-node-spectrum.png"));
  rows.push({ engine: "node", file: mp3N, renderMs: nodeMs, ...analyze(mp3N), I: mN.I, TP: mN.TP });
  return rows;
}

export function abTable(rows, extra = []) {
  const g = checkNotFuneral(PRESETS.a);
  return [
    "| 엔진 | 파일 | 길이(초) | 중심주파수 | 4 kHz↑ | 온셋/초 | I (LUFS) | TP (dBTP) | 합성 시간 | 장송곡 게이트 |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...[...rows, ...extra].map((r) =>
      `| ${r.engine} | \`${path.relative(ROOT, r.file).replace(/\\/g, "/")}\` | ${r.seconds} | ${r.centroidHz} Hz | ${r.above4kRatio} % | ${r.onsetsPerSec} | ${r.I} | ${r.TP} | ${r.renderMs} ms | ${g.ok ? "통과" : g.fails.join(" · ")} |`),
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--preview")) {
    const rows = await buildPreview(Number(argOf(args, "seconds", 20)));
    const md = path.join(CHECK, "bgm-tone-ab.md");
    fs.writeFileSync(md, `# BGM 엔진 A/B (프리셋 A, 미리듣기)\n\n측정 ${new Date().toISOString()} · Tone ${toneVersion()}\n\n${abTable(rows)}\n`, "utf8");
    console.log(abTable(rows));
    console.log("표 ->", md);
    return;
  }
  if (args.includes("--determinism")) {
    const d = await determinism(Number(argOf(args, "seconds", 8)));
    console.log(d);
    console.log(d.ok ? `결정적 — 최대 차이 ${d.maxDiffDb} dBFS(허용 -100 dBFS). 비트 동일은 아니다(합산 순서, determinism() 머리말)` : "❌ 비결정 — 허용치를 넘는 차이");
    process.exit(d.ok ? 0 : 1);
  }
  const preset = argOf(args, "preset", "a");
  const seconds = Number(argOf(args, "seconds", mainSeconds()));
  const out = path.resolve(ROOT, argOf(args, "out", path.join(BGM_DIR, "track.mp3")));
  const res = await buildTrackTone({ preset, seconds, out, force: args.includes("--force") });
  if (res) {
    console.log(res);
    console.log("지표:", analyze(out));
    if (args.includes("--spectrum")) console.log(spectrum(out, path.join(CHECK, `bgm-tone-${preset}-spectrum.png`)));
  }
}

/** 본편/임의 경로 트랙 합성 — make-bgm.mjs --engine tone 도 이것을 부른다 */
export async function buildTrackTone({ preset = "a", seconds = mainSeconds(), out = path.join(BGM_DIR, "track.mp3"), force = false } = {}) {
  const isTrack = path.resolve(out) === path.resolve(path.join(BGM_DIR, "track.mp3"));
  if (isTrack) {
    const wavUser = path.join(BGM_DIR, "track.wav");
    const userSupplied = (fs.existsSync(out) || fs.existsSync(wavUser)) && !fs.existsSync(MARKER);
    if (userSupplied) { console.log("사용자 라이선스 음원이 public/bgm 에 있다 — 합성하지 않는다."); return null; }
    if (fs.existsSync(out) && !force) { console.log(`이미 있다(합성본): ${out} — 다시 만들려면 --force`); return null; }
  }
  const g = checkNotFuneral(PRESETS[preset]);
  if (!g.ok) console.warn(`⚠ 장송곡 게이트 실패(${preset}): ${g.fails.join(" · ")}`);
  fs.mkdirSync(CHECK, { recursive: true });
  const raw = path.join(CHECK, `bgm-tone-${preset}-raw.wav`);
  const s = await synthWavTone(raw, preset, seconds);
  const res = master(raw, out, preset, seconds, { ffmpegFx: false, refine: true });
  fs.rmSync(raw, { force: true });
  if (isTrack) {
    fs.writeFileSync(MARKER,
      `tools/make-bgm-tone.mjs(Tone.js ${s.tone}, 시드 0x${SEED.toString(16)}) 가 합성한 파일이다. 사용자가 라이선스 음원을 넣으려면 이 마커를 지우고 track.mp3|wav 를 놓는다.\n엔진: tone\n프리셋: ${preset}\n생성: ${new Date().toISOString()}\n`,
      "utf8");
  }
  return { engine: "tone", renderMs: s.renderMs, ...res };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
