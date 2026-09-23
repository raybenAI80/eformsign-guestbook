#!/usr/bin/env node
/**
 * 회귀 게이트 — 4점 원근 매핑(cornersToMatrix3d)이 실제로 그 네 꼭짓점으로 보내는가.
 *
 *   node tools/check-homography.mjs
 *
 * 왜 있나: 2026-09-18, `src/components/ScreenComposite.tsx` 의 matrix3d 열 순서가
 * 틀려 있었다(Y 행 계수를 d,e,f 대신 e,f,d 로 넣었다). tl 한 점만 우연히 맞고
 * 나머지 세 점은 수십만 px 로 발산해, 종이 지면에 얹은 덧글씨가 화면 전체를 덮었다.
 * 타입 검사도 렌더 성공도 이것을 잡지 못한다 — 픽셀을 봐야만 보였다.
 * 그래서 "네 꼭짓점이 제자리로 가는가"를 숫자로 확인하는 게이트를 둔다.
 *
 * 방식: TSX 원문에서 함수를 떼어내 타입 표기만 지우고 실행한 뒤,
 * CSS matrix3d 의 해석식(열 우선 + 원근 나눗셈)으로 네 꼭짓점을 되돌려 본다.
 * 구현을 베끼지 않고 **배포되는 그 코드**를 그대로 돌린다.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), "..");
const SRC = path.join(ROOT, "src", "components", "ScreenComposite.tsx");

const source = fs.readFileSync(SRC, "utf8");
const begin = source.indexOf("export function cornersToMatrix3d");
if (begin < 0) {
  console.error("❌ cornersToMatrix3d 를 찾지 못했다:", SRC);
  process.exit(1);
}
const end = source.indexOf("\n}", begin);
if (end < 0) {
  console.error("❌ 함수 끝을 찾지 못했다");
  process.exit(1);
}
const fnSrc = source
  .slice(begin, end + 2)
  .replace(/^export function/, "function")
  // 타입 표기만 제거한다(본문 로직은 건드리지 않는다)
  .replace(/: Corners, w: number, h: number\): string/, ", w, h)")
  .replace(/: Corner\[\]/g, "")
  .replace(/: number\[\]\[\]/g, "")
  .replace(/: number\[\]/g, "");

if (/:\s*(number|string|Corner)/.test(fnSrc)) {
  console.error("❌ 타입 표기가 남았다 — 게이트를 갱신해야 한다");
  process.exit(1);
}

const cornersToMatrix3d = new Function(`${fnSrc}; return cornersToMatrix3d;`)();

/** CSS matrix3d(열 우선) 해석식으로 (x,y) 를 화면 좌표로 보낸다 */
function project(matrixStr, x, y) {
  const m = matrixStr
    .replace(/^matrix3d\(/, "")
    .replace(/\)$/, "")
    .split(",")
    .map((v) => Number(v.trim()));
  if (m.length !== 16 || m.some((v) => !Number.isFinite(v))) {
    throw new Error(`matrix3d 파싱 실패: ${matrixStr}`);
  }
  const X = m[0] * x + m[4] * y + m[12];
  const Y = m[1] * x + m[5] * y + m[13];
  const W = m[3] * x + m[7] * y + m[15];
  return [X / W, Y / W];
}

/**
 * 실제로 쓰는 사각형 + 일반적인 원근 사각형 몇 개.
 * 🔴 방명록 지면은 prompts.json 에서 읽는다 — 코드에 박아 두면 이미지를 다시 만들었을 때
 *    게이트가 **이미 버려진 좌표**를 통과시켜 버린다(2026-09-18 gen-01.png 교체 사고).
 */
const pages = JSON.parse(
  fs.readFileSync(new URL("../public/gen/prompts.json", import.meta.url), "utf8"),
).scenes.find((s) => s.scene === 1)?.geometry?.pages;
if (!pages?.left || !pages?.right) {
  console.error("🔴 prompts.json scenes[1].geometry.pages 없음 — node tools/measure-book.mjs --write 먼저");
  process.exit(1);
}

/**
 * 🔴 **화면 라벨 → 페이지 로컬 라벨** 배정을 여기서 재현한다(src/geometry.ts 와 같은 규칙).
 *    prompts.json 의 pages.* 는 화면 기준이고, 글씨는 페이지 로컬로 얹힌다.
 */
const geo = JSON.parse(
  fs.readFileSync(new URL("../public/gen/prompts.json", import.meta.url), "utf8"),
).scenes.find((s) => s.scene === 1)?.geometry;
const rot180 = (q) => ({ tl: q.br, tr: q.bl, br: q.tl, bl: q.tr });
const toLocal = (q) => (geo?.pageLocalFromScreen === "rot180" ? rot180(q) : q);
const localPages = { left: toLocal(pages.left), right: toLocal(pages.right) };

/**
 * 🔴 거울상 검사 — 화면 좌표(y 아래)에서 페이지 로컬 tl→tr→br→bl 의 shoelace 합은
 *    양수여야 한다. 음수면 글씨가 좌우 반전으로 렌더된다(tsc 도 렌더 성공도 못 잡는다).
 *    180° 회전은 부호를 보존하므로 이 검사를 통과한다 — 통과가 곧 "뒤집힘이 아니라 회전"의 증거다.
 */
