#!/usr/bin/env node
/**
 * Designer·Fill·Repeat·Manage 네 장면이 쓰는 **실캡처의 좌표**를 화소 스캔으로 잰다.
 *
 * 왜 스크립트인가: 캡처(B·C·D)는 재촬영으로 **같은 파일명에 덮어써진다**.
 * 좌표를 장면 코드에 박아 두면 재촬영 때마다 조용히 틀린 값이 된다
 * (2026-09-18 Paper 장면에서 육안 격자 측정이 120px 틀린 전례).
 * 그래서 측정값은 코드가 아니라 데이터 파일 `src/scene-geometry.json` 에 쓰고,
 * 장면은 `src/shots-scenes.ts` 를 통해 그 데이터를 읽는다.
 *
 * 재는 것
 *   A01 문서 캔버스 + 빨간 점선 입력항목 칸의 y 밴드(하이라이트가 훑고 갈 자리)
 *   A02 「URL로 문서 생성 허용」 체크박스(초록) 자리 + 우측 속성 패널 왼쪽 경계
 *   A04 저장 확인 팝업 사각형 + 그 안의 파란 「배포하기」 단추
 *   D02 검색 입력칸(파란 테두리) + 결과 행 구분선
 *   D03 완료 문서 미리보기의 지면 사각형
 *   B*·C* 세로 캡처의 지면 사각형(태블릿 화면에 맞춰 자를 때 기준)
 *   선택 소재 존재 여부(B/fill-seq · C/countdown-seq · C05-countdown.png · E 리포트)
 *   프레임별 평균 밝기(luma) — 제품이 스스로 어둡게 하는 상태(동의 전·모달 뒤)를 가려내려고
 *
 * 쓰는 법
 *   node tools/measure-scenes.mjs              # 측정 → src/scene-geometry.json 갱신
 *   node tools/measure-scenes.mjs --print      # 쓰지 않고 출력만
 *   node tools/measure-scenes.mjs --overlay    # out/check/measure-<key>.png 근거 이미지
 *
 * 🔴 좌표에는 식별자가 없다(회사 ID·템플릿 ID 아님). 캡처 파일 자체는 커밋하지 않는다.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "public/shots");
const OUT_JSON = path.join(ROOT, "src/scene-geometry.json");
const CHECK_DIR = path.join(ROOT, "out/check");

const args = process.argv.slice(2);
const printOnly = args.includes("--print");
const wantOverlay = args.includes("--overlay");

/* ---------- 화소 읽기 ---------- */

function decode(file) {
  const probe = JSON.parse(
    execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "json", file,
    ]).toString(),
  );
  const { width, height } = probe.streams[0];
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1 << 30 },
  );
  return { width, height, buf };
}

/**
 * 프레임 한 장의 **평균 밝기**(0–255). 64×64 로 면적 평균한 뒤 다시 평균한다.
 *
 * 왜 재나: 이폼사인 작성 화면은 ① 동의 전 비활성 상태 ② 모달(전송 팝업) 뒤
 * **제품이 스스로 지면을 어둡게** 한다. 이 상태의 캡처를 태블릿 화면에 얹으면
 * 같은 장면 안에서 Fill(밝음)과 Repeat/Branch(어두움)가 따로 놀아 「합성이 잘못된 것」
 * 처럼 보인다(2026-09-18 오케스트레이터 지적). 어느 프레임이 밝은지는 사람이
 * 눈으로 고를 일이 아니라 측정해서 데이터로 넘길 일이다.
 */
function meanLuma(file) {
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-vf", "format=gray,scale=64:64:flags=area", "-frames:v", "1", "-f", "rawvideo", "-"],
    { maxBuffer: 1 << 22 },
  );
  let sum = 0;
  for (const b of buf) sum += b;
  return Math.round((sum / buf.length) * 10) / 10;
}

class Pix {
  constructor(file) {
    const { width, height, buf } = decode(file);
    this.file = file;
    this.width = width;
    this.height = height;
    this.buf = buf;
  }
  at(x, y) {
    const i = (y * this.width + x) * 3;
    return [this.buf[i], this.buf[i + 1], this.buf[i + 2]];
  }
  /** roi 안에서 조건을 만족하는 화소의 경계상자 */
  bbox(pred, roi = null) {
    const r = roi ?? { x: 0, y: 0, w: this.width, h: this.height };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (!pred(this.at(x, y))) continue;
        n++;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    return n === 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, count: n };
  }
  /** roi 안 각 행에서 조건을 만족하는 화소 수 */
  rowProfile(pred, roi) {
    const out = [];
    for (let y = roi.y; y < roi.y + roi.h; y++) {
      let n = 0;
      for (let x = roi.x; x < roi.x + roi.w; x++) if (pred(this.at(x, y))) n++;
      out.push(n);
    }
    return out;
  }
}

