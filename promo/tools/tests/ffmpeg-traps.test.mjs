// ffmpeg 함정 회귀: G26(adelay 뒤 apad 지연 보존) · G27(ffprobe csv 후행 쉼표 내성)
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fftraps-"));
const ff = (a) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...a]); assert.equal(r.status, 0, String(r.stderr)); };
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f], { encoding: "utf8" }).trim());

// G26: voice-post 체인(adelay→apad) — 0.3s 지연 + 0.4s 꼬리 = 1.7s 여야 한다
const inW = path.join(dir, "in.wav"), outW = path.join(dir, "out.wav");
ff(["-f", "lavfi", "-i", "sine=f=440:d=1", "-ar", "48000", inW]);
ff(["-i", inW, "-af", "adelay=300|300,apad=pad_dur=0.4", "-ar", "48000", outW]);
assert.ok(Math.abs(dur(outW) - 1.7) < 0.02, `G26 지연 소실 의심: ${dur(outW)}`);

// G27: 스트림 csv 출력이 "w,h," 로 와도 probeSize 의 split 파싱이 w,h 를 얻는다
const mp4 = path.join(dir, "t.mp4");
ff(["-f", "lavfi", "-i", "color=c=red:s=320x180:d=1:r=10", "-pix_fmt", "yuv420p", mp4]);
const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", mp4], { encoding: "utf8" }).trim();
const [w, h] = out.split(",").map(Number);
assert.deepEqual([w, h], [320, 180]);
fs.rmSync(dir, { recursive: true, force: true });
console.log("ffmpeg-traps OK");
