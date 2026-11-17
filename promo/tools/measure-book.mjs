#!/usr/bin/env node
/**
 * 방명록 지면 4점을 **화소 스캔**으로 재측정한다.
 *
 * 왜 스크립트인가: 생성 이미지(gen-01.png)는 기획 피드백에 따라 수시로 다시 만들어져
 * 덮어써진다. 그때마다 사람이 눈으로 격자를 읽어 좌표를 코드에 박으면 (a) 매번 틀리고
 * (b) 코드와 이미지가 어긋난 채 남는다. 2026-09-18 에 실제로 둘 다 났다 —
 * 육안 격자 측정이 우변을 120px 틀렸고, 작업 도중 gen-01.png 이 다른 구도로 교체됐다.
 *
 * 쓰는 법:
 *   node tools/measure-book.mjs --seed "140,762 700,748 592,912 29,866"
 *   node tools/measure-book.mjs --seed "..." --write        # prompts.json 에 기록
 *   node tools/measure-book.mjs --grid                      # 좌표 읽기용 격자 확대본만 출력
 *
 * --seed 는 **펼친 지면 전체(양쪽 페이지)** 의 네 꼭짓점을 화면 순서
 * (좌상 → 우상 → 우하 → 좌하) 로 준다. 대충 읽어도 된다 — 아래 3단계가 보정한다:
 *   ① 종이 화소 마스크(밝고 채도 낮음)를 seed 내부 표본으로 자동 보정해 만든다
 *   ② seed 네 변마다 법선 방향으로 마스크 경계를 찾아 최소제곱 직선을 맞춘다
 *   ③ 인접 직선을 교차시켜 꼭짓점을 확정한다 (= 육안 오차 제거)
 *
 * 그 다음 펼침면을 책등(gutter)에서 **좌·우 두 쪽**으로 잘라, 각 쪽을
 * 쓰는 사람 기준 페이지 로컬 좌표(tl/tr/br/bl)로 재배정해 출력한다.
 *
 * 🔴 로컬 좌표 배정 규칙 — **이미지마다 다시 도출해야 한다**.
 *   축은 「책등(crease)이 화면에서 어느 방향으로 뻗는가」로 정해진다.
 *   글줄은 항상 책등에 **수직**이고, 줄은 책등과 **나란히** 쌓인다.
 *
 *   ┌ 2차 gen-01 (책등이 카운터와 나란히 = 화면 가로) ────────────────┐
 *   │ 글줄 = 화면 깊이 방향. 이 판정은 그 이미지 전용이다.            │
 *   └──────────────────────────────────────────────────────────────┘
 *   ┌ 3차 gen-01 (2026-09-18 15:37, 현재) ──────────────────────────┐
 *   │ 책등이 카운터 앞모서리에 **수직** = 화면에서 근→원 깊이 방향.  │
 *   │ 따라서 글줄은 그 직각 = **화면 가로**(왼쪽이 멀어 작아진다),   │
 *   │ 줄은 먼 변(위) → 쓰는 사람 쪽(아래)으로 쌓인다.                │
 *   │ 펼침면은 책등에서 **좌·우**로 갈린다. 펜은 오른쪽 페이지.      │
 *   └──────────────────────────────────────────────────────────────┘
 *
 *   배정표 (페이지 로컬 ↔ 펼침면 화면 꼭짓점), 3차 구도:
 *     왼쪽 페이지  local tl = 펼침면 farLeft   tr = 책등×far
 *                  local bl = 펼침면 nearLeft  br = 책등×near
 *     오른쪽 페이지 local tl = 책등×far         tr = 펼침면 farRight
 *                  local bl = 책등×near        br = 펼침면 nearRight
 *   즉 local +x = 글줄 진행(왼→오른), local +y = 줄 쌓임(먼→가까운).
 *   배정이 뒤집히면(거울상) shoelace 부호로 잡아 에러를 낸다.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const IMAGE = String(arg("image", "public/gen/gen-01.png"));
const SCENE = Number(arg("scene", 1));
/** 책등의 위치 — 펼침면 far/near 변을 **왼쪽에서부터** 자르는 비율 */
const GUTTER_FRAC = Number(arg("gutter", 0.45));
/**
 * 변 보정 시 법선 방향으로 훑는 거리(px).
 * 🔴 크면 종이 밖의 **다른 밝고 무채색인 것**(창·흰 벽·블러된 배경)을 종이 경계로
 *    잘못 집는다. 2026-09-18 3차 gen-01 에서 search 46 이 먼 변을 카운터 너머 밝은
 *    배경까지 끌고 올라가 지면이 아닌 사각형을 냈다(육안 오버레이로만 잡힌다).
 *    먼 변 바깥이 곧 배경인 구도면 16~24 로 줄인다.
 */
const SEARCH = Number(arg("search", 46));
const WRITE = Boolean(arg("write", false));
const GRID_ONLY = Boolean(arg("grid", false));
const OVERLAY = String(arg("overlay", "out/check/paper-book-axes.png"));

