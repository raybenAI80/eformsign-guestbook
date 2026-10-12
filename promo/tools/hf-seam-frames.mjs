/**
 * v4.0 A안(2026-10-12) — Main60 의 HF↔Remotion 장면 경계 판정 자료를 뽑는다.
 *
 *   node tools/hf-seam-frames.mjs <main60.mp4> <출력 디렉터리>
 *
 * 경계 = scene-durations.json 에서 HF 고정 장면(driver:"fixed")이 시작·끝나는 프레임.
 * 경계마다: 경계 −6f(−0.2초)·+6f(+0.2초) 원본 크기 PNG 2장 + 경계 프레임 가운데 960×540 을 200% 로 키운 크롭 1장.
 * (Main60 장면 이음은 하드컷 — 「전환 중간」 = 경계 프레임 자체.)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [video, outDir] = process.argv.slice(2);
if (!video || !outDir) { console.error("usage: node tools/hf-seam-frames.mjs <main60.mp4> <outDir>"); process.exit(2); }
const dur = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "scene-durations.json"), "utf8"));
const FPS = dur.fps;
const ids = Object.keys(dur.scenes);
const seams = [];
ids.forEach((id, i) => {
  const s = dur.scenes[id];
  if (s.driver !== "fixed") return;
  if (i > 0) seams.push({ name: `${ids[i - 1]}-to-${id}`, frame: s.startFrame, kind: "R→HF" });
  if (i < ids.length - 1) seams.push({ name: `${id}-to-${ids[i + 1]}`, frame: s.startFrame + s.frames, kind: "HF→R" });
});
fs.mkdirSync(outDir, { recursive: true });
const grab = (frame, file, vf) => {
  const args = ["-v", "error", "-y", "-ss", (frame / FPS).toFixed(4), "-i", video, "-frames:v", "1"];
  if (vf) args.push("-vf", vf);
  execFileSync("ffmpeg", [...args, path.join(outDir, file)]);
};
const out = [];
for (const s of seams) {
  const pre = s.frame - 6, post = s.frame + 6;
  grab(pre, `${s.name}-f${pre}-minus0.2s.png`);
  grab(post, `${s.name}-f${post}-plus0.2s.png`);
  grab(s.frame, `${s.name}-f${s.frame}-cut-crop200.png`, "crop=960:540:480:270,scale=1920:1080:flags=neighbor");
  out.push({ ...s, files: [pre, post, s.frame] });
}
console.log(JSON.stringify(out, null, 2));
