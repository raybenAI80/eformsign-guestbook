/**
 * v4.0 A안(2026-10-12) — Main60 의 HF↔Remotion 장면 경계 판정 자료를 뽑는다.
 *
 *   node tools/hf-seam-frames.mjs <main60.mp4> <출력 디렉터리>
 *
 * 경계 = scene-durations.json 에서 HF 고정 장면(driver:"fixed")이 시작·끝나는 프레임.
 * 경계마다: 경계 −6f(−0.2초)·+6f(+0.2초) 원본 크기 PNG 2장 + 경계 프레임 가운데 960×540 을 200% 로 키운 크롭 1장.
 * v4.1(10-12): hook→paper·fill→repeat 는 크로스페이드(Main60.tsx XFADE_FRAMES). 그 두 경계는 겹침 구간 가운데 프레임을
 * 원본 크기 + 가운데 960×540 200% 크롭으로 더 뽑는다(…-xfade-mid-f<n>.png / …-xfade-mid-f<n>-crop200.png).
 * 나머지 경계는 하드컷 — 「전환 중간」 = 경계 프레임 자체.
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
const main60 = fs.readFileSync(path.join(ROOT, "src", "compositions", "Main60.tsx"), "utf8");
const XF = Number((main60.match(/export const XFADE_FRAMES = (\d+);/) || [])[1] || 0);
const xfades = [...main60.matchAll(/from:\s*"(\w+)",\s*to:\s*"(\w+)",\s*kind:\s*"(lead-in|tail-out)"/g)].map((m) => ({ name: `${m[1]}-to-${m[2]}`, kind: m[3] }));
const out = [];
for (const s of seams) {
  const pre = s.frame - 6, post = s.frame + 6;
  grab(pre, `${s.name}-f${pre}-minus0.2s.png`);
  grab(post, `${s.name}-f${post}-plus0.2s.png`);
  grab(s.frame, `${s.name}-f${s.frame}-cut-crop200.png`, "crop=960:540:480:270,scale=1920:1080:flags=neighbor");
  const xf = xfades.find((x) => x.name === s.name);
  if (xf && XF) {
    // lead-in = 경계 앞 XF 프레임, tail-out = 경계 뒤 XF 프레임이 겹침 구간
    const mid = xf.kind === "lead-in" ? s.frame - Math.ceil(XF / 2) : s.frame + Math.floor(XF / 2);
    grab(mid, `${s.name}-xfade-mid-f${mid}.png`);
    grab(mid, `${s.name}-xfade-mid-f${mid}-crop200.png`, "crop=960:540:480:270,scale=1920:1080:flags=neighbor");
    out.push({ ...s, xfade: xf.kind, files: [pre, post, s.frame, mid] });
    continue;
  }
  out.push({ ...s, files: [pre, post, s.frame] });
}

/* 판정 시트 sheet.png — 경계마다 한 줄: −0.2초 | 경계(크로스페이드면 겹침 가운데) | +0.2초, 칸당 640×360 */
const rows = out.map((s) => {
  const mid = s.files[3] ?? s.frame;
  return [s.files[0], mid, s.files[1]];
});
const inputs = [];
const parts = [];
rows.forEach((r, ri) => {
  r.forEach((f, ci) => {
    inputs.push("-ss", (f / FPS).toFixed(4), "-i", video);
    parts.push(`[${ri * 3 + ci}:v]trim=end_frame=1,scale=640:360,setpts=PTS-STARTPTS[c${ri}_${ci}]`);
  });
  parts.push(`[c${ri}_0][c${ri}_1][c${ri}_2]hstack=inputs=3[r${ri}]`);
});
parts.push(`${rows.map((_, i) => `[r${i}]`).join("")}vstack=inputs=${rows.length}[out]`);
execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-frames:v", "1", path.join(outDir, "sheet.png")]);
console.log(JSON.stringify(out, null, 2));
