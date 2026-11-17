#!/usr/bin/env node
/**
 * 효과음 합성기 — Tone.js 엔진 (v3.3 레인 U, 2026-09-30). 기존 ffmpeg 판 = tools/make-sfx.mjs(대체 경로로 남긴다).
 *
 *   node tools/make-sfx-tone.mjs            public/sfx/*.wav 를 다시 만든다(Tone.Offline → 피크 정합 → 48kHz 16bit 스테레오)
 *   node tools/make-sfx-tone.mjs --check    만들지 않고 현재 파일의 길이·피크·정점 시각만 잰다
 *   node tools/make-sfx-tone.mjs --only whoosh-in,cta-reveal
 *
 * 🔴 내려받지 않는다 — 전부 합성(라이선스 무관). 톤은 「기업 SaaS 광고」: 장난스러운 소리·8bit 금지.
 * 🔴 Remotion 렌더는 Web Audio 를 캡처하지 않는다 → 여기서 WAV 로 구워 `<Audio src={staticFile("sfx/…")}>` 로 넣는다.
 *    실행기(헤드리스 Chrome + Tone.Offline)는 tools/make-bgm-tone.mjs 의 renderToneOffline 을 같이 쓴다.
 *
 * ── 파일명 계약(레인 T 의 3D 전환이 참조한다 — 이름·정점 시각을 바꾸면 레인 T 배치가 어긋난다) ──
 *   파일                     길이   정점(hit)  피크      자리
 *   room-tone.wav            훅길이   —        -26 dBFS  훅 전체 바닥(Hook.tsx, 기존 이름 유지)
 *   ui-tick.wav              0.15s  0.00s     -16 dBFS  문서 도착 알림(현재 미배치, 기존 이름 유지)
 *   whoosh-in.wav            0.80s  0.55s     -18 dBFS  3D 전환 ①: 카메라가 앞으로 파고드는 전환(상행 스윕)
 *   whoosh-out.wav           0.70s  0.18s     -18 dBFS  3D 전환 ②: 뒤로 빠지며 넘기는 전환(하행 스윕)
 *   stack-shimmer.wav        1.00s  0.30s     -18 dBFS  3D 전환 ③: 문서가 쌓이는 모션(부드러운 스윕 + D장조 반짝임 3음)
 *   cta-reveal.wav           1.60s  0.60s     -14 dBFS  CTA 로고 등장(라이저 → D장조 벨 화음)
 *   배치 규칙: 전환의 **중심 프레임**에 정점을 맞춘다 → `<Sequence from={center - Math.round(hit * fps)}>`.
 *   정점 시각은 `--check` 가 실측해 표로 찍는다(계약과 ±30ms 넘게 어긋나면 exit 1).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeWav } from "./make-bgm.mjs";
import { renderToneOffline, SR } from "./make-bgm-tone.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "sfx");

/** 훅 길이 = src/scene-durations.json 파생(하드코딩 금지 — 2026-09-21 레인 I 교훈) */
export function hookSeconds() {
  const f = path.join(ROOT, "src", "scene-durations.json");
  if (!fs.existsSync(f)) return 4.0;
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const h = j.scenes?.hook;
  return h ? Math.round((h.frames / j.fps) * 1000) / 1000 : 4.0;
}

/* ── 브라우저에서 실행되는 작곡 함수들(🔴 바깥 식별자 참조 금지 — toString 으로 보낸다) ── */

async function roomTone(Tone, P) {
  const n = new Tone.Noise({ type: "pink" });
  const hp = new Tone.Filter({ type: "highpass", frequency: 45 });
  const lp1 = new Tone.Filter({ type: "lowpass", frequency: 320, Q: 0.5 });
  const lp2 = new Tone.Filter({ type: "lowpass", frequency: 320, Q: 0.5 });
  const g = new Tone.Gain(0);
  n.chain(hp, lp1, lp2, g, Tone.getDestination());
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(1, 0.5);
  g.gain.setValueAtTime(1, Math.max(0.5, P.seconds - 0.3));
  g.gain.linearRampToValueAtTime(0, P.seconds);
  n.start(0);
}

async function uiTick(Tone) {
  const hp = new Tone.Filter({ type: "highpass", frequency: 200 });
  const lp = new Tone.Filter({ type: "lowpass", frequency: 7000 });
  hp.chain(lp, Tone.getDestination());
  const mk = (decay) => new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.0017, decay, sustain: 0, release: 0.01 } }).connect(hp);
  mk(0.03).triggerAttackRelease(1046.5, 0.1, 0, 0.62);   // C6
  mk(0.033).triggerAttackRelease(1568.0, 0.09, 0.055, 0.5); // G6 — 완전5도 위 상행 2음
  mk(0.017).triggerAttackRelease(2093.0, 0.05, 0, 0.12);  // 옅은 배음
}

