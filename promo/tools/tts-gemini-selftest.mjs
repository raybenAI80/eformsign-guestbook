#!/usr/bin/env node
/**
 * tts-gemini.mjs 오프라인 자가검사 — fetch 를 가짜로 바꿔 키 없이 전 과정을 돌린다.
 *   node tools/tts-gemini-selftest.mjs
 * 검사: 429 1회 후 재시도 성공 · 문장별 wav/mp3 생성 · mp3 48kHz mono · 연결본 길이 = 문장 합 + 간격 합
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tts-gemini-selftest-"));
const mock = path.join(tmp, "mock.mjs");
fs.writeFileSync(
  mock,
  `let n=0;globalThis.fetch=async(url)=>{n++;if(n===2)return new Response('{}',{status:429});
const pcm=Buffer.alloc(24000);for(let i=0;i<12000;i++)pcm.writeInt16LE(Math.round(6000*Math.sin(i/8)),i*2);
return new Response(JSON.stringify({steps:[{type:'model_output',content:[{type:'audio',data:pcm.toString('base64')}]}]}),{status:200});};`,
);
const out = path.join(tmp, "out");
const r = spawnSync(
  process.execPath,
  ["--import", pathToFileURL(mock).href, path.join(ROOT, "tools", "tts-gemini.mjs"), "--voice", "Mock", "--only", "1,2,3", "--out", out],
  { encoding: "utf8", env: { ...process.env, GEMINI_API_KEY: "selftest-dummy" } },
);
const fail = [];
if (r.status !== 0) fail.push(`exit ${r.status}: ${r.stderr}`);
const dj = path.join(out, "Mock", "durations.json");
if (!fs.existsSync(dj)) fail.push("durations.json 없음");
else {
  const d = JSON.parse(fs.readFileSync(dj, "utf8"));
  if (d.sentences.length !== 3) fail.push(`문장 ${d.sentences.length} != 3`);
  if (d.r429 !== 1 || d.requests !== 4) fail.push(`요청 ${d.requests}/429 ${d.r429} (기대 4/1)`);
  const probe = (f, e) => spawnSync("ffprobe", ["-v", "error", "-show_entries", e, "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim();
  const st = probe(path.join(out, "Mock", "01.mp3"), "stream=sample_rate,channels");
  if (st !== "48000,1") fail.push(`mp3 스트림 ${st}`);
  const all = Number(probe(path.join(out, "Mock-all.mp3"), "format=duration"));
  if (Math.abs(all - (3 * 0.5 + 2 * 0.55)) > 0.08) fail.push(`연결본 ${all}s (기대 2.6s)`);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail.length ? `FAIL\n- ${fail.join("\n- ")}` : "PASS tts-gemini selftest (429 재시도·48k mono·연결본 길이)");
process.exit(fail.length ? 1 : 0);
