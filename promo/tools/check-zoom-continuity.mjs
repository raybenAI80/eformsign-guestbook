/**
 * 훅 → Paper 경계에서 카메라 줌이 **끊기지 않는지** 기계로 판정한다.
 *
 * 🔴 v4.1 재조준(2026-10-12): 본편 Main60 의 hook 은 HyperFrames 렌더본(HfHook)이라 Remotion
 *    훅 카메라가 없다. 그래서 판정 대상이 둘이다.
 *    [A] Main60 — HF hook → Paper 크로스페이드 리드인(XFADE_FRAMES). Paper 가 경계 앞 −XFADE..−1
 *        프레임부터 겹쳐 들어오며 그 구간 배율은 paperLeadScaleAt(옛 훅 곡선 꼬리)이다.
 *        Paper 의 Remotion 쪽 첫 프레임(0)에서 값·증분이 이어지는지, 리드인 구간이 단조인지 본다.
 *        Main60.tsx 가 hook=HfHook 이고 hook→paper lead-in 경계를 갖는지도 소스로 확인한다.
 *    [B] 옛 Remotion Hook → Paper(Preview9·Cut15 등 Remotion 훅을 계속 쓰는 컴포지션) — 아래 기존 판정.
 *
 * 사용: node tools/check-zoom-continuity.mjs
 *
 * 왜 필요한가 (2026-09-21 레인 J)
 *   v3 에서 훅은 gen-01 을 1.00→1.06 으로 밀고 Paper 는 **같은 사진**을 1.42 에서
 *   시작해 경계가 점프컷으로 보였다. 두 장면의 배율·초점을 `src/camera.ts` 한 곳에서
 *   가져오게 고쳤는데, 나중에 누가 한쪽만 손대면 다시 조용히 어긋난다. 그것을 막는
 *   게이트다. 판정 3가지:
 *     ① 배율 연속  — 훅 마지막 프레임의 다음 값 = Paper 0프레임 값 (오차 1e-9)
 *     ② 속도 연속  — 훅 끝 기울기 = Paper 시작 기울기 (상대오차 1e-6)
 *     ③ 단조·무역행 — 두 구간 모두 배율이 줄지 않는다(k 상한에 걸리면 여기서 걸린다)
 *   더해서 경계 전후 프레임 간 배율 증분이 **인접 프레임 증분과 같은 수준**인지
 *   (비 ≤ 1.5) 를 본다. 점프컷은 이 비가 크게 튀는 것으로 나타난다.
 *
 * 🔴 곡선 식을 여기에 다시 쓰지 않는다 — `src/camera.ts` 를 그대로 불러온다.
 *    Node 22 의 타입 스트리핑(--experimental-strip-types)으로 .ts 를 직접 읽고,
 *    geometry.ts 가 하는 `import ... from "*.json"` 은 resolve 훅으로 import 속성을
 *    채워 준다(소스를 건드리지 않기 위해서다).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/* 자식 프로세스로 재실행한다 — 타입 스트리핑과 JSON resolve 훅이 필요하기 때문 */
if (!process.env.__ZOOM_CHECK_CHILD) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zoomchk-"));
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
    { stdio: "inherit", env: { ...process.env, __ZOOM_CHECK_CHILD: "1" }, cwd: root },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}

const cam = await import(pathToFileURL(path.join(root, "src/camera.ts")).href);
const { bookZoomPlan, hookScaleAt, paperScaleAt, hookScaleSlopeAt, paperScaleSlopeAt } = cam;

const p = bookZoomPlan();
const fail = [];
const line = (ok, msg) => {
  console.log(`${ok ? "  OK " : "  X  "} ${msg}`);
  if (!ok) fail.push(msg);
};

console.log("[B] 옛 Remotion 훅 → Paper 연속 줌 판정 (Preview9·Cut15 용)");
console.log(
  `  계획: ${p.zoomStart.toFixed(4)} → ${p.zoomHandoff.toFixed(4)} → ${p.zoomEnd.toFixed(4)}` +
    ` · 초점 (${p.origin[0].toFixed(2)}, ${p.origin[1].toFixed(2)})` +
    ` · 훅 ${p.hookFrames}f · Paper 램프 ${p.paperRampFrames}f · k=${p.k.toFixed(6)}`,
);

/* ① 배율 연속 — 훅의 u=1 지점(= Paper 의 0프레임) */
const hookEndScale = hookScaleAt(p.hookFrames, p);
const paperStartScale = paperScaleAt(0, p);
line(
  Math.abs(hookEndScale - paperStartScale) < 1e-9,
  `배율 연속: 훅[u=1] ${hookEndScale.toFixed(9)} = Paper[0] ${paperStartScale.toFixed(9)}` +
    ` (차 ${Math.abs(hookEndScale - paperStartScale).toExponential(2)})`,
);

/* ② 속도 연속 — 프레임당 배율 변화 */
const vHook = hookScaleSlopeAt(p.hookFrames, p);
const vPaper = paperScaleSlopeAt(0, p);
const relV = Math.abs(vHook - vPaper) / Math.max(Math.abs(vHook), 1e-12);
line(
  relV < 1e-6 || p.kClamped === false,
  `속도 연속: 훅 끝 ${vHook.toFixed(9)} /f = Paper 시작 ${vPaper.toFixed(9)} /f (상대오차 ${relV.toExponential(2)})`,
);
line(relV < 1e-6, `속도 상대오차 < 1e-6 (실제 ${relV.toExponential(2)})`);
line(!p.kClamped, `k 가 단조 상한에 걸리지 않았다 (kClamped=${p.kClamped})`);