/** 필터 스윕 노이즈 — 공용(from→to Hz, 정점 hit 초, 길이 len) */
async function sweep(Tone, P) {
  const n = new Tone.Noise({ type: "pink" });
  const bp = new Tone.Filter({ type: "bandpass", frequency: P.from, Q: P.q ?? 1.4 });
  const hp = new Tone.Filter({ type: "highpass", frequency: 120 });
  const g = new Tone.Gain(0);
  const pan = new Tone.Panner(P.panFrom ?? 0);
  const rev = new Tone.Reverb({ decay: 0.9, wet: 0.25 });
  await rev.ready;
  n.chain(bp, hp, g, pan, rev, Tone.getDestination());
  bp.frequency.setValueAtTime(P.from, 0);
  bp.frequency.exponentialRampToValueAtTime(P.to, P.hit);
  bp.frequency.exponentialRampToValueAtTime(P.tail ?? P.to, P.len);
  // 부드러운 스웰 → 정점 → 지수 감쇠
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.exponentialRampToValueAtTime(1, P.hit);
  g.gain.exponentialRampToValueAtTime(0.0001, P.len - 0.02);
  pan.pan.setValueAtTime(P.panFrom ?? 0, 0);
  pan.pan.linearRampToValueAtTime(P.panTo ?? 0, P.len);
  n.start(0).stop(P.len);
  if (P.sparkle) {
    // D장조 반짝임 3음(D6·F#6·A6) — 문서가 한 장씩 얹히는 느낌. 사인+약한 2배음, 짧은 감쇠
    const bell = new Tone.Gain(0.35).connect(rev);
    const notes = [1174.66, 1479.98, 1760.0];
    notes.forEach((f, i) => {
      const s = new Tone.Synth({ oscillator: { type: "custom", partials: [1, 0.25] }, envelope: { attack: 0.003, decay: 0.22, sustain: 0, release: 0.05 } }).connect(bell);
      s.triggerAttackRelease(f, 0.2, P.hit + i * 0.09, 0.8 - i * 0.15);
    });
  }
}

async function ctaReveal(Tone, P) {
  const rev = new Tone.Reverb({ decay: 2.2, preDelay: 0.01, wet: 0.35 });
  await rev.ready;
  const lim = new Tone.Limiter(-1);
  rev.chain(lim, Tone.getDestination());
  // 라이저: 핑크노이즈 대역 스윕 400→6000 Hz, 0→hit 로 커졌다가 벨이 들어오면 빠진다
  const n = new Tone.Noise({ type: "pink" });
  const bp = new Tone.Filter({ type: "bandpass", frequency: 400, Q: 1.2 });
  const g = new Tone.Gain(0);
  n.chain(bp, g, rev);
  bp.frequency.setValueAtTime(400, 0);
  bp.frequency.exponentialRampToValueAtTime(6000, P.hit);
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.exponentialRampToValueAtTime(0.5, P.hit - 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, P.hit + 0.25);
  n.start(0).stop(P.hit + 0.3);
  // 벨 화음 D장조(D5·F#5·A5·D6) — FM 벨, 긴 감쇠.
  // 🔴 벨 에너지 최대는 타격 뒤 ~50ms(FM 변조 포락 + 잔향 쌓임) — 정점 계약(hit)에 맞추려고 그만큼 당긴다
  const at = P.hit - 0.05;
  const chord = [587.33, 739.99, 880.0, 1174.66];
  chord.forEach((f, i) => {
    const s = new Tone.FMSynth({
      harmonicity: 3.01, modulationIndex: 2.2,
      oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.004, decay: 1.0, sustain: 0, release: 0.3 },
      modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.2 },
    });
    const pn = new Tone.Panner([-0.3, -0.1, 0.1, 0.3][i]);
    s.chain(pn, rev);
    s.triggerAttackRelease(f, 0.9, at + i * 0.012, 0.55);
  });
  // 아래 받침 — 서브 D3 짧은 쿵(과하지 않게)
  const sub = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 1, envelope: { attack: 0.002, decay: 0.35, sustain: 0 } });
  sub.volume.value = -10;
  sub.connect(rev);
  sub.triggerAttackRelease(73.42, 0.3, at, 0.7);
}

