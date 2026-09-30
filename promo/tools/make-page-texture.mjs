/**
 * v3.3 레인 T2 — Paper→Designer 3D 종이 텍스처를 굽는다.
 *   node tools/make-page-texture.mjs
 * PageTexture 컴포지션(gen-01 펼친 지면 + 손글씨 층, 정사영)의 **마지막 프레임**(손글씨 완료)을
 * public/three/guestbook-spread.png 로 저장한다. gen-01·prompts.json·손글씨 설정이 바뀌면 다시 돌린다.
 * 🔴 구간 렌더와 같은 이유로 --concurrency=1 · 긴 timeout.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = "public/three/guestbook-spread.png";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
/* 마지막 프레임 = 컴포지션 길이 - 1 → remotion still 은 음수 프레임을 끝에서 센다 */
const r = spawnSync(
  npx,
  ["remotion", "still", "PageTexture", out, "--frame=-1", "--timeout=180000", "--concurrency=1"],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(r.status ?? 1);