/* ---------- 색 술어 ---------- */

const sat = (c) => Math.max(...c) - Math.min(...c);
const isWhite = (c) => c[0] > 247 && c[1] > 247 && c[2] > 247;
/** 딤 처리된 배경(팝업 뒤)과 팝업 안쪽 회색 상자를 함께 「밝음」으로 본다 */
const isBright = (c) => c[0] > 225 && c[1] > 225 && c[2] > 225;
const isRedInk = (c) => c[0] > 150 && c[0] - c[1] > 45 && c[0] - c[2] > 45;
/** 이폼사인 체크 표시의 청록(16,177,164) — 초록이 아니라 teal 이라 g-b 가 거의 없다 */
/**
 * 🔴 첫 시도에 파란 헤더(27,122,200)가 함께 걸렸다 — g-r 이 95 라 「초록기」 조건을 통과한다.
 *    teal 은 g 와 b 가 붙어 있다는 점(177 vs 164)으로만 파랑과 갈린다.
 */
const isTeal = (c) =>
  c[1] > 130 && c[1] - c[0] > 80 && c[2] > 90 && Math.abs(c[1] - c[2]) < 40;
const isBlue = (c) => c[2] > 130 && c[2] - c[0] > 45 && c[2] - c[1] > 20;
const isGrayLine = (c) => sat(c) <= 6 && c[0] < 240 && c[0] > 150;

/** 밴드(연속 구간) 찾기 — profile 값이 threshold 이상인 구간 */
function bands(profile, offset, threshold, minLen) {
  const out = [];
  let start = null;
  for (let i = 0; i < profile.length; i++) {
    const on = profile[i] >= threshold;
    if (on && start === null) start = i;
    if (!on && start !== null) {
      if (i - start >= minLen) out.push({ top: offset + start, height: i - start });
      start = null;
    }
  }
  if (start !== null && profile.length - start >= minLen) {
    out.push({ top: offset + start, height: profile.length - start });
  }
  return out;
}

/** 가로 방향으로 조건을 만족하는 **연속 구간** 중 가장 긴 것 */
function longestRun(pix, y, pred, x0 = 0, x1 = null) {
  const end = x1 ?? pix.width;
  let best = null, s = null;
  for (let x = x0; x <= end; x++) {
    const on = x < end && pred(pix.at(x, y));
    if (on && s === null) s = x;
    if (!on && s !== null) {
      if (!best || x - s > best.w) best = { x: s, w: x - s };
      s = null;
    }
  }
  return best;
}

/** 세로 방향 최장 연속 구간 */
function longestRunY(pix, x, pred, y0 = 0, y1 = null) {
  const end = y1 ?? pix.height;
  let best = null, s = null;
  for (let y = y0; y <= end; y++) {
    const on = y < end && pred(pix.at(x, y));
    if (on && s === null) s = y;
    if (!on && s !== null) {
      if (!best || y - s > best.h) best = { y: s, h: y - s };
      s = null;
    }
  }
  return best;
}

/**
 * 흰 지면(문서 페이지) 사각형.
 *
 * 🔴 「가장 긴 연속 흰 구간」으로 잡으면 **글줄에서 끊긴다**(첫 시도에서 지면 대신
 *    본문 사이 여백을 물었다). 열·행 **프로파일**(흰 화소 개수)로 잡아야 글자에 강하다.
 */
function whitePageRect(pix, roi, ratio = 0.5, pred = isWhite) {
  /* 🔴 가로 구분선 한 줄이 프로파일을 바닥까지 떨어뜨려 지면이 두 동강 난다
     (D03 에서 실제로 났다: 구분선 15줄에서 594→94). ±3 최댓값으로 메운다. */
  const smooth = (a) => a.map((_, i) => Math.max(...a.slice(Math.max(0, i - 3), i + 4)));

  const colCount = [];
  for (let x = roi.x; x < roi.x + roi.w; x++) {
    let n = 0;
    for (let y = roi.y; y < roi.y + roi.h; y += 2) if (pred(pix.at(x, y))) n++;
    colCount.push(n);
  }
  const colS = smooth(colCount);
  const colMax = Math.max(...colS);
  if (colMax === 0) return null;
  const cols = bands(colS, roi.x, colMax * ratio, 40);
  if (!cols.length) return null;
  const col = cols.reduce((a, b) => (b.height > a.height ? b : a));
  const x0 = col.top;
  const w = col.height;

  const rowCount = [];
  for (let y = roi.y; y < roi.y + roi.h; y++) {
    let n = 0;
    for (let x = x0; x < x0 + w; x += 2) if (pred(pix.at(x, y))) n++;
    rowCount.push(n);
  }
  const rowS = smooth(rowCount);
  const rowMax = Math.max(...rowS);
  const rows = bands(rowS, roi.y, rowMax * ratio, 30);
  if (!rows.length) return null;
  const row = rows.reduce((a, b) => (b.height > a.height ? b : a));
  return { x: x0, y: row.top, w, h: row.height };
}