const imgPath = path.join(ROOT, IMAGE);
if (!fs.existsSync(imgPath)) {
  console.error(`이미지 없음: ${imgPath}`);
  process.exit(1);
}

/* ── 1. 디코드 ─────────────────────────────────────────────── */
function probeSize(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  ).trim();
  const [w, h] = out.split(",").map(Number);
  return { w, h };
}

const { w: W, h: H } = probeSize(imgPath);
const raw = execFileSync("ffmpeg", ["-v", "error", "-i", imgPath, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
  maxBuffer: 1 << 28,
});
if (raw.length !== W * H * 3) {
  console.error(`raw 크기 불일치: ${raw.length} != ${W * H * 3}`);
  process.exit(1);
}
const at = (x, y) => {
  const o = (y * W + x) * 3;
  return [raw[o], raw[o + 1], raw[o + 2]];
};

/* ── 격자 확대본(좌표 읽기용) ───────────────────────────────── */
if (GRID_ONLY) {
  const dst = path.join(ROOT, "out/check/paper-book-grid.png");
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-i", imgPath,
    "-vf",
    "crop=960:540:0:540,scale=1920:1080:flags=lanczos," +
      "drawgrid=width=100:height=100:thickness=2:color=red@0.45," +
      "drawgrid=width=400:height=400:thickness=4:color=cyan@0.9",
    dst,
  ]);
  console.log(`격자 확대본: ${dst}  (crop x0-960 y540-1080 @2x · 빨강 50px · 하늘 200px 원본 단위)`);
  process.exit(0);
}

/* ── 괘선 간격(rule pitch) 측정 ─────────────────────────────
 *
 * 왜 필요한가(2026-09-21): 손글씨 크기를 px 로 정하면 지면을 덮어 붙인 것처럼 보인다.
 * 사람이 종이에 쓸 때 글자 높이는 **괘선 간격**에 종속된다(보통 0.6~0.8배).
 * 그래서 괘선 간격을 이미지에서 재고, 글자 크기·줄 위치를 그 배수로만 잡는다.
 *
 * 방법: prompts.json 의 페이지 쿼드(화면 좌표)를 **페이지 로컬**(pageLocalFromScreen) 로
 * 돌린 뒤, 단위정사각형→쿼드 homography 로 로컬 v(줄 쌓임) 방향 밝기 프로파일을 뽑는다.
 * 이동평균으로 디트렌드 → 자기상관 최댓값 = 주기(로컬 px) → 위상 = 첫 괘선 위치.
 *
 * 🔴 FFT 최댓값만 보면 종이 질감·음영의 저주파에 끌려간다(4차 측정의 "17줄"이 그랬다).
 *    자기상관 + 디트렌드 + 물리적 하한(로컬 pitch ≥ 화면 2.5px 상당)이 그것을 막는다.
 *
 *   node tools/measure-book.mjs --rule-pitch            # 측정 + 근거 오버레이
 *   node tools/measure-book.mjs --rule-pitch --write    # prompts.json geometry.ruling 기록
 */