/* ── 사양(계약) ── */
export function specs() {
  const hook = hookSeconds();
  return [
    { id: "room-tone", fn: roomTone, len: hook, hit: null, peakDb: -26, P: { seconds: hook } },
    { id: "ui-tick", fn: uiTick, len: 0.15, hit: 0.0, peakDb: -16, P: {} },
    { id: "whoosh-in", fn: sweep, len: 0.8, hit: 0.55, peakDb: -18, P: { from: 300, to: 4500, tail: 2500, hit: 0.55, len: 0.8, panFrom: -0.5, panTo: 0.3 } },
    { id: "whoosh-out", fn: sweep, len: 0.7, hit: 0.18, peakDb: -18, P: { from: 5000, to: 2400, tail: 400, hit: 0.18, len: 0.7, panFrom: 0.4, panTo: -0.4 } },
    { id: "stack-shimmer", fn: sweep, len: 1.0, hit: 0.3, peakDb: -18, P: { from: 500, to: 3000, tail: 1500, hit: 0.3, len: 1.0, q: 1.0, sparkle: true } },
    { id: "cta-reveal", fn: ctaReveal, len: 1.6, hit: 0.6, peakDb: -14, P: { hit: 0.6 } },
  ];
}

/* ── 측정 ── */
function readWav16(file) {
  const b = fs.readFileSync(file);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === "fmt ") fmt = { ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === "data") data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error(`16bit PCM WAV 가 아니다: ${file}`);
  const n = data.length / 2 / fmt.ch;
  const mono = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) { const v = data.readInt16LE((i * fmt.ch + c) * 2) / 32768; s += v; peak = Math.max(peak, Math.abs(v)); }
    mono[i] = s / fmt.ch;
  }
  return { sr: fmt.sr, ch: fmt.ch, mono, peak };
}

/** 길이·피크(dBFS)·정점 시각(10ms RMS 포락선 최댓값) */
export function measureSfx(file) {
  const { sr, ch, mono, peak } = readWav16(file);
  const W = Math.round(sr * 0.01);
  let best = -1, bestT = 0;
  for (let i = 0; i + W <= mono.length; i += W) {
    let e = 0;
    for (let k = 0; k < W; k++) e += mono[i + k] * mono[i + k];
    if (e > best) { best = e; bestT = (i + W / 2) / sr; }
  }
  return { seconds: Math.round((mono.length / sr) * 1000) / 1000, sr, ch, peakDb: Math.round(20 * Math.log10(peak) * 10) / 10, hitSec: Math.round(bestT * 1000) / 1000 };
}

function check(list) {
  let bad = 0;
  const rows = list.map((s) => {
    const f = path.join(OUT_DIR, `${s.id}.wav`);
    if (!fs.existsSync(f)) { bad++; return { 파일: `${s.id}.wav`, 상태: "없음" }; }
    const m = measureSfx(f);
    const lenOk = Math.abs(m.seconds - s.len) <= 0.011;
    const peakOk = Math.abs(m.peakDb - s.peakDb) <= 0.3;
    const hitOk = s.hit === null || Math.abs(m.hitSec - s.hit) <= 0.03;
    if (!(lenOk && peakOk && hitOk && m.sr === SR)) bad++;
    return { 파일: `${s.id}.wav`, 길이: `${m.seconds}s(계약 ${s.len})`, 피크: `${m.peakDb}(계약 ${s.peakDb})`, 정점: s.hit === null ? "—" : `${m.hitSec}s(계약 ${s.hit})`, sr: m.sr, 판정: lenOk && peakOk && hitOk && m.sr === SR ? "통과" : "❌" };
  });
  console.table(rows);
  return bad;
}

async function main() {
  const args = process.argv.slice(2);
  const oi = args.indexOf("--only");
  const only = oi >= 0 ? new Set(args[oi + 1].split(",")) : null;
  const list = specs().filter((s) => !only || only.has(s.id));
  if (args.includes("--check")) process.exit(check(list) ? 1 : 0);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const s of list) {
    const r = await renderToneOffline(s.fn, s.P, { seconds: s.len, channels: 2 });
    const n = Math.round(s.len * SR);
    const [A, B] = r.channels.map((c) => c.subarray(0, n));
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(A[i]), Math.abs(B[i]));
    if (!(peak > 0)) throw new Error(`${s.id}: 무음 렌더`);
    const g = Math.pow(10, s.peakDb / 20) / peak;
    const L = new Float32Array(n), R = new Float32Array(n);
    // 끝 5ms 페이드(클릭 방지)
    const fadeN = Math.round(0.005 * SR);
    for (let i = 0; i < n; i++) {
      const f = i >= n - fadeN ? (n - 1 - i) / fadeN : 1;
      L[i] = A[i] * g * f; R[i] = B[i] * g * f;
    }
    const out = writeWav(path.join(OUT_DIR, `${s.id}.wav`), L, R, SR);
    const m = measureSfx(out);
    console.log(`✅ public/sfx/${s.id}.wav  ${m.seconds}s · peak ${m.peakDb} dBFS · 정점 ${m.hitSec}s · Tone ${r.tone} · ${r.renderMs}ms`);
  }
  process.exit(check(list) ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