/* ---------- 측정 ---------- */

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const shot = (p) => path.join(SHOTS, p);
const has = (p) => fs.existsSync(shot(p));

const overlays = [];
const noteOverlay = (key, file, rects) => {
  if (wantOverlay) overlays.push({ key, file, rects });
};

const result = {
  $comment:
    "실캡처 좌표 정본. 🔴 손으로 고치지 말고 `node tools/measure-scenes.mjs` 로 다시 잰다. 캡처는 같은 파일명으로 재촬영되므로 재촬영 뒤엔 반드시 재측정.",
  measuredAt: new Date().toISOString(),
  method: "ffmpeg rgb24 원시 화소 스캔(색 술어 + 행 프로파일 + 최장 연속 구간)",
  captures: {},
  optional: {},
};

function measureA01() {
  const file = shot("A/A01-designer-form.png");
  if (!fs.existsSync(file)) return null;
  const p = new Pix(file);
  /*
   * 🔴 이 화면은 지면도 흰색, 편집기 배경도 흰색이라 「흰 사각형」으로는 지면을 못 찾는다.
   *    대신 **빨간 점선 입력항목 칸**(239,67,68)만 이 화면에서 유일하게 붉다 — 그것으로 잡는다.
   */
  /* 우측 「추가된 입력 항목」 패널과 우하단 상담 아이콘(사람 얼굴)은 빼고 본다 —
     아이콘의 살색·붉은 요소가 경계상자를 오른쪽 끝까지 늘린다(첫 시도에서 실제로 났다). */
  const editor = {
    x: Math.round(p.width * 0.13),
    y: Math.round(p.height * 0.08),
    w: Math.round(p.width * 0.55),
    h: Math.round(p.height * 0.86),
  };
  const ink = p.bbox(isRedInk, editor);
  if (!ink) return { width: p.width, height: p.height, fields: [] };
  const scanRoi = { x: ink.x - 20, y: ink.y - 20, w: ink.w + 40, h: ink.h + 40 };
  const raw = p.rowProfile(isRedInk, scanRoi);
  /* 점선이라 행마다 끊긴다 → ±4행 최댓값으로 메워야 칸 하나가 한 덩어리로 잡힌다 */
  const prof = raw.map((_, i) => Math.max(...raw.slice(Math.max(0, i - 4), i + 5)));
  const maxN = Math.max(...prof);
  const fields = bands(prof, scanRoi.y, 2, 12)
    .map((b) => {
      const box = p.bbox(isRedInk, { x: scanRoi.x, y: b.top, w: scanRoi.w, h: b.height });
      return box ? { x: box.x, y: box.y, w: box.w, h: box.h } : null;
    })
    .filter(Boolean)
    .filter((r) => r.w > 60 && r.h > 18);
  noteOverlay("A01", file, [ink, ...fields]);
  return { width: p.width, height: p.height, fieldsArea: ink && { x: ink.x, y: ink.y, w: ink.w, h: ink.h }, fields };
}

function measureA02() {
  const file = shot("A/A02-url-create-on.png");
  if (!fs.existsSync(file)) return null;
  const p = new Pix(file);
  // 우측 속성 패널만 본다(좌측 워크플로우 캔버스에는 파란 요소가 있다)
  const roi = {
    x: Math.round(p.width * 0.56),
    y: Math.round(p.height * 0.12),
    w: Math.round(p.width * 0.44),
    h: Math.round(p.height * 0.72),
  };
  const toggle = p.bbox(isTeal, roi);
  // 패널 왼쪽 경계 = 세로 구분선
  let panelX = null;
  const probeY = Math.round(p.height * 0.62);
  for (let x = Math.round(p.width * 0.5); x < p.width; x++) {
    const c = p.at(x, probeY);
    if (sat(c) <= 6 && c[0] < 240) { panelX = x; break; }
  }
  noteOverlay("A02", file, [toggle].filter(Boolean));
  return { width: p.width, height: p.height, urlToggle: toggle, panelX };
}

function measureA04() {
  const file = shot("A/A04-template-saved.png");
  if (!fs.existsSync(file)) return null;
  const p = new Pix(file);
  // 어두워진 배경 위의 흰 팝업
  const roi = { x: 0, y: Math.round(p.height * 0.2), w: p.width, h: Math.round(p.height * 0.6) };
  /* 팝업 안에 회색 안내 상자가 있어 ratio 0.5 면 세로가 그 상자에서 끊긴다 */
  const dialog = whitePageRect(p, roi, 0.5, isBright);
  const btn = dialog ? p.bbox(isBlue, dialog) : null;
  noteOverlay("A04", file, [dialog, btn].filter(Boolean));
  return { width: p.width, height: p.height, dialog, deployButton: btn };
}

