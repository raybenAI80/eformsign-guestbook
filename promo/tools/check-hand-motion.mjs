#!/usr/bin/env node
/**
 * 레인 V(2026-09-30) 게이트 — Fill·Repeat 손 궤적이 **사람 손 속도 범위**인지, 손끝이 **화면 안**에
 * 닿는지, 바탕이 **한 장**인지 판정한다. 결과 표를 out/check/v33v-motion.json 에 쓴다.
 *
 *   node tools/check-hand-motion.mjs          (exit 1 = 실패)
 *
 * 속도 환산: 태블릿 화면 세로(쿼드 높이, 사진 px) = 23.5cm(11인치 세로) 로 두고 cm/s 로 바꾼다.
 * 기준(사람이 화면을 짚는 손): 이동 평균 ≤ 45cm/s(레인 V2 에서 60→45), 순간 최고 ≤ 150cm/s, 한 프레임 도약 없음.
 * 레인 V2(2026-09-30) 추가:
 *   · Fill 손 머묾(보이는 손이 3cm/s 이하로 멈춘 연속 구간) 최장 ≤ 30f(1.0초) — 서명 확인 탭 ~ 전송 탭 사이.
 *     v3.3 V 는 전송 확인 창 앞에서 175~243f(68f) 멈췄다.
 *   · 안내 화살표 0: Fill·Repeat 가 실제로 얹는 캡처 층(shot-scale.json 사본, 없으면 원본) 전부에서
 *     분홍 화소(tools/remove-guide-arrow.py --check-scaled) 0.
 * 레인 R2(2026-09-30) 추가:
 *   · 문서함 둘째 행(이번 방문자 문서) 도착 = 전송 탭 뒤 6~12f, 장면 끝까지 정착, Fill 끝 = Repeat 첫 프레임 상태.
 *     음성 대조 `--inbox-second-at 200`(레인 R 까지의 값) → exit 1.
 * 🔴 TS 정본(src/hand.ts)을 그대로 import 한다 — 궤적을 이 스크립트에서 다시 계산하지 않는다.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (!process.env.__HAND_CHECK_CHILD) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "handchk-"));
  const hook = path.join(dir, "json-attr-hook.mjs");
  const reg = path.join(dir, "register.mjs");
  fs.writeFileSync(
    hook,
    `export async function resolve(spec, ctx, next) {
  let r;
  try { r = await next(spec, ctx); } catch (e) {
    if (e?.code !== "ERR_MODULE_NOT_FOUND" || !spec.startsWith(".")) throw e;
    r = await next(spec + ".ts", ctx);
  }
  if (r.url.endsWith(".json")) { r.format = "json"; r.importAttributes = { type: "json" }; }
  return r;
}\n`,
  );
  fs.writeFileSync(reg, `import { register } from "node:module";\nregister("./json-attr-hook.mjs", import.meta.url);\n`);
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--import", pathToFileURL(reg).href, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, __HAND_CHECK_CHILD: "1" }, cwd: root },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}

const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const hand = await imp("src/hand.ts");
const h3 = await imp("src/hand3d.ts");
const ss = await imp("src/shots-scenes.ts");
const durations = JSON.parse(fs.readFileSync(path.join(root, "src/scene-durations.json"), "utf8"));

const quad = ss.screenQuad(3);
const aspect = ss.quadAspect(quad);
const qH = (Math.hypot(quad.tl[0] - quad.bl[0], quad.tl[1] - quad.bl[1]) + Math.hypot(quad.tr[0] - quad.br[0], quad.tr[1] - quad.br[1])) / 2;
const CM_PER_PX = 23.5 / qH; // 사진 px → cm
const FPS = 30;

const seq = ss.fillSeq();
const seqCap = { width: seq.width, height: seq.height, viewport: seq.viewport };
const fillTotal = durations.scenes.fill.frames;
const FT = hand.FILL_TIMING;
const per = Math.max(1, Math.floor(FT.seqSpan / Math.max(1, seq.frames.length)));
const fill = hand.fillKeys({ per, seqCap, b04Cap: ss.geo("B04"), b05At: hand.fillB05At(), total: fillTotal, quad, aspect, hoverAt: FT.hoverAt, awayAfter: FT.awayAfter });
const MEAN_LIMIT = 45;
/* 레인 H3D: 순간 최고 150 → 80cm/s(브리프). 손끝·손등 마디(3D 투영점) 둘 다 */
const PEAK_LIMIT = 80;
const STALL_LIMIT = 30;

/* Repeat — Repeat.tsx 와 같은 파생(길이·밝은 프레임)을 쓴다 */
const repTotal = durations.scenes.repeat.frames;
const FIRST_LEN = Math.round(repTotal * 0.55);
const thanks = ss.thanksSeq();
const seqUse = ss.brightFrames(thanks);
const perSeq = Math.max(1, Math.floor((FIRST_LEN * 0.8) / seqUse.length));
const tIdx = seqUse.indexOf(hand.thanksTransitionFrame() ?? "");
const cd = ss.countdownSeq();
const cdCap = { width: cd.width, height: cd.height, viewport: hand.centeredOverlayArea(cd.viewport, cd.height) };
const cdN = Math.min(8, ss.brightFrames(cd).length);
const blank = ss.geo("C01b");
const thanksCap = { width: thanks.width, height: thanks.height, viewport: thanks.viewport };
const rep1 = hand.repeatKeys({ quad, aspect, thanksCap, thanksTapAt: tIdx > 0 ? tIdx * perSeq - 1 : null, cdCap, cdTapAt: null, blankCap: blank });
const rep2 = hand.repeatKeys({ quad, aspect, thanksCap, thanksTapAt: null, cdCap, cdTapAt: cdN ? cdN * 10 - 1 : null, blankCap: blank });

