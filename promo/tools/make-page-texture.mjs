/**
 * v3.3 레인 T3 — Paper→Designer 3D 종이 텍스처를 굽는다.
 *   node tools/make-page-texture.mjs
 * ① PageTexture 컴포지션(gen-01 **읽는 쪽 한 페이지** + 손글씨 층, 페이지 로컬 = 정방향)의 **마지막 프레임**
 *    (손글씨 완료)을 스틸로 굽는다 → public/three/guestbook-page.raw.png (커밋하지 않는 중간 산출)
 * ② tools/mask-page-texture.py 가 손/펜 화소를 지면 색으로 메워 public/three/guestbook-page.png 로 쓴다.
 * ③ 레인 V2: 같은 도구가 오른쪽·위 가장자리(제본 굴곡 띠·옅은 곡선)를 EDGE_CROP 비율로 잘라내고 원래 크기로 균등 확대한다
 *    (`--edge-crop <비율>` 로 바꿀 수 있다, 0 = 끔). 근거 수치는 mask-page-texture.py 머리말.
 * gen-01·prompts.json·손글씨 설정이 바뀌면 다시 돌린다. 🔴 구간 렌더와 같은 이유로 --concurrency=1 · 긴 timeout.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = "public/three/guestbook-page.raw.png";
const out = "public/three/guestbook-page.png";
const win = process.platform === "win32";
/* 오른쪽 띠 시작 x≈1015/1240(열 평균 밝기 표준편차 급증 지점) → 1-1015/1240 ≈ 0.18, 여유 포함 0.19 */
const EDGE_CROP_DEFAULT = 0.19;
const ai = process.argv.indexOf("--edge-crop");
const edgeCrop = ai > 0 ? Number(process.argv[ai + 1]) : EDGE_CROP_DEFAULT;
/* 마지막 프레임 = 컴포지션 길이 - 1 → remotion still 은 음수 프레임을 끝에서 센다 */
const r = spawnSync(
  win ? "npx.cmd" : "npx",
  ["remotion", "still", "PageTexture", raw, "--frame=-1", "--timeout=180000", "--concurrency=1"],
  { cwd: root, stdio: "inherit", shell: win },
);
if (r.status !== 0) process.exit(r.status ?? 1);
const m = spawnSync(win ? "python" : "python3", ["tools/mask-page-texture.py", raw, out, "--edge-crop", String(edgeCrop)], {
  cwd: root,
  stdio: "inherit",
});
if (m.status !== 0) process.exit(m.status ?? 1);
fs.rmSync(path.join(root, raw), { force: true });
process.exit(0);