function measureD02() {
  const file = shot("D/D02-search.png");
  if (!fs.existsSync(file)) return null;
  const p = new Pix(file);
  // 파란 헤더 아래 첫 줄의 검색 입력칸(파란 테두리)
  const headerH = Math.round(p.height * 0.075);
  const roi = { x: Math.round(p.width * 0.15), y: headerH + 10, w: Math.round(p.width * 0.35), h: Math.round(p.height * 0.1) };
  const search = p.bbox(isBlue, roi);
  // 결과 행 구분선(회색 가로선)
  const scanX = Math.round(p.width * 0.3);
  const seps = [];
  for (let y = headerH; y < Math.round(p.height * 0.6); y++) {
    if (isGrayLine(p.at(scanX, y)) && !isGrayLine(p.at(scanX, y - 1))) seps.push(y);
  }
  const viewport = measureViewport(p, { luma: meanLuma(file) });
  noteOverlay("D02", file, [search, viewport].filter(Boolean));
  return { width: p.width, height: p.height, search, separators: seps, viewport };
}

function measureD03() {
  const file = shot("D/D03-pdf-preview.png");
  if (!fs.existsSync(file)) return null;
  const p = new Pix(file);
  const roi = { x: 0, y: Math.round(p.height * 0.13), w: p.width, h: Math.round(p.height * 0.85) };
  const page = whitePageRect(p, roi, 0.28);
  const luma = meanLuma(file);
  const viewport = measureViewport(p, { luma, page });
  noteOverlay("D03", file, [page, viewport].filter(Boolean));
  return { width: p.width, height: p.height, page, viewport, luma };
}

/**
 * 리포트 화면에서 **값이 든 행이 끝나는 높이**.
 *
 * 🔴 왜 재나(2026-09-21): 리포트 표 아래쪽에는 서식 제목 규칙을 넣기 **전**에 만든 옛 문서가
 *    섞여 있어 항목 칸(방문일시·성명·소속…)이 비어 있다. 영상은 표를 위에서부터 잘라 쓰는데
 *    그 빈 행까지 프레임에 들어오면 「리포트가 비어 있다」로 읽힌다. 옛 문서를 지울 수도,
 *    기간으로 거를 수도 없다(옛 3건·새 3건이 같은 날짜다) → **자를 높이를 재서** 넘긴다.
 *    측정법: 오른쪽 항목 열 구간(0.45W~0.93W)에서 글자(어두운 화소)가 있는 마지막 행.
 *    왼쪽 열은 옛 문서도 완료일·문서 이름이 차 있어 구분에 쓸 수 없다.
 */
function measureReportContent(relPath) {
  const file = shot(relPath);
  if (!fs.existsSync(file)) return null;
  const p = new Pix(file);
  const isInk = (c) => c[0] < 170 && c[1] < 170 && c[2] < 170;
  const roi = { x: Math.round(p.width * 0.45), y: 0, w: Math.round(p.width * 0.48), h: p.height };
  const prof = p.rowProfile(isInk, roi);
  let last = -1;
  for (let i = prof.length - 1; i >= 0; i--) {
    if (prof[i] >= 3) { last = i; break; }
  }
  if (last < 0) return null;
  /* 마지막 글자 아래로 행 구분선·여백 몫을 조금 남긴다(행이 반쯤 잘려 보이지 않게) */
  return { contentBottom: Math.min(p.height, roi.y + last + Math.round(p.height * 0.02)) };
}

/**
 * 채워진 서식 **카드용 프레임**(Branch 장면 왼쪽 카드).
 *
 * 🔴 왜(2026-09-21): 카드에 디자이너 화면(A01)을 쓰면 입력값이 전부 「[텍스트]」
 *    플레이스홀더로 나온다 — 서식을 만드는 화면이니 당연하지만, 「이 서식이 세 자리에서
 *    쓰인다」는 장면에서는 값이 든 화면이 설득력 있다. 목업을 그리는 대신 **실제로 채워진
 *    외부 작성 캡처**(fill-seq 의 밝은 마지막 프레임)를 쓴다. 어느 프레임이 밝은지는
 *    luma 로 가린다(전송 팝업 뒤 프레임은 165 로 어둡다).
 */
function measureFillCard(seq) {
  if (!seq.frames.length || !seq.luma) return null;
  let idx = -1;
  for (let i = seq.frames.length - 1; i >= 0; i--) {
    if (seq.luma[i] >= 200) { idx = i; break; }
  }
  if (idx < 0) return null;
  const relPath = seq.frames[idx];
  const p = new Pix(shot(relPath));
  const page = borderPageRect(p);
  if (!page) return null;
  noteOverlay("fillCard", shot(relPath), [page]);
  return { frame: relPath, width: p.width, height: p.height, page, luma: seq.luma[idx] };
}