const fail = [];
const inQuad = (p) => {
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    s += Math.sign(c);
  }
  return Math.abs(s) === 4;
};

const report = { cmPerPhotoPx: +CM_PER_PX.toFixed(4), limits: { meanCmS: MEAN_LIMIT, peakCmS: PEAK_LIMIT, fillStallFrames: STALL_LIMIT }, cuts: {} };
for (const [name, keys, total] of [["fill", fill, fillTotal], ["repeat-1", rep1, FIRST_LEN + 12], ["repeat-2", rep2, repTotal - FIRST_LEN]]) {
  const rows = [];
  // 탭 = 화면 안이어야 한다
  for (const k of keys) {
    if (k.kind === "tap" || k.kind === "sign") {
      const ok = inQuad(k.at);
      if (!ok) fail.push(`${name} t=${k.t} 손끝이 화면 밖 ${k.at.map((v) => v.toFixed(0))}`);
      rows.push({ t: k.t, kind: k.kind, at: k.at.map((v) => +v.toFixed(1)), inScreen: ok });
    }
  }
  // 프레임별 속도
  let prev = null, peak = 0, jumps = 0;
  const moves = [];
  let cur = null;
  for (let f = 0; f < total; f++) {
    const p = hand.poseAt(keys, f);
    if (prev && p.visible && prev.visible) {
      const v = Math.hypot(p.tip[0] - prev.tip[0], p.tip[1] - prev.tip[1]) * CM_PER_PX * FPS;
      if (v > 3) {
        if (!cur) cur = { from: f - 1, dist: 0, peak: 0 };
        cur.dist += v / FPS; cur.peak = Math.max(cur.peak, v);
      } else if (cur) { cur.to = f - 1; moves.push(cur); cur = null; }
      peak = Math.max(peak, v);
      if (v > 300) jumps++;
    }
    prev = p;
  }
  if (cur) { cur.to = total - 1; moves.push(cur); }
  const mv = moves.map((m) => ({
    frames: `${m.from}-${m.to}`,
    distCm: +m.dist.toFixed(1),
    meanCmS: +(m.dist / ((m.to - m.from + 1) / FPS)).toFixed(1),
    peakCmS: +m.peak.toFixed(1),
  }));
  for (const m of mv) {
    if (m.distCm < 1.5) continue; // 머무름 흔들림·탭 누름은 이동이 아니다
    if (m.meanCmS > MEAN_LIMIT) fail.push(`${name} ${m.frames} 평균 ${m.meanCmS}cm/s > ${MEAN_LIMIT}`);
    if (m.peakCmS > PEAK_LIMIT) fail.push(`${name} ${m.frames} 최고 ${m.peakCmS}cm/s > ${PEAK_LIMIT}`);
  }
  if (jumps) fail.push(`${name} 한 프레임 도약 ${jumps}회`);
  report.cuts[name] = { taps: rows, moves: mv.filter((m) => m.distCm >= 1.5) };
  if (name === "fill") {
    /* 머묾: 서명 창 「확인」(시퀀스 마지막 탭) ~ 전송 탭 사이 = 전송 확인 창 앞. 손이 3cm/s 이하로 멈춘 연속 프레임.
       (입력 칸에 글자가 찍히는 동안 손이 칸 위에 떠 있는 앞 구간 머묾은 타자 시간이라 판정 밖 — 정보로만 싣는다) */
    const taps = keys.filter((k) => k.kind === "tap" || k.kind === "sign");
    const f0 = taps[taps.length - 2].t, f1 = taps[taps.length - 1].t;
    let run = 0, best = { len: 0, from: f0 }, p0 = hand.poseAt(keys, f0);
    for (let f = f0 + 1; f <= f1; f++) {
      const p = hand.poseAt(keys, f);
      const v = Math.hypot(p.tip[0] - p0.tip[0], p.tip[1] - p0.tip[1]) * CM_PER_PX * FPS + Math.abs(p.lift - p0.lift) * 30;
      run = v <= 3 ? run + 1 : 0;
      if (run > best.len) best = { len: run, from: f - run + 1 };
      p0 = p;
    }
    report.cuts.fill.longestStall = { frames: best.len, from: best.from, to: best.from + best.len - 1, sec: +(best.len / FPS).toFixed(2) };
    if (best.len > STALL_LIMIT) fail.push(`fill 손 머묾 ${best.from}~${best.from + best.len - 1}f (${best.len}f) > ${STALL_LIMIT}f`);
  }
}

