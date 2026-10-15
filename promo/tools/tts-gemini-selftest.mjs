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
// --batch: 요청 1회 · wav/mp3/meta 생성 · 본문 = 14문장 빈 줄 연결 · 429 는 재시도하지 않는다
const bmock = path.join(tmp, "mock-batch.mjs");
fs.writeFileSync(
  bmock,
  `import fs from "node:fs";globalThis.fetch=async(url,init)=>{fs.appendFileSync(process.env.CALLS_FILE,init.body+String.fromCharCode(10));
const pcm=Buffer.alloc(48000);for(let i=0;i<24000;i++)pcm.writeInt16LE(Math.round(6000*Math.sin(i/8)),i*2);
return new Response(JSON.stringify({steps:[{type:"model_output",content:[{type:"audio",data:pcm.toString("base64")}]}]}),{status:200});};`);
const bdir = path.join(tmp, "batch");
const callsFile = path.join(tmp, "calls.json");
const rb = spawnSync(
  process.execPath,
  ["--import", pathToFileURL(bmock).href, path.join(ROOT, "tools", "tts-gemini.mjs"), "--batch", "--voice", "Mock", "--batch-dir", bdir],
  { encoding: "utf8", env: { ...process.env, GEMINI_API_KEY: "selftest-dummy", CALLS_FILE: callsFile } },
);
if (rb.status !== 0) fail.push(`batch exit ${rb.status}: ${rb.stderr}`);
else {
  const mapJson = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice-import", "v51-clova.json"), "utf8"));
  const wavF = path.join(bdir, "v51-full.wav"), mp3F = path.join(bdir, "v51-full.mp3"), metaF = path.join(bdir, "v51-full.meta.json");
  for (const f of [wavF, mp3F, metaF]) if (!fs.existsSync(f)) fail.push(`batch 산출물 없음: ${path.basename(f)}`);
  if (fs.existsSync(mp3F)) {
    const probe = (f, e) => spawnSync("ffprobe", ["-v", "error", "-show_entries", e, "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim();
    if (probe(mp3F, "stream=sample_rate,channels") !== "48000,1") fail.push("batch mp3 스트림");
    if (probe(wavF, "stream=sample_rate") !== "24000") fail.push("batch wav 24kHz 아님");
  }
  if (fs.existsSync(metaF)) {
    const m = JSON.parse(fs.readFileSync(metaF, "utf8"));
    if (m.requests !== 1 || m.sentences !== mapJson.sentences.length || m.voice !== "Mock") fail.push(`batch meta ${JSON.stringify(m)}`);
  }
  const calls = fs.existsSync(callsFile) ? fs.readFileSync(callsFile, "utf8").split(String.fromCharCode(10)).filter(Boolean) : [];
  if (calls.length !== 1) fail.push(`batch fetch ${calls.length}회 (기대 1)`);
  else {
    const txt = JSON.parse(calls[0]).input[0].content[0].text;
    if (txt !== mapJson.sentences.map((s) => s.text).join("\n\n")) fail.push("batch 본문이 문장 빈 줄 연결과 다르다");
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail.length ? `FAIL\n- ${fail.join("\n- ")}` : "PASS tts-gemini selftest (429 재시도·48k mono·연결본 길이·--batch 1회 요청)");
process.exit(fail.length ? 1 : 0);