/**
 * 지면 사각형을 **테두리선**으로 찾는다.
 *
 * 🔴 외부 작성 화면은 뷰어 배경도 순백(255)이라 whitePageRect 로는 지면이 안 잡힌다
 *    (2026-09-21 실측: 지면 밖 화소도 255,255,255). 지면 경계는 연회색 테두리선 한 줄뿐이다
 *    — 글줄이 없는 행에서 좌우 끝의 비흰 화소를 찾아 그 선을 잡는다.
 */
function borderPageRect(p) {
  const isEdge = (c) => c[0] < 246 || c[1] < 246 || c[2] < 246;
  const x0 = Math.round(p.width * 0.03);
  const x1 = Math.round(p.width * 0.99);
  const lefts = [];
  const rights = [];
  for (let i = 3; i <= 7; i++) {
    const y = Math.round((p.height * i) / 20);
    let l = null, r = null;
    for (let x = x0; x < x1; x++) if (isEdge(p.at(x, y))) { l = x; break; }
    for (let x = x1 - 1; x >= x0; x--) if (isEdge(p.at(x, y))) { r = x; break; }
    if (l != null) lefts.push(l);
    if (r != null) rights.push(r);
  }
  if (!lefts.length || !rights.length) return null;
  const mode = (a) => a.slice().sort((m, n) => m - n)[Math.floor(a.length / 2)];
  const left = Math.min(...lefts);
  const right = Math.max(...rights);
  if (right - left < p.width * 0.3) return null;
  const run = longestRunY(p, left, isEdge, 0, p.height);
  if (!run) return null;
  void mode;
  return { x: left, y: run.y, w: right - left + 1, h: run.h };
}

/**
 * 생성 이미지 배경의 **색보정 세기**.
 *
 * 🔴 왜(2026-09-21): Manage 구간(35~46초)은 v1 에서 초당 평균 밝기 117~146 으로 영상에서
 *    가장 어두웠다(직전 Repeat 은 ≈215). 보정 세기를 눈대중으로 코드에 박지 않고,
 *    **측정한 밝기에서 목표까지 필요한 배율**을 계산해 데이터로 넘긴다. 보정은 배경에만 걸고
 *    캡처 층은 제외한다(문서함 캡처 색이 바뀌면 안 된다 — Fill→Repeat 연속성).
 */
const GRADE_TARGET = 235;
function measureGrade(name) {
  const file = path.join(ROOT, "public/gen", name);
  if (!fs.existsSync(file)) return null;
  const luma = meanLuma(file);
  const brightness = Math.min(1.9, Math.max(1, Math.round((GRADE_TARGET / luma) * 100) / 100));
  return { image: name, luma, target: GRADE_TARGET, brightness, saturate: 1.04 };
}


/**
 * **화면에 보일 영역**(viewport) — 캡처에서 실제로 내용이 있는 곳.
 *
 * 🔴 왜(2026-09-21, v3 레인 D): 태블릿 화면 사각형의 비(0.58)는 캡처(1920x2700 = 0.711)보다
 *    좁고 길다. 그래서 캡처 **전체**를 비율에 맞춰 자르면 세로를 하나도 버리지 못하고 가로만
 *    잘려, 서식 아래 **백지 650px + 하단바**가 그대로 화면에 들어온다 — 서식은 위쪽 1/3 에
 *    작게 몰리고 아래 절반이 흰 공백인 「눌린 화면」이 된다(사용자 지적).
 *    고치는 방법은 배율을 손으로 올리는 것이 아니라 **버릴 곳을 재는 것**이다:
 *    내용이 끝나는 곳(contentBottom)과 지면이 차지하는 가로 구간(left~right)을 재서
 *    그 사각형만 화면에 채운다(`fitCrop`, src/shots-scenes.ts).
 *
 *    y 는 **항상 0 에서 시작**한다 — 맨 위 도구막대는 「이폼사인 화면이다」를 말해 주는
 *    유일한 표지라 버리지 않는다. 가로 구간은 도구막대(전폭)가 끼면 항상 전폭이 되므로
 *    위 8% 를 빼고 잰다.
 *
 * 🔴 어두운 캡처(모달 뒤·동의 전)는 지면 전체가 회색이라 「잉크 경계」로 아무것도 못 가린다.
 *    그때는 제품이 띄운 팝업(= whitePageRect 가 잡은 흰 사각형)이 보여야 할 것이므로
 *    그 사각형을 기준으로 삼는다(B04 전송 팝업).
 */