const RULE_PITCH = Boolean(arg("rule-pitch", false));
if (RULE_PITCH) {
  const PAGE_W = Number(arg("page-width", 620));
  const PAGE_H = Number(arg("page-height", 880));
  const pj0 = path.join(ROOT, "public/gen/prompts.json");
  const j0 = JSON.parse(fs.readFileSync(pj0, "utf8"));
  const g0 = j0.scenes.find((s) => s.scene === SCENE)?.geometry;
  if (!g0 || !g0.pages) {
    console.error("prompts.json 에 geometry.pages 가 없다 — 먼저 --seed 로 지면을 측정하라");
    process.exit(1);
  }
  const rot180q = (c) => ({ tl: c.br, tr: c.bl, br: c.tl, bl: c.tr });
  const toLocalQ = (q) => (g0.pageLocalFromScreen === "rot180" ? rot180q(q) : q);

  /** 단위정사각형 (u,v)∈[0,1]² → 쿼드. 표준 사영변환(3x3) */
  function unitToQuad(q) {
    const [x0, y0] = q.tl;
    const [x1, y1] = q.tr;
    const [x2, y2] = q.br;
    const [x3, y3] = q.bl;
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const sx = x0 - x1 + x2 - x3;
    const sy = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1;
    const g = (sx * dy2 - dx2 * sy) / den;
    const h = (dx1 * sy - sx * dy1) / den;
    return [
      [x1 - x0 + g * x1, x3 - x0 + h * x3, x0],
      [y1 - y0 + g * y1, y3 - y0 + h * y3, y0],
      [g, h, 1],
    ];
  }
  const applyH = (M, u, v) => {
    const w = M[2][0] * u + M[2][1] * v + M[2][2];
    return [(M[0][0] * u + M[0][1] * v + M[0][2]) / w, (M[1][0] * u + M[1][1] * v + M[1][2]) / w];
  };
  /** 3x3 역행렬 — 화면 좌표를 페이지 로컬로 되돌린다 */
  function invert3(m) {
    const [a, b, c] = m[0];
    const [d, e, f] = m[1];
    const [g, h, i] = m[2];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [
      [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
      [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
    ];
  }
  const lumAt = (x, y) => {
    const xi = Math.max(0, Math.min(W - 2, Math.floor(x)));
    const yi = Math.max(0, Math.min(H - 2, Math.floor(y)));
    const fx = x - xi;
    const fy = y - yi;
    const L = (px, py) => {
      const o = (py * W + px) * 3;
      return 0.299 * raw[o] + 0.587 * raw[o + 1] + 0.114 * raw[o + 2];
    };
    return (
      L(xi, yi) * (1 - fx) * (1 - fy) +
      L(xi + 1, yi) * fx * (1 - fy) +
      L(xi, yi + 1) * (1 - fx) * fy +
      L(xi + 1, yi + 1) * fx * fy
    );
  };

  function drawSeg(buf, a, b, rgb, thick) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) * 2;
    for (let i = 0; i <= n; i++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * i) / n);
      const y = Math.round(a[1] + ((b[1] - a[1]) * i) / n);
      for (let oy = -thick; oy <= thick; oy++) {
        const yy = y + oy;
        if (x < 0 || yy < 0 || x >= W || yy >= H) continue;
        const o = (yy * W + x) * 3;
        buf[o] = rgb[0];
        buf[o + 1] = rgb[1];
        buf[o + 2] = rgb[2];
      }
    }
  }

  const results = {};
  const marks = [];
  for (const side of ["left", "right"]) {
    const q = toLocalQ(g0.pages[side]);
    const M = unitToQuad(q);
    /** 로컬 v 1px 당 화면 몇 px 인가 — 물리적 하한 판정용 */
    const p0 = applyH(M, 0.5, 0);
    const p1 = applyH(M, 0.5, 1);
    const vScale = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / PAGE_H;
    const N = PAGE_H;
    /**
     * 🔴 **로컬(u,v)로 역매핑한 프로파일의 자기상관은 이 그림에서 통하지 않는다**
     *    (2026-09-21 실측). 인쇄 괘선의 진폭은 밝기 2~4 뿐인데 지면 전폭을 평균 내면
     *    쿼드 꼭짓점 오차만큼 괘선이 서로 어긋나 상쇄되고, 남는 것은 조명 그라데이션이다.
     *    전단(shear) 탐색을 ±0.5 까지 넓혀도 자기상관은 **단조 감소**만 했다.
     *    앞선 측정의 "한 쪽 17줄" 은 그 잡음에 붙인 허수였다.
     *
     *    통하는 방법 = **화면 세로 열 스캔 + 국소 최솟값(괘선) 검출**. 폭 5px 짜리 좁은 열은
     *    괘선이 뭉개지지 않아 골이 또렷하다. 찾은 골의 화면 좌표를 **역 homography** 로
     *    페이지 로컬로 되돌려 간격을 재면 원근·기울기가 저절로 보정된다.
     */
    const Minv = invert3(M);
    const toLocalUV = (x, y) => {
      const w = Minv[2][0] * x + Minv[2][1] * y + Minv[2][2];
      return [(Minv[0][0] * x + Minv[0][1] * y + Minv[0][2]) / w, (Minv[1][0] * x + Minv[1][1] * y + Minv[1][2]) / w];
    };
    const corners = [q.tl, q.tr, q.br, q.bl];
    const xMin = Math.min(...corners.map((p) => p[0]));
    const xMax = Math.max(...corners.map((p) => p[0]));
    const yMin = Math.min(...corners.map((p) => p[1]));
    const yMax = Math.max(...corners.map((p) => p[1]));
    const COLS = 13;
    /** 지면 안쪽만 본다 — 가장자리·책등·손은 제외 */
    const IN0 = 0.12;
    const IN1 = 0.88;
    const diffs = [];
    const hits = [];
    for (let c = 0; c < COLS; c++) {
      const x = Math.round(xMin + ((xMax - xMin) * (c + 0.5)) / COLS);
      /** 이 열에서 지면 안쪽에 해당하는 화면 y 구간 */
      const ys = [];
      for (let y = Math.floor(yMin); y <= Math.ceil(yMax); y++) {
        const [u, v] = toLocalUV(x, y);
        if (u >= IN0 && u <= IN1 && v >= IN0 && v <= IN1) ys.push(y);
      }
      if (ys.length < 24) continue;
      const prof = ys.map((y) => {
        let s = 0;
        for (let d = -2; d <= 2; d++) s += lumAt(x + d, y);
        return s / 5;
      });
      /** 국소 디트렌드(창 = 화면 25px) + 표준편차 */
      const det = prof.map((p, i) => {
        const a = Math.max(0, i - 12);
        const b = Math.min(prof.length, i + 13);
        let s = 0;
        for (let k = a; k < b; k++) s += prof[k];
        return p - s / (b - a);
      });
      const sd = Math.sqrt(det.reduce((s, d) => s + d * d, 0) / det.length) || 1;
      /** 골(어두운 줄) = 국소 최솟값 + 깊이 문턱 */
      const mins = [];
      for (let i = 2; i < det.length - 2; i++) {
        if (det[i] > -0.55 * sd) continue;
        if (det[i] > det[i - 1] || det[i] > det[i + 1]) continue;
        if (mins.length && i - mins[mins.length - 1] < 3) {
          if (det[i] < det[mins[mins.length - 1]]) mins[mins.length - 1] = i;
          continue;
        }
        mins.push(i);
      }
      const locals = mins.map((i) => toLocalUV(x, ys[i])[1] * PAGE_H);
      for (const v of locals) hits.push(v);
      for (let k = 1; k < locals.length; k++) {
        const d = Math.abs(locals[k] - locals[k - 1]);
        if (d > 4) diffs.push(d);
      }
    }
    if (diffs.length < 6) {
      console.error(`🔴 ${side} 페이지에서 괘선 골을 못 찾았다 — 지면 쿼드나 이미지 대비를 확인하라`);
      process.exit(1);
    }
    /**
     * 간격의 중앙값 → 건너뛴 줄(2·3배)은 배수로 접어 다시 중앙값.
     * 중앙값을 쓰는 이유: 손·펜·그림자가 만든 가짜 골이 섞여도 흔들리지 않는다.
     */
    const median = (a) => {
      const s = a.slice().sort((x, y) => x - y);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };
    let m0 = median(diffs);
    for (let it = 0; it < 3; it++) {
      const folded = diffs
        .map((d) => {
          const k = Math.round(d / m0);
          return k >= 1 && k <= 4 && Math.abs(d / k - m0) < m0 * 0.25 ? d / k : null;
        })
        .filter((d) => d !== null);
      if (folded.length < 5) break;
      m0 = median(folded);
    }
    const pitch = m0;
    const inliers = diffs.filter((d) => Math.abs(d / Math.round(d / pitch) - pitch) < pitch * 0.25);
    /** 위상 = 골 위치의 주기 접힘 원형 평균 */
    let sx = 0;
    let sy = 0;
    for (const v of hits) {
      const t = (2 * Math.PI * v) / pitch;
      sx += Math.cos(t);
      sy += Math.sin(t);
    }
    let phase = ((Math.atan2(sy, sx) / (2 * Math.PI)) * pitch + pitch) % pitch;
    const coherence = Math.hypot(sx, sy) / Math.max(hits.length, 1);
    if (arg("rule-debug", false)) {
      console.log(`[debug ${side}] 골 ${hits.length}개 · 간격표본 ${diffs.length} · inlier ${inliers.length} · pitch ${pitch.toFixed(1)} · 위상일치도 ${coherence.toFixed(2)}`);
      console.log("[debug] diffs=" + diffs.map((d) => d.toFixed(0)).join(","));
    }
    results[side] = {
      pitch: Number(pitch.toFixed(2)),
      rules: Number((PAGE_H / pitch).toFixed(2)),
      firstRuleAt: Number(phase.toFixed(2)),
      samples: diffs.length,
      inliers: inliers.length,
      phaseCoherence: Number(coherence.toFixed(3)),
      screenPitchPx: Number((pitch * vScale).toFixed(2)),
    };
    for (let y = phase; y < N; y += pitch) marks.push({ M, y });
  }

  /** 근거 오버레이 — 검출한 괘선을 지면 위에 그대로 그린다 */
  const ov2 = Buffer.from(raw);
  const MAG = [255, 60, 200];
  for (const m of marks) {
    const v = m.y / PAGE_H;
    drawSeg(ov2, applyH(m.M, 0.06, v), applyH(m.M, 0.94, v), MAG, 0);
  }
  const dst2 = path.join(ROOT, String(arg("rule-overlay", "out/check/paper-rule-pitch.png")));
  fs.mkdirSync(path.dirname(dst2), { recursive: true });
  const tmp2 = path.join(path.dirname(dst2), ".rule-pitch.raw");
  fs.writeFileSync(tmp2, ov2);
  const allp = ["left", "right"].flatMap((s) => {
    const q = toLocalQ(g0.pages[s]);
    return [q.tl, q.tr, q.br, q.bl];
  });
  const pad2 = 50;
  const cx2 = Math.max(0, Math.floor(Math.min(...allp.map((p) => p[0])) - pad2));
  const cy2 = Math.max(0, Math.floor(Math.min(...allp.map((p) => p[1])) - pad2));
  const cw2 = Math.min(W - cx2, Math.ceil(Math.max(...allp.map((p) => p[0])) - cx2 + pad2));
  const ch2 = Math.min(H - cy2, Math.ceil(Math.max(...allp.map((p) => p[1])) - cy2 + pad2));
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-i", tmp2,
    "-vf", `crop=${cw2}:${ch2}:${cx2}:${cy2},scale=${cw2 * 4}:${ch2 * 4}:flags=lanczos`,
    dst2,
  ]);
  fs.unlinkSync(tmp2);
  /**
   * 🔴 **펜 끝이 어느 칸인가**도 눈대중이 아니라 역매핑으로 정한다.
   *    `--pen "733,819"` 로 화면 좌표를 주면 writerSide 페이지의 로컬 y 와 칸 번호를 낸다.
   *    괘선 pitch 가 바뀌면 칸 번호도 통째로 바뀌므로 여기서 같이 낸다.
   */
  const penArg = arg("pen", false);
  let penTip = null;
  if (typeof penArg === "string") {
    const [px, py] = penArg.split(",").map(Number);
    const wside = g0.writerSide === "left" ? "left" : "right";
    const qw = toLocalQ(g0.pages[wside]);
    const Mw = unitToQuad(qw);
    const Mi = invert3(Mw);
    const w = Mi[2][0] * px + Mi[2][1] * py + Mi[2][2];
    const lu = ((Mi[0][0] * px + Mi[0][1] * py + Mi[0][2]) / w) * PAGE_W;
    const lv = ((Mi[1][0] * px + Mi[1][1] * py + Mi[1][2]) / w) * PAGE_H;
    const r = results[wside];
    penTip = {
      screen: [px, py],
      page: wside,
      local: [Number(lu.toFixed(1)), Number(lv.toFixed(1))],
      slot: Math.max(0, Math.round((lv - r.firstRuleAt) / r.pitch)),
    };
  }
  const ruling = {
    $comment:
      "괘선 간격(페이지 로컬 px, pageWidth×pageHeight 기준). 글자 높이는 이 pitch 의 0.7~0.8 이고 " +
      "한 칸(=한 사람)은 괘선 **한 줄**만 쓴다(이름·연락처는 같은 줄에 나란히). " +
      "재측정 = node tools/measure-book.mjs --rule-pitch [--pen \"x,y\"] --write",
    pageWidth: PAGE_W,
    pageHeight: PAGE_H,
    method: "화면 세로 열 스캔(폭 5px, 13열) → 국소 디트렌드 → 괘선 골 검출 → 역 homography 로 페이지 로컬 간격 → 배수 접기 후 중앙값",
    measuredAt: new Date().toISOString(),
    left: results.left,
    right: results.right,
    penTip,
  };
  console.log(JSON.stringify(ruling, null, 2));
  console.log(`괘선 근거 오버레이(4배): ${dst2}`);
  if (WRITE) {
    const sc0 = j0.scenes.find((s) => s.scene === SCENE);
    sc0.geometry = { ...sc0.geometry, ruling };
    fs.writeFileSync(pj0, JSON.stringify(j0, null, 2) + "\n");
    console.log(`prompts.json scenes[${SCENE}].geometry.ruling 기록 완료`);
  }
  process.exit(0);
}


