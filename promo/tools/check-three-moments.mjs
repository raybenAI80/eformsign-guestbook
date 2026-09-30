/**
 * v3.3 three.js 연출 기하 게이트 — 설명은 아래 본문 주석.
 * 🔴 moments-geometry.ts 를 그대로 불러온다(식 재작성 금지). 타입 스트리핑 + JSON resolve 훅은
 *    check-zoom-continuity.mjs 와 같은 방식이다.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/* 자식 프로세스로 재실행한다 — 타입 스트리핑과 JSON resolve 훅이 필요하기 때문 */
if (!process.env.__THREE_CHECK_CHILD) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "threechk-"));
  const hook = path.join(dir, "json-attr-hook.mjs");
  const reg = path.join(dir, "register.mjs");
  fs.writeFileSync(
    hook,
    `export async function resolve(spec, ctx, next) {
  let r;
  try {
    r = await next(spec, ctx);
  } catch (e) {
    /* TS 소스는 확장자 없이 import 한다(번들러가 붙인다) — Node 용으로 .ts 를 보태 본다 */
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
    [
      "--experimental-strip-types",
      "--no-warnings",
      /* 🔴 Windows 에서는 절대경로를 그대로 주면 드라이브 문자를 URL 스킴으로 읽는다 */
      "--import",
      pathToFileURL(reg).href,
      fileURLToPath(import.meta.url),
    ],
    { stdio: "inherit", env: { ...process.env, __THREE_CHECK_CHILD: "1" }, cwd: root },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}


/*
 * v3.3 three.js 연출 기하 게이트 (레인 T2, 2026-09-30 · 레인 T3 개정 같은 날).
 *   ① Paper→Designer 종이: 전 프레임(불투명도 > 0)에서 종이 화면 경계상자 ∩ 자막 띠 = 0
 *      (자막 띠 = 전폭 · 높이는 Caption 조판식) · 시작 = 읽는 쪽 페이지 사각형(40% 로 줄이고 위로만 민 것)과 일치
 *      · [T3] 전 프레임 높이 ≤ 화면 40% · 착지 = Designer 서식 페이지 사각형 안 · 종이 = 한 페이지(세로)
 *      · [T3] 텍스처 = 페이지 로컬(정방향)로 편 한 쪽 · 비지면(손·펜·모서리) 화소 0 (mask-page-texture.py --check)
 *   ② Manage 도입 카드: [T3] 높이 = D01 화면 사각형 높이의 25% · 착지 꼭짓점 전부 노트북 화면 사각형 안
 *      · [T3] 이웃 카드와 살짝 겹침(카드 면적의 10~45%)
 *   ③ Caption.tsx 조판 상수(lineHeight 1.24 · round(size*0.16))가 moments-geometry 식과 같은지
 * 사용: node tools/check-three-moments.mjs   (exit 1 = 불통과)
 */
const G = await import(pathToFileURL(path.join(root, "src/components/three/moments-geometry.ts")).href);
const fail = [];
const line = (ok, msg) => {
  console.log(`${ok ? "  OK " : "  X  "} ${msg}`);
  if (!ok) fail.push(msg);
};
const inter = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const r1 = (v) => Math.round(v * 10) / 10;
const fmt = (r) => `(${r1(r.x)},${r1(r.y)} ${r1(r.w)}x${r1(r.h)})`;

console.log("① Paper→Designer 종이");
const cap = fs.readFileSync(path.join(root, "src/components/Caption.tsx"), "utf8");
line(/lineHeight:\s*1\.24/.test(cap) && /Math\.round\(size \* 0\.16\)/.test(cap), "Caption.tsx 조판 상수 = captionStackHeight 식");
const paperSrc = fs.readFileSync(path.join(root, "src/scenes/Paper.tsx"), "utf8");
line(/PAPER_CAPTION\.size/.test(paperSrc) && /PAPER_CAPTION\.bottom/.test(paperSrc), "Paper.tsx 자막이 PAPER_CAPTION 을 쓴다");
line(/bottom:\s*110/.test(cap), "CaptionBar bottom 110 = DESIGNER_CAPTION.bottom");
const pb = G.paperCaptionBand();
const db = G.designerCaptionBand();
console.log(`     자막 띠 Paper ${fmt(pb)} · Designer ${fmt(db)}`);
const end = G.pageRectAtPaperEnd();
const s0 = G.paperLiftStartRect();
const e1 = G.paperLiftEndRect();
const page = G.designerFormPageRect();
console.log(`     Paper 끝 읽는 쪽(${G.readSide()}) ${fmt(end)} → 시작 ${fmt(s0)} → 끝 ${fmt(e1)} (서식 페이지 ${fmt(page)} · 카드 ${fmt(G.CARD_RECT)})`);
line(G.SHEET.h > G.SHEET.w, `종이 = 한 페이지 세로 ${G.SHEET.w}x${G.SHEET.h}`);
const rows = [];
let maxOverlap = 0;
let minGap = Infinity;
let maxH = 0;
for (let f = 0; f < G.PAPER_LIFT_FRAMES; f++) {
  const st = G.paperLiftState(f);
  const band = G.liftCaptionBand(f);
  const ov = st.opacity > 0 ? inter(st.bbox, band) : 0;
  const gap = band.y - (st.bbox.y + st.bbox.h);
  if (st.opacity > 0) {
    maxOverlap = Math.max(maxOverlap, ov);
    maxH = Math.max(maxH, st.bbox.h);
    minGap = Math.min(minGap, gap);
  }
  rows.push(`     f${String(f).padStart(2)} ${f < G.PAPER_LIFT_FRAMES / 2 ? "Paper   " : "Designer"} op ${st.opacity.toFixed(2)} tilt ${st.pose.tilt.toFixed(3)} bbox ${fmt(st.bbox)} 자막까지 ${r1(gap)}px 겹침 ${r1(ov)}`);
}
console.log(rows.join("\n"));
line(maxH <= G.FRAME_H * 0.4 + 0.5, `종이 높이 최대 ${r1(maxH)}px ≤ 화면 40% ${G.FRAME_H * 0.4}px (전 프레임, 반올림 0.5px)`);
line(maxOverlap === 0, `자막 띠 겹침 면적 최대 ${maxOverlap} px² (전 프레임) · 최소 간격 ${r1(minGap)}px`);
const st0 = G.bboxOf(G.projectSheet(G.solveLyingPose(s0)));
line(Math.abs(st0.x - s0.x) < 1 && Math.abs(st0.y - s0.y) < 1 && Math.abs(st0.w - s0.w) < 1 && Math.abs(st0.h - s0.h) < 1, `누운 종이 투영 = 시작 사각형 (오차 ≤1px) ${fmt(st0)}`);
const fl = G.paperLiftState(Math.round((G.PAPER_LIFT_FRAMES - 1) * 0.56));
line(Math.abs(fl.bbox.w - e1.w) < 2 && Math.abs(fl.bbox.y - e1.y) < 2, `착지 = 끝 자리 ${fmt(fl.bbox)}`);
const inside = (a, b) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
line(inside(fl.bbox, page), `착지 사각형 ⊂ Designer 서식 페이지 ${fmt(page)}`);
const texSrc = fs.readFileSync(path.join(root, "src/compositions/PageTexture.tsx"), "utf8");
line(/bookPageLeft\(\)\s*:\s*bookPageRight\(\)/.test(texSrc) && !/import[^;]*bookPageScreen/.test(texSrc), "텍스처 = 페이지 로컬 라벨(정방향)로 편 읽는 쪽 한 페이지");
const texPng = path.join(root, "public", G.TEXTURE_FILE);
const py = spawnSync(process.platform === "win32" ? "python" : "python3", [path.join(here, "mask-page-texture.py"), "--check", texPng], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf8" } });
console.log(`     ${(py.stdout || py.stderr || "").trim()}`);
line(py.status === 0, "텍스처 손·펜·모서리(비지면) 화소 0");

console.log("② Manage 도입 카드");
const q = G.manageQuad();
const size = G.docCardSize();
const ratio = size.h / size.screenH;
line(Math.abs(ratio - 0.25) < 1e-6, `카드 ${r1(size.w)}x${r1(size.h)} = D01 화면 사각형 높이 ${r1(size.screenH)}px 의 ${(ratio * 100).toFixed(1)}% (25%)`);
const land = [(q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4, (q.tl[1] + q.tr[1] + q.br[1] + q.bl[1]) / 4];
const box = G.DOC_BOX;
let allIn = true;
for (let i = 0; i < 3; i++) {
  const cs = G.docCardLandedCorners(i, land, box);
  const ok = cs.every((p) => G.pointInQuad(p, q));
  allIn &&= ok;
  console.log(`     카드${i} 착지 f${G.docLandFrame(i)} 꼭짓점 ${cs.map((p) => `(${r1(p[0])},${r1(p[1])})`).join(" ")} ${ok ? "안" : "밖"}`);
}
line(allIn, "착지 꼭짓점 전부 노트북 화면 사각형 안");
/* 이웃 카드 겹침 — 볼록 사각형 교집합(Sutherland–Hodgman) 면적 / 카드 면적 */
const area = (P) => Math.abs(P.reduce((s, p, i) => s + p[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * p[1], 0)) / 2;
const clip = (subj, clipP) => {
  let out = subj;
  const orient = Math.sign(area(clipP) && ((clipP[1][0] - clipP[0][0]) * (clipP[2][1] - clipP[0][1]) - (clipP[1][1] - clipP[0][1]) * (clipP[2][0] - clipP[0][0])));
  for (let i = 0; i < clipP.length && out.length; i++) {
    const a = clipP[i];
    const b = clipP[(i + 1) % clipP.length];
    const side = (p) => orient * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const P = inp[j];
      const Q = inp[(j + 1) % inp.length];
      const sp = side(P);
      const sq = side(Q);
      if (sp >= 0) out.push(P);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
      }
    }
  }
  return out;
};
const cards = [0, 1, 2].map((i) => G.docCardLandedCorners(i, land, box));
let overlapOk = true;
for (let i = 0; i < 2; i++) {
  const inter2 = clip(cards[i], cards[i + 1]);
  const frac = inter2.length >= 3 ? area(inter2) / area(cards[i]) : 0;
  const ok = frac >= 0.1 && frac <= 0.45;
  overlapOk &&= ok;
  console.log(`     카드${i}∩카드${i + 1} = 카드 면적의 ${(frac * 100).toFixed(1)}% ${ok ? "" : "(범위 밖)"}`);
}
line(overlapOk, "착지 카드 이웃끼리 살짝 겹침(10~45%)");

console.log(fail.length ? `\n불통과 ${fail.length}건` : "\nthree 연출 기하 게이트 통과");
process.exit(fail.length ? 1 : 0);