function measureViewport(p, { luma = 255, page = null } = {}) {
  const clampRect = (r) => {
    const x = Math.max(0, Math.round(r.x));
    const y = Math.max(0, Math.round(r.y));
    return {
      x,
      y,
      w: Math.min(p.width - x, Math.round(r.w)),
      h: Math.min(p.height - y, Math.round(r.h)),
    };
  };

  if (luma < 200 && page && page.w * page.h < p.width * p.height * 0.4) {
    const pad = Math.round(page.w * 0.35);
    return {
      ...clampRect({ x: page.x - pad, y: page.y - pad, w: page.w + pad * 2, h: page.h + pad * 2 }),
      basis: "dialog",
    };
  }

  const isInk = (c) => Math.max(c[0], c[1], c[2]) < 246;
  /* 🔴 문턱을 폭의 0.2% (=4px) 로 두면 **지면 테두리선 두 줄**이 백지 행을 잉크 행으로 만든다
     (C01b 에서 실제로 났다: 백지 650px 구간이 안 잡혀 viewport 가 캡처 전체가 됐다).
     0.8% (=15px) 로 올리면 테두리는 빠지고 글줄은 남는다. */
  const minRowInk = Math.max(8, Math.round(p.width * 0.008));
  const rows = p.rowProfile(isInk, { x: 0, y: 0, w: p.width, h: p.height });

  let last = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i] >= minRowInk) { last = i; break; }
  }
  if (last < 0) return { x: 0, y: 0, w: p.width, h: p.height, basis: "full" };

  /* 내용의 끝 = 기본은 **마지막 잉크 행**. 단 그 잉크가 화면 맨 아래 고정 막대(단추·안내)이면
     그 앞의 백지 구간에서 끊는다.
     🔴 「아래쪽 첫 큰 백지에서 끊는다」로 하면 안 된다 — 감사 화면(C04)은 도구막대와 가운데
        메시지 사이가 통째로 백지라 메시지가 잘려 나간다(실측에서 h=713 로 잘렸다).
        판정 기준은 「마지막 백지 구간 뒤의 잉크가 프레임 맨 아래 12% 안에만 있는가」다. */
  const gapMin = Math.round(p.height * 0.05);
  const bottomBand = Math.round(p.height * 0.88);
  let contentBottom = last + 1;
  {
    const runs = [];
    let run = null;
    for (let y = 0; y <= last; y++) {
      const blank = rows[y] < minRowInk;
      if (blank && run === null) run = y;
      if (!blank && run !== null) {
        if (y - run >= gapMin) runs.push({ from: run, to: y });
        run = null;
      }
    }
    const lastRun = runs.length ? runs[runs.length - 1] : null;
    if (lastRun && lastRun.to >= bottomBand) contentBottom = lastRun.from;
  }

  /* 🔴 가로 구간은 도구막대(전폭)를 빼고 잰다. 그리고 **양 끝 1.2% 를 무시**한다 —
     브라우저 창 왼쪽 테두리선 한 줄(x=0~2, 전 높이)이 left=0 을 만들어 지면 구간을
     통째로 전폭으로 벌렸다(C02 에서 실측: 지면 잉크는 x 464~1463 인데 left 가 0 이 됐다). */
  const topBand = Math.round(p.height * 0.08);
  const y0 = Math.min(topBand, Math.max(0, contentBottom - 10));
  const edge = Math.round(p.width * 0.012);
  const minColInk = Math.max(4, Math.round(((contentBottom - y0) / 2) * 0.02));
  let left = null;
  let right = null;
  for (let x = edge; x < p.width - edge; x++) {
    let n = 0;
    for (let y = y0; y < contentBottom; y += 2) if (isInk(p.at(x, y))) n++;
    if (n >= minColInk) {
      if (left === null) left = x;
      right = x;
    }
  }
  if (left === null) { left = 0; right = p.width - 1; }

  /* 🔴 지면 테두리선이 잡히면 그쪽이 더 정확하다. 잉크 열 프로파일은 지면 **밖**의 희미한
     레일·아이콘(C02 에서 x 191~238)까지 물어 지면 구간을 왼쪽으로 벌린다 —
     그만큼 확대 배율이 깎인다(실측 1190px 지면이 1400px 구간으로 벌어졌다). */
  const border = borderPageRect(p);
  if (border && border.w >= p.width * 0.3 && border.w < right - left + 1) {
    left = border.x;
    right = border.x + border.w - 1;
  }

  /* 🔴 가로 캡처(문서함·완료문서)는 왼쪽 끝을 버리지 않는다. 그 화면들은 왼쪽에
     문서 제목·상태·제목 열이 있고 오른쪽이 부가 패널이다 — 지면만 남기면 파란 머리띠의
     「방문자 기록 - 김영희」가 잘려 어느 문서를 보고 있는지 사라진다(D03 에서 실제로 났다). */
  if (p.width > p.height) left = 0;

  const pad = Math.round(p.width * 0.01);
  return {
    ...clampRect({
      x: left - pad,
      y: 0,
      w: right - left + 1 + pad * 2,
      h: contentBottom + pad,
    }),
    basis: "ink",
  };
}