/* ── 2. seed ──────────────────────────────────────────────── */
const seedStr = String(arg("seed", "140,762 700,748 592,912 29,866"));
const seed = seedStr
  .trim()
  .split(/\s+/)
  .map((p) => p.split(",").map(Number));
if (seed.length !== 4 || seed.some((p) => p.length !== 2 || p.some(Number.isNaN))) {
  console.error('--seed 형식: "x,y x,y x,y x,y" (좌상 우상 우하 좌하, 화면 순서)');
  process.exit(1);
}

/* ── 3. 종이 마스크 ────────────────────────────────────────── */
const centroid = seed.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
/** seed 사각형 안쪽(무게중심 쪽으로 65% 수축)에서 종이색 표본을 뽑는다 */
const samples = [];
for (const p of seed) {
  for (let t = 0.35; t <= 0.85; t += 0.1) {
    const x = Math.round(p[0] + (centroid[0] - p[0]) * t);
    const y = Math.round(p[1] + (centroid[1] - p[1]) * t);
    samples.push(at(x, y));
  }
}
const med = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const sat = ([r, g, b]) => {
  const mx = Math.max(r, g, b);
  return mx ? (mx - Math.min(r, g, b)) / mx : 0;
};
const refLum = med(samples.map(lum));
const refSat = med(samples.map(sat));
/** 종이 = 표본 밝기의 82% 이상 + 표본 채도의 1.7배 이하 (나무 상판·검정 표지 배제) */
const LUM_MIN = refLum * 0.82;
const SAT_MAX = Math.max(refSat * 1.7, 0.12);
const isPaper = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const c = at(x, y);
  return lum(c) >= LUM_MIN && sat(c) <= SAT_MAX;
};

