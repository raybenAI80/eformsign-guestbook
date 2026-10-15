#!/usr/bin/env node
/**
 * Gemini TTS 프로브 — v5.1 나레이션 14문장을 Gemini TTS 로 문장별 생성해 클로바 「봄달」과 비교한다.
 *
 * 사용법 (promo/ 에서)
 *   node tools/tts-gemini.mjs --voice Kore
 *   node tools/tts-gemini.mjs --voice Aoede --model gemini-3.8-flash-tts --out out/tts-gemini \
 *        --style "차분하고 신뢰감 있는 제품 안내 나레이션, 또박또박, 보통 속도"
 *   node tools/tts-gemini.mjs --voice Kore --only 1,3      일부 문장만
 *   node tools/tts-gemini.mjs --voice Kore --api generateContent   구 엔드포인트로 시도
 *   node tools/tts-gemini.mjs --voice Kore --dry-run       요청 본문만 출력(키 불필요)
 *   node tools/tts-gemini.mjs --compare                    <out>/compare.md 생성(키 불필요, 생성 후 실행)
 *
 * 입력  tools/voice-import/v51-clova.json 의 sentences (--map 으로 교체 가능)
 * 출력  <out>/<voice>/NN.wav (24kHz mono s16le 원본), NN.mp3 (48kHz mono 192k),
 *       <out>/<voice>/durations.json, <out>/<voice>-all.mp3 (14문장 0.55초 간격 연결본)
 *
 * 키    환경변수 GEMINI_API_KEY → GOOGLE_API_KEY 순으로 읽는다. 코드·로그·파일에 값을 쓰지 않는다.
 *
 * 엔드포인트 (2026-10-15 공식 문서 확인, ai.google.dev/gemini-api/docs/speech-generation)
 *   기본 --api interactions : POST /v1beta/interactions
 *     body = { model, input:[{type:"user_input", content:[{type:"text", text,
 *              annotations:[{type:"speech_metadata", style}]}]}],
 *              response_format:{type:"audio"}, generation_config:{speech_config:[{voice}]} }
 *     응답 오디오 = steps[type=model_output].content[type=audio].data (base64, 단건 기본 audio/wav)
 *   --api generateContent : POST /v1beta/models/<model>:generateContent (구 형식, inlineData PCM L16)
 *   문서: 3.8 TTS 는 입력 텍스트를 그대로 읽는다. 말투 지시는 speech_metadata.style 에만 둔다.
 *
 * 한도·가격 (2026-10-15 pricing 페이지)
 *   gemini-3.8-flash-tts 무료 등급 "Free of charge". 유료 입력 $0.50/1M(text), 출력 $9.00/1M(audio),
 *   2027-01-01 부터 $1.00 / $18.00. 무료 RPM·RPD 는 문서에 없고 AI Studio 의 rate-limit 화면에서만 보인다.
 *   429 는 지수 백오프(4s·8s·16s) 3회 후 중단한다. 모델을 바꿔 우회하지 않는다.
 *
 * 약관 요지 (ai.google.dev/gemini-api/terms, 2026-04-28 갱신)
 *   - 무료(Unpaid) 등급: 입력·출력을 Google 이 제품 개선에 쓰고 사람이 검토할 수 있다. 민감·개인정보 금지.
 *   - 유료 등급: 프롬프트·응답을 제품 개선에 쓰지 않는다(위반 탐지용 한시 로그만).
 *   - 생성물 소유권을 Google 이 주장하지 않는다. 18세 이상. EEA·스위스·영국 사용자 대상이면 유료만.
 *   - 영업·홍보 영상 상업 사용 전에 무료/유료 등급 선택과 표기 요건을 사람이 확인한다.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://generativelanguage.googleapis.com/v1beta";

function parseArgs(argv) {
  const o = {
    voice: "Kore",
    model: "gemini-3.8-flash-tts",
    out: path.join(ROOT, "out", "tts-gemini"),
    style: "차분하고 신뢰감 있는 제품 안내 나레이션, 또박또박, 보통 속도",
    map: path.join(ROOT, "tools", "voice-import", "v51-clova.json"),
    api: "interactions",
    only: null,
    gapSec: 0.55,
    dryRun: false,
    compare: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--voice") o.voice = next();
    else if (a === "--model") o.model = next();
    else if (a === "--out") o.out = path.resolve(next());
    else if (a === "--style") o.style = next();
    else if (a === "--map") o.map = path.resolve(next());
    else if (a === "--api") o.api = next();
    else if (a === "--only") o.only = next().split(",").map(Number);
    else if (a === "--gap") o.gapSec = Number(next());
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--compare") o.compare = true;
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  if (!["interactions", "generateContent"].includes(o.api)) throw new Error("--api 는 interactions|generateContent");
  return o;
}

export function buildRequest(api, model, voice, text, style) {
  if (api === "interactions") {
    const content = { type: "text", text };
    if (style) content.annotations = [{ type: "speech_metadata", style }];
    return {
      url: `${BASE}/interactions`,
      body: {
        model,
        input: [{ type: "user_input", content: [content] }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice }] },
      },
    };
  }
  // generateContent: 구 형식은 말투 지시를 본문 앞에 붙인다
  const prompt = style ? `${style}:\n${text}` : text;
  return {
    url: `${BASE}/models/${model}:generateContent`,
    body: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    },
  };
}

/** 응답에서 base64 오디오를 꺼낸다 */
export function extractAudio(api, json) {
  if (api === "interactions") {
    for (const step of json.steps ?? []) {
      if (step.type && step.type !== "model_output") continue;
      for (const c of step.content ?? []) if (c.type === "audio" && c.data) return { b64: c.data, mime: c.mime_type ?? null };
    }
    if (json.output_audio?.data) return { b64: json.output_audio.data, mime: json.output_audio.mime_type ?? null };
    return null;
  }
  for (const cand of json.candidates ?? [])
    for (const p of cand.content?.parts ?? []) if (p.inlineData?.data) return { b64: p.inlineData.data, mime: p.inlineData.mimeType ?? null };
  return null;
}

