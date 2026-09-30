/**
 * v3.3 레인 T3 — Paper→Designer 3D 종이 텍스처를 굽는다.
 *   node tools/make-page-texture.mjs
 * ① PageTexture 컴포지션(gen-01 **읽는 쪽 한 페이지** + 손글씨 층, 페이지 로컬 = 정방향)의 **마지막 프레임**
 *    (손글씨 완료)을 스틸로 굽는다 → public/three/guestbook-page.raw.png (커밋하지 않는 중간 산출)
 * ② tools/mask-page-texture.py 가 손/펜 화소를 지면 색으로 메워 public/three/guestbook-page.png 로 쓴다.
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
/* 마지막 프레임 = 컴포지션 길이 - 1 → remotion still 은 음수 프레임을 끝에서 센다 */
const r = spawnSync(
  win ? "npx.cmd" : "npx",
  ["remotion", "still", "PageTexture", raw, "--frame=-1", "--timeout=180000", "--concurrency=1"],
  { cwd: root, stdio: "inherit", shell: win },
);
if (r.status !== 0) process.exit(r.status ?? 1);
const m = spawnSync(win ? "python" : "python3", ["tools/mask-page-texture.py", raw, out], {
  cwd: root,
  stdio: "inherit",
});
if (m.status !== 0) process.exit(m.status ?? 1);
fs.rmSync(path.join(root, raw), { force: true });
process.exit(0);
