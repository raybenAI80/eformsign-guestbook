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
 * v3.3 three.js 연출 기하 게이트 (레인 T2, 2026-09-30).
 *   ① Paper→Designer 종이: 전 프레임(불투명도 > 0)에서 종이 화면 경계상자 ∩ 자막 띠 = 0
 *      (자막 띠 = 전폭 · 높이는 Caption 조판식) · 시작 = Paper 끝 지면 사각형(위로만 민 것)과 일치
 *   ② Manage 도입 카드: 높이 = D01 목록 한 행의 1.5~2배 · 착지 꼭짓점 전부 노트북 화면 사각형 안
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
const end = G.spreadRectAtPaperEnd();
const s0 = G.paperLiftStartRect();
const e1 = G.paperLiftEndRect();
console.log(`     Paper 끝 지면 ${fmt(end)} → 시작 ${fmt(s0)} (위로 ${r1(end.y - s0.y)}px) → 끝 ${fmt(e1)} (카드 ${fmt(G.CARD_RECT)})`);
const rows = [];
let maxOverlap = 0;
let minGap = Infinity;
for (let f = 0; f < G.PAPER_LIFT_FRAMES; f++) {
  const st = G.paperLiftState(f);
  const band = G.liftCaptionBand(f);
  const ov = st.opacity > 0 ? inter(st.bbox, band) : 0;
  const gap = band.y - (st.bbox.y + st.bbox.h);
  if (st.opacity > 0) {
    maxOverlap = Math.max(maxOverlap, ov);
    minGap = Math.min(minGap, gap);
  }
  rows.push(`     f${String(f).padStart(2)} ${f < G.PAPER_LIFT_FRAMES / 2 ? "Paper   " : "Designer"} op ${st.opacity.toFixed(2)} tilt ${st.pose.tilt.toFixed(3)} bbox ${fmt(st.bbox)} 자막까지 ${r1(gap)}px 겹침 ${r1(ov)}`);
}
console.log(rows.join("\n"));
line(maxOverlap === 0, `자막 띠 겹침 면적 최대 ${maxOverlap} px² (전 프레임) · 최소 간격 ${r1(minGap)}px`);
const st0 = G.bboxOf(G.projectSheet(G.solveLyingPose(s0)));
line(Math.abs(st0.x - s0.x) < 1 && Math.abs(st0.y - s0.y) < 1 && Math.abs(st0.w - s0.w) < 1 && Math.abs(st0.h - s0.h) < 1, `누운 종이 투영 = 시작 사각형 (오차 ≤1px) ${fmt(st0)}`);
const fl = G.paperLiftState(Math.round((G.PAPER_LIFT_FRAMES - 1) * 0.56));
line(Math.abs(fl.bbox.w - e1.w) < 2 && Math.abs(fl.bbox.y - e1.y) < 2, `착지 = 카드 자리 ${fmt(fl.bbox)}`);

console.log("② Manage 도입 카드");
const q = G.manageQuad();
const size = G.docCardSize();
const mult = size.h / size.row;
line(mult >= 1.5 && mult <= 2, `카드 ${r1(size.w)}x${r1(size.h)} = 목록 한 행 ${r1(size.row)}px 의 ${mult.toFixed(2)}배 (1.5~2)`);
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

console.log(fail.length ? `\n불통과 ${fail.length}건` : "\nthree 연출 기하 게이트 통과");
process.exit(fail.length ? 1 : 0);