/* ── 4. 변 보정 ───────────────────────────────────────────── */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => mul(a, 1 / (len(a) || 1));

/** seed 변(a→b)을 따라 표본을 찍고, 안쪽 법선 방향으로 마스크 경계를 찾아 직선을 맞춘다 */
function refineEdge(a, b, inward, search = SEARCH, n = 48) {
  const pts = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const base = add(a, mul(sub(b, a), t));
    /** 안쪽으로 들어가며 마지막 종이 화소를 찾고, 거기서 바깥 경계를 확정한다 */
    let hit = null;
    for (let d = search; d >= -search; d--) {
      const p = add(base, mul(inward, d));
      const x = Math.round(p[0]);
      const y = Math.round(p[1]);
      if (isPaper(x, y)) {
        hit = p;
      } else if (hit && d < 0) {
        break;
      }
    }
    /** 바깥에서 안으로 들어오며 최초 종이 화소 = 경계 */
    let edge = null;
    for (let d = -search; d <= search; d++) {
      const p = add(base, mul(inward, d));
      if (isPaper(Math.round(p[0]), Math.round(p[1]))) {
        edge = p;
        break;
      }
    }
    if (edge && hit) pts.push(edge);
  }
  if (pts.length < 8) throw new Error("변 보정 실패: 종이 경계 표본 부족 — seed 나 마스크 임계 확인");
  /** 총 2회 최소제곱 + 이상치 제거 */
  let inliers = pts;
  let line = null;
  for (let pass = 0; pass < 2; pass++) {
    line = fitLine(inliers);
    const res = inliers.map((p) => Math.abs(distToLine(p, line)));
    const m = med(res);
    inliers = inliers.filter((p, i) => res[i] <= Math.max(m * 2.5, 2));
    if (inliers.length < 8) break;
  }
  return { line, count: inliers.length, total: pts.length };
}