/** 헤더 없는 s16le PCM 을 WAV 로 감싼다 */
export function pcmToWav(pcm, rate = 24000, ch = 1) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * ch * 2, 28); h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callTts(key, req, stats) {
  for (let attempt = 0; ; attempt++) {
    stats.requests++;
    const r = await fetch(req.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(req.body),
    });
    if (r.status === 429) {
      stats.r429++;
      if (attempt >= 3) throw Object.assign(new Error("429 한도 초과 — 백오프 3회 후 중단"), { code: 429 });
      const wait = 4000 * 2 ** attempt;
      console.error(`  429 → ${wait / 1000}s 대기 (${attempt + 1}/3)`);
      await sleep(wait);
      continue;
    }
    const text = await r.text();
    if (!r.ok) {
      let msg = text.slice(0, 300);
      try {
        let j = JSON.parse(text);
        if (Array.isArray(j)) j = j[0]; // interactions 엔드포인트는 오류를 배열로 감싼다
        const reason = j.error?.details?.find((d) => d.reason)?.reason ?? "";
        msg = `${j.error?.status ?? ""} ${reason} ${j.error?.message ?? ""}`.trim().slice(0, 300);
      } catch {}
      throw Object.assign(new Error(`HTTP ${r.status}: ${msg}`), { code: r.status });
    }
    return JSON.parse(text);
  }
}

