#!/usr/bin/env node
/**
 * HyperFrames 3장면(hook·repeat·cta)을 렌더해 **무음** mp4 로 public/hf/ 에 둔다 — v4.0 A안(2026-10-12).
 *
 *   node tools/build-hf-clips.mjs            # 3장면 전부 렌더 → 무음화 → public/hf/{hook,repeat,cta}.mp4
 *   node tools/build-hf-clips.mjs --no-render # 이미 렌더된 ../.work/hf-pilot/*.mp4 를 무음화만
 *
 * 왜 무음인가: 오디오(나레이션·BGM 덕킹·효과음)는 Remotion 트랙만 쓴다. HF 렌더본에는 빈
 * AAC 트랙이 붙어 나오므로 ffmpeg `-an -c:v copy` 로 떼어 낸다(재인코딩 없음 = 화질 손실 0).
 * public/hf/*.mp4 는 커밋하지 않는다(.gitignore) — 이 명령으로 언제든 다시 만든다.
 *
 * 길이 계약: hook 135f · repeat 240f · cta 135f @30fps. 다르면 exit 1
 * (src/scene-durations.json 의 HF 고정 프레임 = tools/scene-durations.mjs HF_FIXED_FRAMES 와 짝).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(PROMO, "..");
const RENDER_DIR = path.join(REPO, ".work", "hf-pilot");
const OUT_DIR = path.join(PROMO, "public", "hf");
/** Remotion 장면 id → HF 장면 이름 · 기대 프레임 */
export const HF_CLIPS = {
  hook: { hf: "hook", frames: 135 },
  repeat: { hf: "compare", frames: 240 },
  cta: { hf: "cta", frames: 135 },
};

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} → exit ${r.status}`);
};
const probe = (file) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,nb_frames,r_frame_rate,width,height", "-of", "json", file], { encoding: "utf8" });
  return JSON.parse(r.stdout).streams;
};

const noRender = process.argv.includes("--no-render");
fs.mkdirSync(RENDER_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
let bad = 0;
for (const [id, c] of Object.entries(HF_CLIPS)) {
  const src = path.join(RENDER_DIR, `${c.hf}.mp4`);
  if (!noRender) run("node", [path.join(REPO, "promo-hf", "tools", "render-scene.mjs"), c.hf, src], { cwd: REPO });
  const dst = path.join(OUT_DIR, `${id}.mp4`);
  run("ffmpeg", ["-y", "-v", "error", "-i", src, "-an", "-c:v", "copy", "-movflags", "+faststart", dst]);
  const st = probe(dst);
  const v = st.find((s) => s.codec_type === "video");
  const hasAudio = st.some((s) => s.codec_type === "audio");
  const ok = v && Number(v.nb_frames) === c.frames && v.r_frame_rate === "30/1" && v.width === 1920 && v.height === 1080 && !hasAudio;
  if (!ok) bad++;
  console.log(`${ok ? "OK " : "BAD"} ${id} ← ${c.hf}.mp4  frames=${v?.nb_frames}/${c.frames} fps=${v?.r_frame_rate} ${v?.width}x${v?.height} audio=${hasAudio}`);
}
process.exit(bad ? 1 : 0);
