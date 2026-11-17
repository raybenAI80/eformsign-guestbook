/**
 * 구간 나눔 렌더 — 긴 컴포지션을 프레임 구간별로 렌더하고 실패 구간만 다시 돌린 뒤 이어 붙인다.
 *
 *   node tools/render-chunked.mjs Main60 out/main60.mp4 [--chunk 300] [--retries 3] [--concurrency 2]
 *
 * 왜(2026-10-12 v4.0 조립): 한 번에 1800f 를 렌더하면 간헐적으로 실패했다 —
 *   ① 새 탭의 loadFont(Paperlogy) delayRender 가 28초·118초 모두 안 풀림(frame 270·1766·1384·1090 — 위치 무관)
 *   ② Node `Error: write EOF`(frame ~596)
 *   ③ 기본 concurrency(탭 다수)면 three.js WebGL 컨텍스트 생성 실패(frame 382)
 * 타임아웃을 늘려도 소용없는 정지형·간헐 실패라 **구간 단위 재시도**로 흡수한다.
 * 🔴 wav(소리) 렌더도 프레임을 전부 렌더한다 — 1800f 한 번에 돌리면 같은 이유로 3회 연속 실패했다. 그래서 소리도 구간으로 나눈다.
 *
 * 절차: 구간마다 ① --muted h264 ② --codec=wav(PCM) → 영상은 concat(-c copy), 소리는 concat(PCM, 샘플 단위 이음)
 *       → 최종 mux(영상 copy + AAC 320k). 중간 파일은 out/.chunks/<comp>/ 에 남겨 재실행 시 이미 있는 구간은 건너뛴다.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const [comp, outFile] = argv;
if (!comp || !outFile) { console.error("usage: node tools/render-chunked.mjs <Composition> <out.mp4> [--chunk N] [--retries N] [--concurrency N]"); process.exit(2); }
const CHUNK = Number(opt("chunk", 300)), RETRIES = Number(opt("retries", 3)), CONC = opt("concurrency", "2");
const isWin = process.platform === "win32";
const npx = (args, extra = {}) => spawnSync(isWin ? "npx.cmd" : "npx", ["remotion", ...args], { cwd: ROOT, stdio: "inherit", shell: isWin, ...extra });

// 총 프레임 수 — `remotion compositions` 한 줄 = id · fps · WxH · frames
const meta = npx(["compositions"], { stdio: "pipe", encoding: "utf8" });
const line = (meta.stdout || "").split(/\r?\n/).find((l) => l.trim().startsWith(comp + " "));
const total = line ? Number(line.trim().split(/\s+/)[3]) : NaN;
if (!Number.isFinite(total)) { console.error(`컴포지션 ${comp} 의 프레임 수를 못 읽었다:\n${meta.stdout}`); process.exit(1); }

const work = path.join(ROOT, "out", ".chunks", comp);
fs.mkdirSync(work, { recursive: true });

function renderRange(file, a, b, extraArgs, label) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) { console.log(`[skip] ${label} ${a}-${b}`); return; }
  for (let t = 1; t <= RETRIES; t++) {
    console.log(`[render] ${label} ${a}-${b} 시도 ${t}/${RETRIES}`);
    const r = npx(["render", comp, file, `--frames=${a}-${b}`, `--concurrency=${CONC}`, "--timeout=60000", ...extraArgs]);
    if (r.status === 0 && fs.existsSync(file)) return;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  console.error(`🔴 ${label} 구간 ${a}-${b} 실패(${RETRIES}회)`);
  process.exit(1);
}

const vparts = [], aparts = [];
for (let a = 0; a < total; a += CHUNK) {
  const b = Math.min(total, a + CHUNK) - 1;
  const tag = `${String(a).padStart(5, "0")}-${b}`;
  const v = path.join(work, `v-${tag}.mp4`), w = path.join(work, `a-${tag}.wav`);
  renderRange(v, a, b, ["--muted"], "영상");
  renderRange(w, a, b, ["--codec=wav"], "소리");
  vparts.push(v); aparts.push(w);
}
const concat = (parts, name, out) => {
  const list = path.join(work, name);
  fs.writeFileSync(list, parts.map((p) => `file '${p.split(path.sep).join("/")}'`).join(String.fromCharCode(10)));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out], { stdio: "inherit" });
};
const vid = path.join(work, "video.mp4"), wav = path.join(work, "audio.wav");
concat(vparts, "list-v.txt", vid);
concat(aparts, "list-a.txt", wav);
const dest = path.resolve(ROOT, outFile);
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", vid, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", dest], { stdio: "inherit" });
console.log(`OK ${dest} (${total}f)`);