function ffmpeg(args) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg 실패: ${r.stderr}`);
}

function probeSec(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(Number(r.stdout.trim()).toFixed(3));
}

/**
 * 비교 시트 — <out>/<voice>/durations.json 전부와 클로바 분할 경계(public/voice/voice-v51.json)를 나란히 둔다.
 * 품질 우열은 판정하지 않는다(사람이 듣고 정한다). 기계 신호는 길이 이상치·check-voice 진단만.
 */
async function writeCompare(o, map) {
  const { diagnose } = await import("./check-voice.mjs");
  const clovaMeta = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "voice", "voice-v51.json"), "utf8"));
  const clova = new Map((clovaMeta.import?.boundaries ?? []).map((b) => [b.n, b.sec]));
  const voices = fs.existsSync(o.out)
    ? fs.readdirSync(o.out).filter((d) => fs.existsSync(path.join(o.out, d, "durations.json")))
    : [];
  if (!voices.length) throw new Error(`${o.out} 에 durations.json 이 없다 — 먼저 생성한다`);
  const data = voices.map((v) => JSON.parse(fs.readFileSync(path.join(o.out, v, "durations.json"), "utf8")));
  const L = [];
  L.push(`# Gemini TTS 비교 시트 (v5.1 14문장)`, ``);
  L.push(`생성: ${new Date().toISOString()} · 판정 없음 — 연결본을 들어 보고 사용자가 고른다.`, ``);
  L.push(`## 들어 볼 파일`, ``);
  L.push(`- 클로바 「봄달」 원본: \`${map.source}\``);
  for (const d of data) if (d.allMp3) L.push(`- ${d.voice}: \`${d.allMp3}\` (문장 사이 ${o.gapSec}s)`);
  L.push(``, `## 음성별 요약`, ``);
  L.push(`| 음성 | 모델 | 문장 | 총 길이(s) | 클로바 합(s) | 생성 소요(s) | 요청 | 429 | 중단 |`);
  L.push(`|---|---|---|---|---|---|---|---|---|`);
  const clovaSum = [...clova.values()].reduce((a, b) => a + b, 0);
  for (const d of data)
    L.push(`| ${d.voice} | ${d.model} | ${d.sentences.length} | ${d.totalSec} | ${clovaSum.toFixed(3)} | ${d.elapsedSec} | ${d.requests} | ${d.r429} | ${d.stopped ? d.stopped.message : "-"} |`);
  L.push(``, `## 문장별 길이(s) — 클로바 대비 0.7배 미만·1.3배 초과는 ⚠`, ``);
  L.push(`| # | 장면 | 문장 | 클로바 | ${data.map((d) => d.voice).join(" | ")} |`);
  L.push(`|---|---|---|---|${data.map(() => "---").join("|")}|`);
  const flags = [];
  for (const s of map.sentences) {
    const c = clova.get(s.n);
    const cells = data.map((d) => {
      const r = d.sentences.find((x) => x.n === s.n);
      if (!r) return "-";
      const ratio = c ? r.sec / c : null;
      const odd = ratio !== null && (ratio < 0.7 || ratio > 1.3);
      if (odd) flags.push(`${d.voice} #${s.n}: ${r.sec}s (클로바 ${c}s, ${ratio.toFixed(2)}배)`);
      return `${r.sec}${odd ? " ⚠" : ""}`;
    });
    L.push(`| ${s.n} | ${s.scene} | ${s.text} | ${c ?? "-"} | ${cells.join(" | ")} |`);
  }
  L.push(``, `## 기계 진단 (tools/check-voice.mjs diagnose, 문장 mp3 단위)`, ``);
  L.push(`발음 오류는 기계로 못 잰다. 아래는 여백·문장 내 긴 휴지(>0.8s)·피크와 길이 이상치뿐이다.`, ``);
  for (const d of data) {
    const issues = [];
    for (const r of d.sentences) {
      const f = path.join(o.out, d.voice, `${String(r.n).padStart(2, "0")}.mp3`);
      if (!fs.existsSync(f)) continue;
      const dg = diagnose(f);
      for (const i of dg.issues) issues.push(`#${r.n} ${i}`);
    }
    L.push(`- **${d.voice}**: ${issues.length ? issues.join(" / ") : "이상 없음"}`);
  }
  L.push(``, `### 길이 이상치`, ``, flags.length ? flags.map((f) => `- ${f}`).join("\n") : "- 없음");
  L.push(``, `### 귀로 확인할 단어`, ``, `- 「이폼사인」(#3·#13·#14) · 「방명록」(#1·#3·#4·#12) · 「옮겨 적는」(#2·#11)`);
  const out = path.join(o.out, "compare.md");
  fs.writeFileSync(out, L.join("\n") + "\n");
  console.log(`compare: ${out} (${voices.join(", ")})`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const map = JSON.parse(fs.readFileSync(o.map, "utf8"));
  let sentences = map.sentences;
  if (o.only) sentences = sentences.filter((s) => o.only.includes(s.n));

  if (o.compare) return writeCompare(o, map);

  if (o.dryRun) {
    const req = buildRequest(o.api, o.model, o.voice, sentences[0].text, o.style);
    console.log(req.url);
    console.log(JSON.stringify(req.body, null, 2));
    return;
  }

  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 또는 GOOGLE_API_KEY 환경변수가 필요하다");

  const dir = path.join(o.out, o.voice);
  fs.mkdirSync(dir, { recursive: true });
  const stats = { requests: 0, r429: 0 };
  const t0 = Date.now();
  const rows = [];
  let stopped = null;

  for (const s of sentences) {
    const nn = String(s.n).padStart(2, "0");
    const req = buildRequest(o.api, o.model, o.voice, s.text, o.style);
    const t = Date.now();
    let json;
    try {
      json = await callTts(key, req, stats);
    } catch (e) {
      stopped = { n: s.n, code: e.code ?? null, message: e.message };
      console.error(`  #${s.n} 중단: ${e.message}`);
      break;
    }
    const audio = extractAudio(o.api, json);
    if (!audio) { stopped = { n: s.n, code: null, message: "응답에 오디오 없음" }; console.error(`  #${s.n} 응답에 오디오 없음`); break; }
    const buf = Buffer.from(audio.b64, "base64");
    const wav = buf.subarray(0, 4).toString("ascii") === "RIFF" ? buf : pcmToWav(buf);
    const wavPath = path.join(dir, `${nn}.wav`);
    const mp3Path = path.join(dir, `${nn}.mp3`);
    fs.writeFileSync(wavPath, wav);
    ffmpeg(["-i", wavPath, "-ar", "48000", "-ac", "1", "-b:a", "192k", mp3Path]);
    const sec = probeSec(mp3Path);
    rows.push({ n: s.n, scene: s.scene, text: s.text, sec, ms: Date.now() - t, mime: audio.mime });
    console.log(`  #${nn} ${sec.toFixed(2)}s  ${s.text}`);
  }

  // 연결본: 문장 사이 gapSec 무음
  let allPath = null;
  if (rows.length) {
    const silence = path.join(dir, "_gap.wav");
    ffmpeg(["-f", "lavfi", "-i", `anullsrc=r=24000:cl=mono`, "-t", String(o.gapSec), "-c:a", "pcm_s16le", silence]);
    const list = path.join(dir, "_concat.txt");
    const lines = [];
    rows.forEach((r, i) => {
      if (i) lines.push(`file '${silence.replace(/\\/g, "/")}'`);
      lines.push(`file '${path.join(dir, `${String(r.n).padStart(2, "0")}.wav`).replace(/\\/g, "/")}'`);
    });
    fs.writeFileSync(list, lines.join("\n"));
    allPath = path.join(o.out, `${o.voice}-all.mp3`);
    ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-ar", "48000", "-ac", "1", "-b:a", "192k", allPath]);
    fs.rmSync(list); fs.rmSync(silence);
  }

  const result = {
    voice: o.voice, model: o.model, api: o.api, style: o.style,
    generatedAt: new Date().toISOString(),
    elapsedSec: Number(((Date.now() - t0) / 1000).toFixed(1)),
    requests: stats.requests, r429: stats.r429, stopped,
    totalSec: Number(rows.reduce((a, r) => a + r.sec, 0).toFixed(3)),
    allMp3: allPath ? path.relative(ROOT, allPath).replace(/\\/g, "/") : null,
    sentences: rows,
  };
  fs.writeFileSync(path.join(dir, "durations.json"), JSON.stringify(result, null, 2));
  console.log(`${o.voice}: ${rows.length}/${sentences.length}문장, 합 ${result.totalSec}s, 요청 ${stats.requests}, 429 ${stats.r429}, ${result.elapsedSec}s`);
  if (stopped) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