/** 직선을 (점 c, 방향 d) 로 최소제곱(총최소제곱 = PCA) 맞춤 */
function fitLine(pts) {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cy = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { c: [cx, cy], d: [Math.cos(theta), Math.sin(theta)] };
}
const distToLine = (p, L) => {
  const v = sub(p, L.c);
  return v[0] * -L.d[1] + v[1] * L.d[0];
};
function intersect(L1, L2) {
  const [x1, y1] = L1.c;
  const [dx1, dy1] = L1.d;
  const [x2, y2] = L2.c;
  const [dx2, dy2] = L2.d;
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < 1e-9) throw new Error("두 변이 평행 — 교차 불가");
  const t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / den;
  return [x1 + dx1 * t, y1 + dy1 * t];
}

const [s0, s1, s2, s3] = seed;
/** 각 변의 "안쪽" 방향 = 그 변 중점에서 무게중심 쪽 */
const inwardOf = (a, b) => norm(sub(centroid, mul(add(a, b), 0.5)));
const top = refineEdge(s0, s1, inwardOf(s0, s1));
const right = refineEdge(s1, s2, inwardOf(s1, s2));
const bottom = refineEdge(s2, s3, inwardOf(s2, s3));
const left = refineEdge(s3, s0, inwardOf(s3, s0));

const Praw = {
  tl: intersect(left.line, top.line),
  tr: intersect(top.line, right.line),
  br: intersect(right.line, bottom.line),
  bl: intersect(bottom.line, left.line),
};

/**
 * 🔴 --inset <px> — 확정된 네 꼭짓점을 무게중심 쪽으로 N px 당긴다.
 *
 * 왜 필요한가(2026-09-18 4차 gen-01 실측): 변 보정은 「종이 같은 화소」의 **바깥 경계**를
 * 찾는다. 펼침면 가장자리는 종이 두께·하이라이트·밝은 나무 카운터가 이어져 있어 경계가
 * 10~15px 바깥으로 잡히고, 그 결과 왼쪽 페이지의 스크림이 책 밖 카운터 위에 떠 보였다
 * (첫 렌더 out/check/paper-ink-full.png). 종이 안쪽으로 조금 당기는 편이 언제나 안전하다 —
 * 글씨는 어차피 여백 안에 놓이므로 몇 px 손해가 없다.
 */
const INSET = Number(arg("inset", 0));
const insetPoint = (p) => {
  if (!INSET) return p;
  const v = norm(sub(centroid, p));
  return [p[0] + v[0] * INSET, p[1] + v[1] * INSET];
};
const P = {
  tl: insetPoint(Praw.tl),
  tr: insetPoint(Praw.tr),
  br: insetPoint(Praw.br),
  bl: insetPoint(Praw.bl),
};
const round = (p) => [Math.round(p[0]), Math.round(p[1])];

/* ── 5. 책등에서 좌·우 두 쪽으로 가르기 ────────────────────── */
/**
 * 3차 구도에서 책등은 펼침면의 far 변과 near 변을 가로지른다(화면 근→원).
 * 그래서 gutterFrac 은 **좌→우 비율**이고, 펼침면은 좌·우 두 쪽으로 갈린다.
 *
 * 배정표 (페이지 로컬 ↔ 펼침면 화면 꼭짓점):
 *   왼쪽  tl=P.tl(farLeft)  tr=gutterFar   br=gutterNear     bl=P.bl(nearLeft)
 *   오른쪽 tl=gutterFar      tr=P.tr(farRight) br=P.br(nearRight) bl=gutterNear
 * local +x = 글줄 진행(쓰는 사람의 왼→오른), local +y = 줄 쌓임(먼 변→쓰는 사람 쪽).
 */
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/**
 * 🔴 책등은 물리적으로 한 직선이지만, **원근 때문에 far 변과 near 변을 같은 비율로
 *    자르지 않는다**(3차 gen-01 실측: far 0.425 · near 0.46). 한 값으로 묶으면 책등이
 *    비뚤어지고 한쪽 페이지의 글씨가 반대 쪽으로 넘어간다. 그래서 두 값을 따로 받는다.
 */