/** 여러 프레임의 viewport 를 합친다(시퀀스는 프레임마다 내용 범위가 다르다) */
function unionRect(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
    basis: a.basis === b.basis ? a.basis : "mixed",
  };
}

/**
 * 시퀀스의 viewport — **밝은 프레임 여섯 장을 고루 뽑아 합집합**으로 잡는다.
 * 한 장만 재면 그 프레임에 아직 안 쓰인 칸이 화면 밖으로 밀린다(fill-seq 는 채워지는 과정,
 * thanks-seq 는 감사 화면과 새 서식이 섞여 있어 배치 자체가 다르다).
 */
function measureSeqViewport(seq, sample = 6) {
  if (!seq.frames.length) return null;
  const idx = seq.luma
    ? seq.frames.map((_, i) => i).filter((i) => seq.luma[i] >= 200)
    : seq.frames.map((_, i) => i);
  const use = idx.length ? idx : seq.frames.map((_, i) => i);
  const picked = Array.from({ length: Math.min(sample, use.length) }, (_, k) =>
    use[Math.round((k * (use.length - 1)) / Math.max(1, Math.min(sample, use.length) - 1))],
  );
  let vp = null;
  for (const i of [...new Set(picked)]) {
    const p = new Pix(shot(seq.frames[i]));
    vp = unionRect(vp, measureViewport(p, { luma: seq.luma ? seq.luma[i] : 255 }));
  }
  return vp;
}

/**
 * 가로 캡처(문서함 목록 D01)의 크기·밝기·viewport.
 *
 * 🔴 왜 새로 재나: D01 은 지금까지 측정 대상이 아니어서 Manage 가 크기를 **코드에 박은 기본값**
 *    (2400x1350)으로 쓰고 있었다. viewport 가 필요해진 이상 크기도 측정값이어야 한다
 *    (캡처는 같은 파일명으로 재촬영된다).
 */
function measureListLandscape(relPath, key) {
  const file = shot(relPath);
  if (!fs.existsSync(file)) return null;
  const p = new Pix(file);
  const luma = meanLuma(file);
  const viewport = measureViewport(p, { luma });
  noteOverlay(key, file, [viewport]);
  return { width: p.width, height: p.height, viewport, luma };
}

/** 세로 캡처(외부 작성 화면·방명록 페이지)의 지면 사각형 */
function measurePortrait(relPath, key) {
  const file = shot(relPath);
  if (!fs.existsSync(file)) return null;
  const p = new Pix(file);
  const roi = { x: 0, y: Math.round(p.height * 0.06), w: p.width, h: Math.round(p.height * 0.8) };
  const page = whitePageRect(p, roi, 0.28);
  const luma = meanLuma(file);
  const viewport = measureViewport(p, { luma, page });
  noteOverlay(key, file, [page, viewport].filter(Boolean));
  return { width: p.width, height: p.height, page, viewport, luma };
}

/* ---------- 실행 ---------- */

const jobs = {
  A01: measureA01,
  D01: () => measureListLandscape("D/D01-document-list.png", "D01"),
  A02: measureA02,
  A04: measureA04,
  D02: measureD02,
  D03: measureD03,
  /* 2026-09-28 레인 M3: Manage 장면 뒤쪽 두 컷 — 커넥트로 자동 채워진 구글 시트(K02),
     이폼사인 문서로 만든 OZR 참석자 명단 보고서 미리보기(D04). 둘 다 가로 캡처 2400x1350. */
  K02: () => measureListLandscape("K/K02-sheet-rows.png", "K02"),
  D04: () => measureListLandscape("D/D04-ozr-report-preview.png", "D04"),
  B02: () => measurePortrait("B/B02-empty-form.png", "B02"),
  B03: () => measurePortrait("B/B03-filled-form.png", "B03"),
  B04: () => measurePortrait("B/B04-send-dialog.png", "B04"),
  B05: () => measurePortrait("B/B05-complete.png", "B05"),
  C01: () => measurePortrait("C/C01-kiosk-blank.png", "C01"),
  /* C01b = 「입력 시작」(동의) 직후의 **밝은** 빈 서식. C01 은 동의 전이라 이폼사인이
     지면을 비활성 처리해 어둡다(실측 luma 136.6 vs 245.9). Repeat·Branch 는 C01b 를 쓴다. */
  C01b: () => measurePortrait("C/C01b-kiosk-blank-active.png", "C01b"),
  C02: () => measurePortrait("C/C02-kiosk-filled.png", "C02"),
  C04: () => measurePortrait("C/C04-thanks.png", "C04"),
};

for (const [key, fn] of Object.entries(jobs)) {
  try {
    const r = fn();
    if (r) result.captures[key] = r;
    else console.warn(`· ${key}: 캡처 없음 — 건너뜀`);
  } catch (e) {
    console.warn(`· ${key}: 측정 실패 — ${e.message}`);
  }
}