/* ③ 단조 */
let mono = true;
let prev = -Infinity;
const seq = [];
for (let f = 0; f <= p.hookFrames; f++) seq.push(hookScaleAt(f, p));
for (let f = 1; f <= p.paperRampFrames; f++) seq.push(paperScaleAt(f, p));
for (const s of seq) {
  if (s < prev - 1e-12) mono = false;
  prev = s;
}
line(mono, `배율이 전 구간 단조 증가 (총 ${seq.length}프레임, ${seq[0].toFixed(4)} → ${seq[seq.length - 1].toFixed(4)})`);

/* ④ 경계 증분이 인접 증분과 같은 수준인가 */
const d = (i) => seq[i + 1] - seq[i];
const bIdx = p.hookFrames - 1; // 훅 마지막 프레임 → Paper 첫 프레임 사이의 증분
const boundary = d(bIdx);
const before = d(bIdx - 1);
const after = d(bIdx + 1);
const ratio = boundary / Math.max((before + after) / 2, 1e-12);
line(
  ratio > 0.5 && ratio < 1.5,
  `경계 증분 ${boundary.toFixed(6)} vs 이웃 평균 ${((before + after) / 2).toFixed(6)} → 비 ${ratio.toFixed(3)} (0.5~1.5)`,
);
console.log(
  `  참고: 경계 앞 증분 ${before.toFixed(6)} · 경계 ${boundary.toFixed(6)} · 경계 뒤 ${after.toFixed(6)}`,
);
console.log(
  `  참고: 옛 구조였다면 경계 증분 = ${(1.42 - 1.06).toFixed(6)} (배율 점프) → 비 ${(
    (1.42 - 1.06) / Math.max((before + after) / 2, 1e-12)
  ).toFixed(1)}`,
);

/* ---------- [A] v4.1 Main60: HF hook → Paper 리드인 ---------- */
console.log("");
console.log("[A] Main60 HF hook → Paper 크로스페이드 리드인 판정");
const main60 = fs.readFileSync(path.join(root, "src/compositions/Main60.tsx"), "utf8");
const xm = main60.match(/export const XFADE_FRAMES = (\d+);/);
const XF = xm ? Number(xm[1]) : NaN;
line(Number.isFinite(XF) && XF > 0 && XF <= p.hookFrames, `Main60 XFADE_FRAMES = ${XF} (0 < XF ≤ 훅 ${p.hookFrames}f)`);
line(/hook:\s*HfHook/.test(main60), "Main60 hook 화면 = HfHook(HF 렌더본) — 아니면 [A] 판정 전제가 바뀐다");
line(/from:\s*"hook",\s*to:\s*"paper",\s*kind:\s*"lead-in"/.test(main60), "Main60 hook→paper 경계 = lead-in 크로스페이드");
const bookCam = fs.readFileSync(path.join(root, "src/components/BookCamera.tsx"), "utf8");
line(/paperLeadScaleAt\(frame, PLAN\)/.test(bookCam) && /CameraFrameOffset/.test(bookCam), "BookCamera paper 단계 = paperLeadScaleAt + CameraFrameOffset");
if (Number.isFinite(XF)) {
  const lead = [];
  for (let f = -XF; f <= p.paperRampFrames; f++) lead.push(cam.paperLeadScaleAt(f, p));
  line(Math.abs(cam.paperLeadScaleAt(0, p) - paperScaleAt(0, p)) < 1e-12, `Paper 첫 프레임 배율 = 램프 시작 ${paperScaleAt(0, p).toFixed(6)}`);
  let m = true;
  for (let i = 1; i < lead.length; i++) if (lead[i] < lead[i - 1] - 1e-12) m = false;
  line(m, `리드인(−${XF}f)~램프 끝 배율 단조 증가 (${lead[0].toFixed(4)} → ${lead[lead.length - 1].toFixed(4)})`);
  const i0 = XF; // lead[i0] = frame 0
  const dB = lead[i0] - lead[i0 - 1];
  const dN = ((lead[i0 - 1] - lead[i0 - 2]) + (lead[i0 + 1] - lead[i0])) / 2;
  const r = dB / Math.max(dN, 1e-12);
  line(r > 0.5 && r < 1.5, `Paper 첫 프레임 경계 증분 ${dB.toFixed(6)} vs 이웃 평균 ${dN.toFixed(6)} → 비 ${r.toFixed(3)} (0.5~1.5)`);
  const frozenJump = paperScaleAt(0, p) - cam.paperLeadScaleAt(-XF, p);
  console.log(`  참고: 줌을 멈춘 채(Freeze) 겹쳤다면 0프레임에서 출발할 때 ${XF}f 분량 ${frozenJump.toFixed(4)} 배율을 정지했다가 갑자기 움직였다`);
}

if (fail.length) {
  console.error(`\n실패 ${fail.length}건`);
  process.exit(1);
}
console.log("\n통과");