const GUTTER_FAR = Number(arg("gutter-far", GUTTER_FRAC));
const GUTTER_NEAR = Number(arg("gutter-near", GUTTER_FRAC));
const gutterFar = lerp(P.tl, P.tr, GUTTER_FAR);
const gutterNear = lerp(P.bl, P.br, GUTTER_NEAR);

/** 펜(= 지금 쓰는 중인 쪽)이 놓인 페이지. 3차 gen-01 은 오른쪽 */
const writerSide = String(arg("writer", "right"));

/**
 * 🔴 --page-local <rot0|rot180> — **화면 라벨 → 페이지 로컬 라벨** 배정.
 *
 * pages.* 의 tl/tr/br/bl 은 언제나 **화면 기준**이다. 글씨는 페이지 로컬(+x = 글줄 진행,
 * +y = 줄 쌓임)로 얹으므로 둘 사이의 배정을 이미지마다 다시 정해야 한다.
 *   · rot0   = 카메라가 쓰는 사람 **뒤**(3차 gen-01). 화면 라벨이 곧 페이지 로컬.
 *   · rot180 = 카메라가 **카운터 건너편**(4차 gen-01). 쓰는 사람의 왼→오른이 화면 오른→왼이고
 *              페이지 위쪽이 화면 아래라 라벨이 180° 돈다(거울상 아님 — shoelace 부호 보존).
 * 이 값을 인자로 받지 않으면 --write 가 이전 판정으로 조용히 되돌린다(2026-09-18 실제 위험).
 */
const pageLocalFromScreen = String(arg("page-local", "rot0"));

const pageLeft = { tl: round(P.tl), tr: round(gutterFar), br: round(gutterNear), bl: round(P.bl) };
const pageRight = { tl: round(gutterFar), tr: round(P.tr), br: round(P.br), bl: round(gutterNear) };

/** 거울상 방지 — 화면 좌표(y 아래)에서 tl→tr→br→bl 는 shoelace 합이 양수여야 한다 */
function shoelace(quad) {
  const q = [quad.tl, quad.tr, quad.br, quad.bl];
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}
for (const [name, quad] of [["left", pageLeft], ["right", pageRight]]) {
  const s = shoelace(quad);
  if (s <= 0) {
    console.error(`🔴 ${name} 페이지 배정이 거울상이다(shoelace ${s}). 글씨가 좌우 반전으로 렌더된다.`);
    process.exit(1);
  }
}
/** 펜이 놓인 쪽 = 마지막 줄이 써지는 쪽. 검수 오버레이에서 강조한다 */
const bookQuad = writerSide === "right" ? pageRight : pageLeft;
const q = [bookQuad.tl, bookQuad.tr, bookQuad.br, bookQuad.bl];

/* ── 6. 검수 오버레이 ──────────────────────────────────────── */
function drawLine(buf, a, b, rgb, thick = 3) {
  const n = Math.ceil(len(sub(b, a)));
  for (let i = 0; i <= n; i++) {
    const p = add(a, mul(sub(b, a), i / n));
    for (let oy = -thick; oy <= thick; oy++) {
      for (let ox = -thick; ox <= thick; ox++) {
        const x = Math.round(p[0]) + ox;
        const y = Math.round(p[1]) + oy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = (y * W + x) * 3;
        buf[o] = rgb[0];
        buf[o + 1] = rgb[1];
        buf[o + 2] = rgb[2];
      }
    }
  }
}
function drawArrow(buf, a, b, rgb) {
  drawLine(buf, a, b, rgb, 3);
  const d = norm(sub(a, b));
  const head = 26;
  const perp = [-d[1], d[0]];
  drawLine(buf, b, add(add(b, mul(d, head)), mul(perp, head * 0.45)), rgb, 3);
  drawLine(buf, b, add(add(b, mul(d, head)), mul(perp, -head * 0.45)), rgb, 3);
}

const ov = Buffer.from(raw);
const RED = [235, 60, 60];
const CYAN = [0, 210, 235];
const YELLOW = [250, 205, 40];
/** 펼친 지면 전체 = 빨강 */
drawLine(ov, P.tl, P.tr, RED, 2);
drawLine(ov, P.tr, P.br, RED, 2);
drawLine(ov, P.br, P.bl, RED, 2);
drawLine(ov, P.bl, P.tl, RED, 2);
/** 두 쪽 = 하늘색(왼쪽) · 초록(오른쪽, 펜이 놓인 쪽) */
const GREEN = [60, 220, 120];
for (const [quad, rgb] of [[pageLeft, CYAN], [pageRight, GREEN]]) {
  drawLine(ov, quad.tl, quad.tr, rgb, 3);
  drawLine(ov, quad.tr, quad.br, rgb, 3);
  drawLine(ov, quad.br, quad.bl, rgb, 3);
  drawLine(ov, quad.bl, quad.tl, rgb, 3);
  /** 로컬 축 화살표: 노랑 = 글줄 진행(local +x) 와 줄 쌓임(local +y) */
  const o0 = lerp(quad.tl, quad.bl, 0.18);
  drawArrow(ov, o0, lerp(add(o0, sub(quad.tr, quad.tl)), o0, 0.25), YELLOW);
  const o1 = lerp(quad.tl, quad.tr, 0.12);
  drawArrow(ov, o1, lerp(add(o1, sub(quad.bl, quad.tl)), o1, 0.2), YELLOW);
}