/* 선택 소재 — 있으면 쓰고 없으면 그 연출을 뺀다(존재 분기) */
const seqFrames = (dir) => {
  const d = shot(dir);
  if (!fs.existsSync(d)) return { frames: [], width: 0, height: 0, luma: [] };
  const frames = fs
    .readdirSync(d)
    .filter((f) => /\.png$/i.test(f))
    .sort()
    .map((f) => `${dir}/${f}`);
  if (!frames.length) return { frames, width: 0, height: 0, luma: [] };
  /* 🔴 시퀀스 프레임의 크기는 같은 폴더의 정지 캡처와 다를 수 있다
     (2026-09-18 실측: B/fill-seq 는 1920x2700, B03~B05 는 1920x2550).
     크기를 넘겨받지 못하면 합성이 눌린다 — 첫 프레임에서 직접 읽는다. */
  const probe = JSON.parse(
    execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "json", shot(frames[0]),
    ]).toString(),
  );
  return {
    frames,
    width: probe.streams[0].width,
    height: probe.streams[0].height,
    luma: frames.map((rel) => meanLuma(shot(rel))),
  };
};

const single = (rel) => {
  if (!has(rel)) return { frames: [], width: 0, height: 0, luma: [] };
  const probe = JSON.parse(
    execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "json", shot(rel),
    ]).toString(),
  );
  return { frames: [rel], width: probe.streams[0].width, height: probe.streams[0].height, luma: [meanLuma(shot(rel))] };
};

const countdownSeq = seqFrames("C/countdown-seq");
const fillSeqMeasured = seqFrames("B/fill-seq");
const thanksMeasured = seqFrames("C/thanks-seq");
const countdownUsed = countdownSeq.frames.length ? countdownSeq : single("C/C05-countdown.png");
const withViewport = (seq) => (seq.frames.length ? { ...seq, viewport: measureSeqViewport(seq) } : seq);
result.optional = {
  thanksSeq: withViewport(thanksMeasured),
  fillSeq: { ...withViewport(fillSeqMeasured), card: measureFillCard(fillSeqMeasured) },
  countdown: withViewport(countdownUsed),
  /* 🔴 리포트(E 계열)는 재지 않는다 — 2026-09-21 사용자 지시로 영상에서 뺐다.
     방명록 상품에 따로 구현한 화면이라 이폼사인 홍보 영상에 넣지 않는다.
     되살릴 일이 생기면 measureReportContent() 가 그대로 남아 있다. */
};

/* 생성 이미지 배경의 색보정 세기(장면이 쓴다) */
result.grade = { "gen-06": measureGrade("gen-06.png") };

/* ---------- 출력 ---------- */

const json = JSON.stringify(result, null, 2) + "\n";
if (printOnly) {
  console.log(json);
} else {
  fs.writeFileSync(OUT_JSON, json);
  console.log(`기록: ${rel(OUT_JSON)}`);
}

for (const [k, v] of Object.entries(result.captures)) {
  const parts = Object.entries(v)
    .filter(([kk]) => kk !== "width" && kk !== "height")
    .map(([kk, vv]) =>
      Array.isArray(vv)
        ? `${kk}=${vv.length}개`
        : vv && typeof vv === "object"
          ? `${kk}=(${vv.x},${vv.y} ${vv.w}x${vv.h})`
          : `${kk}=${vv}`,
    );
  console.log(`  ${k} ${v.width}x${v.height} · ${parts.join(" · ")}`);
}
console.log(
  `  선택 소재: thanks-seq ${result.optional.thanksSeq.frames.length}장(${result.optional.thanksSeq.height}px) · fill-seq ${result.optional.fillSeq.frames.length}장(${result.optional.fillSeq.height}px) · countdown ${result.optional.countdown.frames.length}장`,
);

/* 어떤 프레임이 밝은지(=제품이 지면을 어둡게 하지 않은 상태인지) 한눈에 */
const BRIGHT = 200;
for (const [k, v] of Object.entries(result.optional)) {
  if (!v.luma || !v.luma.length) continue;
  const bright = v.luma.filter((l) => l >= BRIGHT).length;
  console.log(
    `  밝기 ${k}: ${bright}/${v.luma.length}장 밝음(≥${BRIGHT}) · 최소 ${Math.min(...v.luma)} 최대 ${Math.max(...v.luma)}`,
  );
}

if (wantOverlay && overlays.length) {
  fs.mkdirSync(CHECK_DIR, { recursive: true });
  for (const o of overlays) {
    const draw = o.rects
      .map(
        (r) =>
          `drawbox=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:color=magenta@0.9:t=4`,
      )
      .join(",");
    if (!draw) continue;
    const out = path.join(CHECK_DIR, `measure-${o.key}.png`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", o.file, "-vf", draw, out]);
    console.log(`  근거: ${rel(out)}`);
  }
}