/* 안내 화살표 0 — Fill·Repeat 가 얹는 캡처 층 전부(사본 우선, 없으면 원본) */
{
  const scale = JSON.parse(fs.readFileSync(path.join(root, "src/shot-scale.json"), "utf8")).files ?? {};
  const layer = (rel) => path.join(root, "public/shots", scale[rel] ? "_scaled" : "", rel);
  const rels = new Set([...seq.frames, ...thanks.frames, ...cd.frames]);
  for (const k of ["B04", "B05", "C01b", "C04"]) if (ss.geo(k)) rels.add(ss.SHOT_FILES[k]);
  const files = [...rels].map(layer).filter((f) => fs.existsSync(f));
  const r = spawnSync(process.platform === "win32" ? "python" : "python3", [path.join(root, "tools/remove-guide-arrow.py"), "--check-scaled", ...files], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  const out = (r.stdout || "").trim();
  report.guideArrow = { files: files.length, exit: r.status, summary: out.split(/\r?\n/).pop() };
  console.log(`\n안내 화살표(분홍) 검사: ${report.guideArrow.summary}`);
  if (r.status !== 0) fail.push(`안내 화살표 분홍 화소가 남은 캡처 층: ${out}`);
  /* 렌더 판정(선택): --video <Fill·Repeat 구간 mp4> — 왼쪽 칸 분홍 화소 프레임 0. v33v-fill.mp4 는 101프레임(음성 대조) */
  const vi = process.argv.indexOf("--video");
  if (vi > 0) {
    const v = spawnSync(process.platform === "win32" ? "python" : "python3", [path.join(root, "tools/remove-guide-arrow.py"), "--check-video", path.resolve(root, process.argv[vi + 1])], {
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    report.guideArrow.video = (v.stdout || "").trim();
    console.log(`렌더 분홍 검사: ${report.guideArrow.video}`);
    if (v.status !== 0) fail.push(`렌더에 분홍 화소: ${report.guideArrow.video}`);
  }
}

/* 바탕 한 장: Fill·Repeat 의 Photo src 가 전부 handPlate() 인가(소스 정적 검사) */
const srcs = [];
for (const f of ["src/scenes/Fill.tsx", "src/scenes/Repeat.tsx"]) {
  const t = fs.readFileSync(path.join(root, f), "utf8");
  for (const m of t.matchAll(/<(?:Photo src|Visitor gen)=\{?([^}\s]+)\}?/g)) srcs.push(`${f}: ${m[1]}`);
  if (/Occluder/.test(t.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, ""))) fail.push(`${f} 에 Occluder 가 남아 있다`);
}
const bad = srcs.filter((s) => !/handPlate\(\)/.test(s));
if (bad.length) fail.push(`바탕이 한 장이 아니다: ${bad.join(" | ")}`);
report.plates = { sources: srcs, unique: [...new Set(srcs.map((s) => s.split(": ")[1]))], file: hand.handPlate() };

/*
 * 레인 R2(2026-09-30): 문서함 도착 순서 — 이번 방문자 문서(Fill 둘째 행)는 **전송 탭 뒤** 6~12f 에 도착하고,
 * 장면 끝까지 자리 잡으며(spring 정착 30f), 셋째 행은 장면 밖, Fill 끝 행 수 = Repeat 첫 프레임 행 수.
 * 음성 대조: `--inbox-second-at 200`(레인 R 까지의 값) → exit 1.
 */
{
  const oi = process.argv.indexOf("--inbox-second-at");
  const inbox = hand.fillInboxTiming(oi > 0 ? Number(process.argv[oi + 1]) : undefined);
  const fillSrc = fs.readFileSync(path.join(root, "src/scenes/Fill.tsx"), "utf8");
  if (!/<Inbox from=\{INBOX\.from\} every=\{INBOX\.every\}/.test(fillSrc)) fail.push("Fill.tsx Inbox 가 fillInboxTiming() 을 쓰지 않는다(리터럴 타이밍)");
  const tap = hand.fillSendTapAt();
  const lastTap = fill.filter((k) => k.kind === "tap").pop()?.t;
  if (lastTap !== tap) fail.push(`전송 탭 프레임 불일치: fillKeys 마지막 탭 ${lastTap} ≠ fillSendTapAt ${tap}`);
  const gap = inbox.second - tap;
  const SETTLE = 30;
  if (!(gap >= 6 && gap <= 12)) fail.push(`문서함 둘째 행 도착 ${inbox.second}f — 전송 탭 ${tap}f 뒤 6~12f 여야 한다(차 ${gap}f)`);
  if (inbox.second + SETTLE > fillTotal) fail.push(`문서함 둘째 행이 장면 끝(${fillTotal}f)까지 자리 잡지 못한다(${inbox.second}+${SETTLE})`);
  if (inbox.third < fillTotal) fail.push(`Fill 이 셋째 행(${inbox.third}f)까지 도착시킨다 — 맨 윗행은 Repeat 몫`);
  const repSrc = fs.readFileSync(path.join(root, "src/scenes/Repeat.tsx"), "utf8");
  const rm = repSrc.match(/<Inbox from=\{(-?\d+)\} every=\{(\d+)\}/);
  // 행별 보이는 정도 = Inbox ShotRow 와 같은 spring(damping 200, mass 0.7). 경계 앞뒤 상태 벡터를 비교한다
  const { spring } = await import("remotion");
  const vis = (appear, f) => spring({ frame: f - appear, fps: FPS, config: { damping: 200, mass: 0.7 } });
  const fillEndVec = [inbox.from, inbox.second, inbox.third].map((t) => +vis(t, fillTotal - 1).toFixed(3));
  let repStartVec = null;
  if (!rm) fail.push("Repeat.tsx Inbox from/every 를 읽지 못했다");
  else {
    const [rf, re] = [Number(rm[1]), Number(rm[2])];
    repStartVec = [0, 1, 2].map((i) => +vis(rf + i * re, 0).toFixed(3));
    // 🔴 허용 0.06: Repeat 둘째 행(-12f)은 첫 프레임에 0.95 — 레인 R2 이전부터 있던 잔차(Repeat 불변 조건)
    const d = Math.max(...fillEndVec.map((v, i) => Math.abs(v - repStartVec[i])));
    if (d > 0.06) fail.push(`Fill 끝 문서함 [${fillEndVec}] ≠ Repeat 첫 프레임 [${repStartVec}] (최대차 ${d.toFixed(3)} > 0.06, 경계 깜빡임)`);
  }
  const fillEnd = fillEndVec.filter((v) => v > 0.5).length;
  const repStart = repStartVec ? repStartVec.filter((v) => v > 0.5).length : null;
  report.inbox = { sendTapAt: tap, rows: [inbox.from, inbox.second], thirdOutside: inbox.third, gapAfterTap: gap, fillEndRows: fillEnd, repeatStartRows: repStart, fillEndVis: fillEndVec, repeatStartVis: repStartVec };
  console.log(`문서함: 행 도착 ${inbox.from}·${inbox.second}f · 전송 탭 ${tap}f → 탭 뒤 ${gap}f(허용 6~12) · Fill 끝 [${fillEndVec}] · Repeat 첫 프레임 [${repStartVec}]`);
}

/* 레인 H(2026-09-30) — 손 컷아웃 경계 + 화면 경계를 넘는 프레임.
   사용자 지적(본편 Fill 146f 서명 창): 검지 뒤 손등 너클이 베젤 위에서 **직선으로 잘리고** 테두리가 하얗게 떴다.
   원인은 클립이 아니라 컷아웃 알파(너클 직선 홈·배경 섞인 후광·베젤 티끌·소매 이음매 반투명)였다.
   · 컷아웃 판정 = tools/make-hand-layer.py --check(윗선 홈 ≤2.5px · 후광 ≤6L · 피부 가장자리 티끌 ≤5 · 이음매 반투명 0).
     음성 대조: `--hand-cutout <684cbc0 의 hand-03.png>` → exit 1.
   · 손 층 클립 금지: HandLayer.tsx 에 clipPath·mask·overflow 없음(손은 화면·베젤·배경 어디서든 온전히).
   · 화면 경계를 넘는 프레임(손끝은 화면 안, 손등 윗선 표본점 중 하나라도 화면 밖) 목록 → 판정 스틸용. */
{
  const spec = hand.handLayerSpec();
  const hi = process.argv.indexOf("--hand-cutout");
  const cutout = hi > 0 ? path.resolve(process.cwd(), process.argv[hi + 1]) : path.join(root, "public/gen", spec.file);
  const r = spawnSync(process.platform === "win32" ? "python" : "python3", [path.join(root, "tools/make-hand-layer.py"), "--check", cutout, "--origin", spec.origin.join(","), "--tip", spec.tip.join(",")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  let edge = null;
  try { edge = JSON.parse((r.stdout || "").trim().split(/\r?\n/).pop()); } catch { /* 아래에서 실패 처리 */ }
  report.handEdge = edge ?? { error: (r.stderr || "").slice(-400) };
  if (!edge) fail.push(`손 컷아웃 경계 검사 실행 실패: ${(r.stderr || "").slice(-200)}`);
  else {
    console.log(`\n손 컷아웃 경계: 윗선 홈 ${edge.topNotchPx}px(≤${edge.limits.topNotchPx}) · 후광 ${edge.haloL}L(≤${edge.limits.haloL}) · 티끌 ${edge.darkFringePx}(≤${edge.limits.darkFringePx}) · 이음매 반투명 ${edge.seamPartialPx}(=0) · 윗 윤곽 내각 ${edge.silhouetteMinDeg}°(≥${edge.silhouetteLimitDeg}) — ${path.relative(root, cutout)}`);
    if (!edge.pass) fail.push(`손 컷아웃 경계 불통과: ${edge.fail.join(", ")}`);
  }
  const hl = fs.readFileSync(path.join(root, "src/components/HandLayer.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  if (/clipPath|clip-path|\bmask(Image)?\s*:|overflow\s*:/.test(hl)) fail.push("HandLayer.tsx 에 clipPath/mask/overflow — 손이 잘린다");

  // 검지 윗선·너클 표본점(원 사진 좌표, 손이 원위치일 때) — 손목·팔은 늘 화면 밖이라 넣지 않는다
  // 🔴 레인 H3D: 자리 = 3D 격자 투영점(src/hand3d.ts projectTexel — HandLayer.tsx 가 그리는 것과 같은 식)
  const TOP = [[820, 506], [860, 508], [900, 511], [935, 524]];
  const texel = (q) => [q[0] - spec.origin[0], q[1] - spec.origin[1]];
  const starts = { fill: durations.scenes.fill.startFrame, "repeat-1": durations.scenes.repeat.startFrame, "repeat-2": durations.scenes.repeat.startFrame + FIRST_LEN };
  report.edgeCross = {};
  for (const [name, keys, total] of [["fill", fill, fillTotal], ["repeat-1", rep1, FIRST_LEN + 12], ["repeat-2", rep2, repTotal - FIRST_LEN]]) {
    const fr = [];
    for (let f = 0; f < total; f++) {
      const p = h3.hand3dPose(spec, keys, f);
      if (!p.visible || !inQuad(p.tip)) continue;
      if (TOP.some((q) => !inQuad(h3.projectTexel(spec, p, ...texel(q))))) fr.push(f);
    }
    report.edgeCross[name] = { local: fr, main60: fr.map((f) => f + starts[name]) };
  }
  const nCross = Object.values(report.edgeCross).reduce((s, v) => s + v.local.length, 0);
  console.log(`화면 경계를 넘는 손 프레임: ${Object.entries(report.edgeCross).map(([k, v]) => `${k} ${v.local.length}`).join(" · ")} (합 ${nCross})`);
}

/*
 * 레인 H3D(2026-09-30) — 3D 손 층(three.js 휘는 격자 + 투영 그림자) 계약.
 *   ① 위치 계약: 3D 격자 손끝 텍셀의 **투영점** = poseAt tip(hand-path 좌표) — 전 프레임 오차 ≤ 0.5px.
 *   ② 닿음: 탭·서명 접촉 프레임에서 손끝 높이 z = 0(화면 평면), 떠 있을 때 z > 5. 격자 전 텍셀 z ≥ -2(화면 아래로 파고들지 않음).
 *   ③ 손등 마디(3D 투영점) 속도도 손끝과 같은 한도(평균 ≤45 · 최고 ≤80cm/s) — 구름·기울기가 손을 튀게 하지 않는다.
 *   ④ HandLayer 는 ThreeCanvas 1920x1080 한 장(사진 좌표 전체, 클립 없음) + 소재 = handLayerSpec().file(알파 재생성 금지), <Img> 폴백 금지.
 *   ⑤ 렌더 판정(선택, --video 와 함께 --video-start <영상 첫 프레임의 본편 번호>): 경계 교차 프레임에서 화면 변 직선 절단 0
 *      (tools/hand-stills.py --straight-cut). 음성 대조 = --straight-cut-selftest(화면 밖을 칠해 손을 자른 합성) → exit 1.
 */
{
  const spec = hand.handLayerSpec();
  const [W, H] = spec.size;
  const tipTex = [spec.tip[0] - spec.origin[0], spec.tip[1] - spec.origin[1]];
  const KNEE = [935 - spec.origin[0], 524 - spec.origin[1]];
  const r3 = { contractMaxPx: 0, touchMaxZ: 0, hoverMinZ: Infinity, minZ: Infinity, maxRotStepDeg: 0, maxRollStepDeg: 0, knee: {}, rollPeak: {}, pressPeak: {} };
  const grid = [];
  for (let v = 0; v <= H; v += 24) for (let u = 0; u <= W; u += 24) grid.push([u, v]);
  for (const [name, keys, total] of [["fill", fill, fillTotal], ["repeat-1", rep1, FIRST_LEN + 12], ["repeat-2", rep2, repTotal - FIRST_LEN]]) {
    const contactFrames = new Set();
    for (const k of keys) {
      if (k.kind === "tap") for (let f = k.t - hand.TAP_HOLD; f <= k.t; f++) contactFrames.add(f);
      if (k.kind === "sign") for (let f = k.t - hand.SIGN_LEN; f <= k.t; f++) contactFrames.add(f);
    }
    let prev = null, cur = null, prevPose = null;
    const moves = [];
    for (let f = 0; f < total; f++) {
      const p = h3.hand3dPose(spec, keys, f);
      if (!p.visible) { prev = null; prevPose = null; continue; }
      // 회전·구름 연속성 — 한 프레임 변화 ≤ 1.5°(atan2 ±π 넘어감으로 -7°→+7° 뒤집히던 결함의 재발 방지)
      if (prevPose) {
        r3.maxRotStepDeg = Math.max(r3.maxRotStepDeg, (Math.abs(p.rot - prevPose.rot) * 180) / Math.PI);
        r3.maxRollStepDeg = Math.max(r3.maxRollStepDeg, (Math.abs(p.roll - prevPose.roll) * 180) / Math.PI);
      }
      prevPose = p;
      /* v3.5 진단(판정 크롭 프레임 선정용): 구름 |각| 최대 · 눌림(zKnee - 무누름 마디 높이) 최대 프레임 */
      const rd = (Math.abs(p.roll) * 180) / Math.PI;
      if (!r3.rollPeak[name] || rd > r3.rollPeak[name].deg) r3.rollPeak[name] = { deg: +rd.toFixed(2), f };
      (r3._roll ??= {})[name] ??= [];
      r3._roll[name][f] = rd;
      if (contactFrames.has(f) && (!r3.pressPeak[name] || p.zKnee > r3.pressPeak[name].zKnee)) r3.pressPeak[name] = { zKnee: +p.zKnee.toFixed(1), f };
      const t = h3.projectTexel(spec, p, ...tipTex);
      r3.contractMaxPx = Math.max(r3.contractMaxPx, Math.hypot(t[0] - p.tip[0], t[1] - p.tip[1]));
      if (contactFrames.has(f)) r3.touchMaxZ = Math.max(r3.touchMaxZ, p.zTip);
      else if (p.lift > 0.3) r3.hoverMinZ = Math.min(r3.hoverMinZ, p.zTip);
      if (f % 15 === 0) for (const g of grid) r3.minZ = Math.min(r3.minZ, h3.texelWorld(spec, p, g[0], g[1])[2]);
      const kp = h3.projectTexel(spec, p, ...KNEE);
      if (prev) {
        const v = Math.hypot(kp[0] - prev[0], kp[1] - prev[1]) * CM_PER_PX * FPS;
        if (v > 3) { if (!cur) cur = { from: f - 1, dist: 0, peak: 0 }; cur.dist += v / FPS; cur.peak = Math.max(cur.peak, v); }
        else if (cur) { cur.to = f - 1; moves.push(cur); cur = null; }
      }
      prev = kp;
    }
    if (cur) { cur.to = total - 1; moves.push(cur); }
    const mv = moves
      .map((m) => ({ frames: `${m.from}-${m.to}`, distCm: +m.dist.toFixed(1), meanCmS: +(m.dist / ((m.to - m.from + 1) / FPS)).toFixed(1), peakCmS: +m.peak.toFixed(1) }))
      .filter((m) => m.distCm >= 1.5);
    for (const m of mv) {
      if (m.meanCmS > MEAN_LIMIT) fail.push(`3D ${name} 손등 마디 ${m.frames} 평균 ${m.meanCmS}cm/s > ${MEAN_LIMIT}`);
      if (m.peakCmS > PEAK_LIMIT) fail.push(`3D ${name} 손등 마디 ${m.frames} 최고 ${m.peakCmS}cm/s > ${PEAK_LIMIT}`);
    }
    /* v3.5 진단: 탭으로 끝나는 이동(탭 전 12f 이내에 끝남) 중 구름 최대 프레임 = 「손이 옆으로 옮겨가는」 판정 크롭 자리 */
    const taps = keys.filter((k) => k.kind === "tap").map((k) => k.t);
    let best = null;
    for (const m of moves) {
      if (m.dist < 1.5 || !taps.some((t) => t >= m.to && t - m.to <= 12)) continue;
      for (let f = m.from; f <= m.to; f++) { const d = r3._roll?.[name]?.[f] ?? 0; if (!best || d > best.deg) best = { deg: +d.toFixed(2), f }; }
    }
    (r3.rollPeakToTap ??= {})[name] = best;
    r3.knee[name] = { peakCmS: Math.max(0, ...mv.map((m) => m.peakCmS)), maxMeanCmS: Math.max(0, ...mv.map((m) => m.meanCmS)) };
  }
  if (r3.contractMaxPx > 0.5) fail.push(`3D 손끝 투영점이 hand-path 에서 ${r3.contractMaxPx.toFixed(2)}px 벗어남(≤0.5)`);
  if (r3.touchMaxZ > 0.01) fail.push(`3D 접촉 프레임 손끝 높이 ${r3.touchMaxZ.toFixed(2)} > 0 — 화면에 닿지 않는다`);
  if (!(r3.hoverMinZ > 5)) fail.push(`3D 떠 있는 손끝 높이 최소 ${r3.hoverMinZ} ≤ 5 — 들림이 없다`);
  if (r3.maxRotStepDeg > 1.5) fail.push(`3D 평면 회전이 한 프레임에 ${r3.maxRotStepDeg.toFixed(2)}° 튄다(≤1.5°)`);
  if (r3.maxRollStepDeg > 1.5) fail.push(`3D 구름이 한 프레임에 ${r3.maxRollStepDeg.toFixed(2)}° 튄다(≤1.5°)`);
  if (r3.minZ < -2) fail.push(`3D 격자가 화면 평면 아래로 ${r3.minZ.toFixed(1)}px 파고든다`);
  const hl = fs.readFileSync(path.join(root, "src/components/HandLayer.tsx"), "utf8");
  const code = hl.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  if (!/<ThreeCanvas[\s\S]*?width=\{CANVAS_W\}[\s\S]*?height=\{CANVAS_H\}/.test(code)) fail.push("HandLayer.tsx 가 ThreeCanvas(CANVAS_W x CANVAS_H) 로 손을 그리지 않는다(2D 폴백?)");
  if (/<Img\b/.test(code)) fail.push("HandLayer.tsx 에 <Img> — 2D 컷아웃 폴백이 남아 있다");
  if (!/staticFile\(`gen\/\$\{file\}`\)/.test(code) || !/handLayerSpec\(\)/.test(code)) fail.push("HandLayer.tsx 손 소재가 handLayerSpec().file 이 아니다");
  delete r3._roll;
  report.hand3d = { ...r3, hoverMinZ: +r3.hoverMinZ.toFixed(2), minZ: +r3.minZ.toFixed(2), contractMaxPx: +r3.contractMaxPx.toFixed(4) };
  console.log(`\n3D 손: 투영 손끝 오차 최대 ${r3.contractMaxPx.toFixed(3)}px(≤0.5) · 접촉 z 최대 ${r3.touchMaxZ.toFixed(2)} · 떠 있을 때 z 최소 ${r3.hoverMinZ.toFixed(1)} · 격자 z 최소 ${r3.minZ.toFixed(1)} · 회전/구름 한 프레임 최대 ${r3.maxRotStepDeg.toFixed(2)}°/${r3.maxRollStepDeg.toFixed(2)}° · 손등 마디 최고 ${Object.entries(r3.knee).map(([k, v]) => `${k} ${v.peakCmS}`).join("/")}cm/s`);

  /* ⑤ 렌더 판정 — 화면 변 직선 절단. 경계 교차 프레임마다 화면 사각형(본편 화소 좌표)을 내보내 python 이 검사 */
  const vi = process.argv.indexOf("--video");
  const si = process.argv.indexOf("--video-start");
  const selftest = process.argv.includes("--straight-cut-selftest");
  if (vi > 0 && si > 0) {
    const vStart = Number(process.argv[si + 1]);
    const starts = { fill: durations.scenes.fill.startFrame, "repeat-1": durations.scenes.repeat.startFrame };
    const { Easing } = await import("remotion");
    const easeOut = Easing.out(Easing.cubic);
    const PANE_W = Math.round(1920 * 0.58);
    const focus = ss.quadCentroid(quad);
    const sPane = Math.max(1.55, PANE_W / 1920, 1080 / 1080);
    const tx = Math.min(0, Math.max(PANE_W - 1920 * sPane, PANE_W / 2 - focus[0] * sPane));
    const ty = Math.min(0, Math.max(1080 - 1080 * sPane, 1080 / 2 - focus[1] * sPane));
    // Photo.tsx: scale(from→to, EASE_OUT, 장면 전체) 가운데 기준 → ShotView.tsx StagePane translate+scale (Fill·Repeat 공통 zoom 1.55)
    const toRender = (pt, sceneFrame, from, to, dur) => {
      const k = easeOut(Math.min(1, Math.max(0, sceneFrame / dur)));
      const sc = from + (to - from) * k;
      const x = 960 + (pt[0] - 960) * sc, y = 540 + (pt[1] - 540) * sc;
      return [+(tx + x * sPane).toFixed(2), +(ty + y * sPane).toFixed(2)];
    };
    const items = [];
    for (const [name, v] of Object.entries(report.edgeCross)) {
      const isFill = name === "fill";
      for (const m of v.main60) {
        const sceneF = isFill ? m - starts.fill : m - starts["repeat-1"];
        const [a, b, dur] = isFill ? [1.0, 1.05, fillTotal] : [1.05, 1.08, repTotal];
        items.push({ frame: m - vStart, main60: m, quad: [quad.tl, quad.tr, quad.br, quad.bl].map((q) => toRender(q, sceneF, a, b, dur)) });
      }
    }
    const jf = path.join(root, "out/check/v33h3d-edge-quads.json");
    fs.mkdirSync(path.dirname(jf), { recursive: true });
    fs.writeFileSync(jf, JSON.stringify(items));
    const args = [path.join(root, "tools/hand-stills.py"), "--straight-cut", path.resolve(root, process.argv[vi + 1]), jf];
    if (selftest) args.push("--selftest");
    const r = spawnSync(process.platform === "win32" ? "python" : "python3", args, { cwd: root, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    const out = (r.stdout || "").trim().split(/\r?\n/).pop();
    report.straightCut = { exit: r.status, summary: out, selftest };
    console.log(`화면 변 직선 절단(렌더): ${out}${selftest ? " [음성 대조]" : ""}`);
    if (r.status !== 0) fail.push(`화면 변 직선 절단 검출: ${out || (r.stderr || "").slice(-300)}`);
  }
}

/*
 * 레인 HF(2026-09-30) — 손 실루엣 스파이크(접힌 가운데·약지 마디가 삼각형으로 솟음, 사용자 지적 v3.4 631f).
 *   ① 소재: make-hand-layer.py --check 안의 tools/silhouette_spikes.py(윗 윤곽 k=8 현 내각 ≥ 한도) — 위 컷아웃 블록.
 *   ② 렌더: 같은 윤곽을 3D 격자 투영(projectTexel = HandLayer 가 그리는 식)으로 옮겨, 접촉 프레임마다 투영 실루엣의
 *      윗 윤곽 내각 최솟값 ≥ 한도. 평면(HAND3D_VARIANTS.hF) 투영과의 차 = 렌더 단계 기여(진단 출력).
 *      음성 대조: `--hand-cutout <d6ead93 의 hand-03.png>` → 소재·렌더 모두 불통과.
 */
{
  const spec = hand.handLayerSpec();
  const hi = process.argv.indexOf("--hand-cutout");
  const cutout = hi > 0 ? path.resolve(process.cwd(), process.argv[hi + 1]) : path.join(root, "public/gen", spec.file);
  const dump = path.join(os.tmpdir(), `hf-contour-${process.pid}.json`);
  const r = spawnSync(process.platform === "win32" ? "python" : "python3", [path.join(root, "tools/silhouette_spikes.py"), cutout, "--origin", spec.origin.join(","), "--tip", spec.tip.join(","), "--dump-contour", dump], {
    cwd: root, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (!fs.existsSync(dump)) fail.push(`실루엣 윤곽 추출 실패: ${(r.stderr || "").slice(-200)}`);
  else {
    const C = JSON.parse(fs.readFileSync(dump, "utf8"));
    fs.rmSync(dump, { force: true });
    const K = C.k, LIMIT = C.limit, n = C.points.length;
    // silhouette_spikes.interior_angles 와 같은 식(볼록 = 180 미만). 투영이 방향을 뒤집지 않으므로 부호 면적으로 판별
    const minAngle = (P) => {
      let area = 0;
      for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
      let mn = 999, at = null;
      for (let i = 0; i < n; i++) {
        if (!C.include[i]) continue;
        const p = P[i], a = P[(i - K + n) % n], b = P[(i + K) % n];
        const ax = a[0] - p[0], ay = a[1] - p[1], bx = b[0] - p[0], by = b[1] - p[1];
        const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) + 1e-9);
        let deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
        const convex = Math.sign(ax * by - ay * bx) === -Math.sign(area);
        if (!convex) deg = 360 - deg;
        if (deg < mn) { mn = deg; at = C.points[i]; }
      }
      return { mn, at };
    };
    const src = minAngle(C.points);
    const rs = { limitDeg: LIMIT, k: K, sourceMinDeg: +src.mn.toFixed(1), frames: [], minDeg: 999, flatMinDeg: 999, maxRenderDeltaDeg: 0 };
    for (const [name, keys, total] of [["fill", fill, fillTotal], ["repeat-1", rep1, FIRST_LEN + 12], ["repeat-2", rep2, repTotal - FIRST_LEN]]) {
      const contact = [];
      for (const k of keys) {
        if (k.kind === "tap") for (let f = k.t - hand.TAP_HOLD; f <= k.t; f++) contact.push(f);
        if (k.kind === "sign") for (let f = k.t - hand.SIGN_LEN; f <= k.t; f++) contact.push(f);
      }
      for (const f of [...new Set(contact)].filter((f) => f >= 0 && f < total)) {
        const p = h3.hand3dPose(spec, keys, f);
        if (!p.visible) continue;
        const pf = h3.hand3dPose(spec, keys, f, h3.HAND3D_VARIANTS.hF);
        const P3 = C.points.map(([u, v]) => h3.projectTexel(spec, p, u, v));
        const PF = C.points.map(([u, v]) => { const w = h3.texelWorld(spec, pf, u, v, h3.HAND3D_VARIANTS.hF); return h3.project(w[0], w[1], w[2]); });
        const a3 = minAngle(P3).mn, af = minAngle(PF).mn;
        rs.frames.push({ cut: name, f, deg: +a3.toFixed(1), flatDeg: +af.toFixed(1) });
        rs.minDeg = Math.min(rs.minDeg, a3);
        rs.flatMinDeg = Math.min(rs.flatMinDeg, af);
        rs.maxRenderDeltaDeg = Math.max(rs.maxRenderDeltaDeg, Math.abs(a3 - af));
      }
    }
    rs.minDeg = +rs.minDeg.toFixed(1); rs.flatMinDeg = +rs.flatMinDeg.toFixed(1); rs.maxRenderDeltaDeg = +rs.maxRenderDeltaDeg.toFixed(2);
    report.silhouette = rs;
    console.log(`\n손 실루엣 스파이크(윗 윤곽, k=${K}): 소재 ${rs.sourceMinDeg}° · 접촉 ${rs.frames.length}프레임 투영 최소 ${rs.minDeg}°(평면 ${rs.flatMinDeg}°, 렌더 기여 최대 ${rs.maxRenderDeltaDeg}°) — 한도 ≥${LIMIT}° — ${path.relative(root, cutout)}`);
    if (rs.frames.length < 3) fail.push(`실루엣 검사 접촉 프레임 ${rs.frames.length} < 3`);
    if (rs.sourceMinDeg < LIMIT) fail.push(`손 소재 윗 윤곽 스파이크 ${rs.sourceMinDeg}° < ${LIMIT}° (${src.at?.map((x) => x.toFixed(0)).join(",")})`);
    if (rs.minDeg < LIMIT) fail.push(`렌더 투영 실루엣 스파이크 ${rs.minDeg}° < ${LIMIT}°`);
  }
}

fs.mkdirSync(path.join(root, "out/check"), { recursive: true });
fs.writeFileSync(path.join(root, "out/check/v33v-motion.json"), JSON.stringify(report, null, 2));
for (const [n, c] of Object.entries(report.cuts)) {
  console.log(`\n[${n}] 탭 ${c.taps.length}개(화면 안 ${c.taps.filter((x) => x.inScreen).length})`);
  for (const m of c.moves) console.log(`  이동 ${m.frames.padEnd(9)} ${String(m.distCm).padStart(5)}cm  평균 ${String(m.meanCmS).padStart(5)}cm/s  최고 ${String(m.peakCmS).padStart(5)}cm/s`);
}
console.log(`\n바탕: ${report.plates.unique.join(", ")} → ${report.plates.file}`);
{
  const st = report.cuts.fill.longestStall;
  console.log(`Fill 전송 확인 앞 손 머묾 최장: ${st.from}~${st.to}f = ${st.frames}f (${st.sec}초, 허용 ${STALL_LIMIT}f)`);
}
if (fail.length) { console.log("\nFAIL"); fail.forEach((x) => console.log("  X " + x)); process.exit(1); }
console.log("\nPASS — 손 궤적·바탕 한 장");