function shoelace(q) {
  const p = [q.tl, q.tr, q.br, q.bl];
  let s = 0;
  for (let i = 0; i < 4; i++) s += p[i][0] * p[(i + 1) % 4][1] - p[(i + 1) % 4][0] * p[i][1];
  return s;
}
let mirrored = 0;
for (const [k, q] of Object.entries(localPages)) {
  const s = shoelace(q);
  if (s <= 0) {
    console.error(`❌ 거울상: gen-01 ${k} 페이지(로컬) shoelace ${s} ≤ 0`);
    mirrored++;
  } else {
    console.log(`✅ 거울상 아님: gen-01 ${k} 페이지(로컬) shoelace ${s}`);
  }
}

/**
 * 🔴 축 방향 검사 — 배정이 그 이미지의 구도와 맞는가.
 *    4차 gen-01(rot180, 카메라가 카운터 건너편)에서는
 *      로컬 +x(글줄 진행 tl→tr) 가 **화면 왼쪽**(dx < 0),
 *      로컬 +y(줄 쌓임 tl→bl) 가 **화면 위쪽**(dy < 0) 이어야 한다.
 *    rot0(카메라가 쓰는 사람 뒤)이면 둘 다 부호가 반대다.
 *    이 검사가 없으면 배정만 바꾸고 이미지는 옛것인 조합이 조용히 통과한다.
 */
const wantSign = geo?.pageLocalFromScreen === "rot180" ? -1 : 1;
let axisBad = 0;
for (const [k, q] of Object.entries(localPages)) {
  const dx = q.tr[0] - q.tl[0];
  const dy = q.bl[1] - q.tl[1];
  const ok = Math.sign(dx) === wantSign && Math.sign(dy) === wantSign;
  if (ok) {
    console.log(`✅ 축 방향: gen-01 ${k} +x dx=${dx} · +y dy=${dy} (${geo?.pageLocalFromScreen ?? "rot0"})`);
  } else {
    axisBad++;
    console.error(
      `❌ 축 방향: gen-01 ${k} +x dx=${dx} · +y dy=${dy} — ${geo?.pageLocalFromScreen ?? "rot0"} 이면 둘 다 부호 ${wantSign} 여야 한다`,
    );
  }
}

const CASES = [
  {
    name: "gen-01 방명록 왼쪽 페이지(페이지 로컬)",
    corners: localPages.left,
    w: 620,
    h: 880,
  },
  {
    name: "gen-01 방명록 오른쪽 페이지(페이지 로컬)",
    corners: localPages.right,
    w: 620,
    h: 880,
  },
  {
    name: "gen-02 노트북 화면",
    corners: { tl: [1221, 533], tr: [1509, 556], br: [1441, 823], bl: [1152, 774] },
    w: 1280,
    h: 800,
  },
  {
    name: "직사각형(변환 없음)",
    corners: { tl: [100, 100], tr: [500, 100], br: [500, 400], bl: [100, 400] },
    w: 400,
    h: 300,
  },
  {
    name: "강한 사다리꼴",
    corners: { tl: [300, 200], tr: [1600, 340], br: [1500, 900], bl: [260, 700] },
    w: 1280,
    h: 800,
  },
];

const TOL = 0.05; // px
let failed = 0;

for (const c of CASES) {
  const matrix = cornersToMatrix3d(c.corners, c.w, c.h);
  const rect = [
    [0, 0],
    [c.w, 0],
    [c.w, c.h],
    [0, c.h],
  ];
  const want = [c.corners.tl, c.corners.tr, c.corners.br, c.corners.bl];
  const errs = rect.map((p, i) => {
    const got = project(matrix, p[0], p[1]);
    return Math.hypot(got[0] - want[i][0], got[1] - want[i][1]);
  });
  const worst = Math.max(...errs);
  if (worst > TOL) {
    failed++;
    console.error(`❌ ${c.name}: 최대 오차 ${worst.toFixed(2)}px (허용 ${TOL}px)`);
    rect.forEach((p, i) => {
      const got = project(matrix, p[0], p[1]).map((v) => Math.round(v));
      console.error(`   (${p[0]},${p[1]}) -> ${got.join(",")} · 기대 ${want[i].join(",")}`);
    });
  } else {
    console.log(`✅ ${c.name}: 최대 오차 ${worst.toFixed(4)}px`);
  }
}

if (failed || mirrored || axisBad) {
  console.error(
    `\n원근 매핑 게이트 실패 — 매핑 ${failed}건 · 거울상 ${mirrored}건. 화면에 덧씌운 것이 엉뚱한 자리에(또는 좌우 반전으로) 그려진다.`,
  );
  process.exit(1);
}
console.log(`\n원근 매핑 게이트 통과 (매핑 ${CASES.length}건 · 거울상 ${Object.keys(localPages).length}건 · 축 방향 ${Object.keys(localPages).length}건)`);