const overlayPath = path.join(ROOT, OVERLAY);
fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
const tmpRaw = path.join(path.dirname(overlayPath), ".measure-book.raw");
fs.writeFileSync(tmpRaw, ov);
/** 책 주변만 3배 확대해 남긴다 — 전체 프레임으로는 어긋남이 안 보인다 */
const xs = q.concat([P.tl, P.tr, P.br, P.bl]).map((p) => p[0]);
const ys = q.concat([P.tl, P.tr, P.br, P.bl]).map((p) => p[1]);
const pad = 60;
const cx = Math.max(0, Math.floor(Math.min(...xs) - pad));
const cy = Math.max(0, Math.floor(Math.min(...ys) - pad));
const cw = Math.min(W - cx, Math.ceil(Math.max(...xs) - cx + pad));
const ch = Math.min(H - cy, Math.ceil(Math.max(...ys) - cy + pad));
execFileSync("ffmpeg", [
  "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-i", tmpRaw,
  "-vf", `crop=${cw}:${ch}:${cx}:${cy},scale=${cw * 3}:${ch * 3}:flags=lanczos`,
  overlayPath,
]);
fs.unlinkSync(tmpRaw);

/* ── 7. 출력 / 기록 ───────────────────────────────────────── */
const report = {
  image: IMAGE,
  size: `${W}x${H}`,
  measuredAt: new Date().toISOString(),
  method: "화소 마스크(밝기·채도) + 네 변 최소제곱 보정 + 교차. tools/measure-book.mjs",
  threshold: { lumMin: Math.round(LUM_MIN), satMax: Number(SAT_MAX.toFixed(3)) },
  writerSide,
  gutterFrac: { far: GUTTER_FAR, near: GUTTER_NEAR },
  search: SEARCH,
  inset: INSET,
  pageLocalFromScreen,
  paperQuad: { tl: round(P.tl), tr: round(P.tr), br: round(P.br), bl: round(P.bl) },
  pages: { left: pageLeft, right: pageRight },
  bookQuad,
  localAxes:
    pageLocalFromScreen === "rot180"
      ? {
          "+x": "글줄 진행 = 쓰는 사람의 왼→오른 = **화면 오른→왼**",
          "+y": "줄 쌓임 = 페이지 위→아래 = **화면 아래→위**(쓰는 사람 쪽으로 쌓인다)",
          spine: "책등은 화면 세로로 펼침면 한가운데를 지난다 — 괘선은 그 직각인 화면 가로",
          mapping: "local tl=screen br · tr=screen bl · br=screen tl · bl=screen tr (라벨 180° 회전)",
        }
      : {
          "+x": "글줄 진행 = 화면 가로, 쓰는 사람의 왼→오른 (원근으로 왼쪽이 멀어 작아진다)",
          "+y": "줄 쌓임 = 펼침면 먼 변 → 쓰는 사람 쪽 near 변",
          spine: "책등은 화면 근→원 깊이 방향으로 펼침면 한가운데를 가로지른다",
          mapping: "local = screen (라벨 그대로)",
        },
};
console.log(JSON.stringify(report, null, 2));
console.log(
  `\n변 보정 표본(inlier/total): top ${top.count}/${top.total} · right ${right.count}/${right.total} · bottom ${bottom.count}/${bottom.total} · left ${left.count}/${left.total}`,
);
console.log(`검수 확대본: ${overlayPath}`);

if (WRITE) {
  const pj = path.join(ROOT, "public/gen/prompts.json");
  const j = JSON.parse(fs.readFileSync(pj, "utf8"));
  const sc = j.scenes.find((s) => s.scene === SCENE);
  if (!sc) throw new Error(`prompts.json 에 scene ${SCENE} 없음`);
  sc.geometry = {
    $comment:
      "방명록 지면 원근 매핑용. pages.left / pages.right 는 **화면 기준** 꼭짓점이다" +
      "(left = 화면 왼쪽 쪽, tl = 화면 좌상). 글씨를 얹는 **페이지 로컬** 좌표는 " +
      "`pageLocalFromScreen`(rot0 | rot180) 이 지시하는 라벨 변환으로 얻는다 — " +
      "src/geometry.ts 의 배정표가 그것을 구현한다. writerSide 는 **펜이 놓인 화면 쪽**이고 " +
      "bookQuad 는 그 쪽의 별칭이다. " +
      "🔴 이미지를 다시 생성하면 `node tools/measure-book.mjs --seed \"...\" --writer <l|r> " +
      "--page-local <rot0|rot180> --write` 로 재측정하고, 축 판정도 그 이미지의 책등·펜에서 " +
      "**다시** 도출한다(인자를 빼면 이전 판정으로 되돌아간다).",
    ...report,
  };
  fs.writeFileSync(pj, JSON.stringify(j, null, 2) + "\n");
  console.log(`prompts.json scenes[${SCENE}].geometry 기록 완료`);
}
