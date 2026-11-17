#!/usr/bin/env node
/**
 * Gemini TTS — v5.1 나레이션 14문장 생성(문장별 프로브 / 전문 1회 제작). 프로젝트 래퍼.
 *
 * 🔴 요청·응답·WAV·429 로직은 공용 SDK `~/.agent-harness/tools/gemini-tts/lib.mjs` 에 있다(단일 구현).
 *    여기에는 v51 문장 매핑·--compare 비교 시트·출력 경로만 둔다. 사용법·한도·약관·함정 = 스킬 `gemini-tts`,
 *    사실·출처 = 볼트 팩 `gemini-tts-pack`. 공용 경로는 AGENT_HARNESS_DIR 로 바꿀 수 있다.
 *
 * 🔴 무료 한도 10회/일 — 제작은 --batch 1회(14문장 전문을 요청 1건으로). 문장별 모드는 문장 수만큼 요청을 쓴다.
 *   --batch 는 429 를 재시도하지 않는다(재시도도 한도를 쓴다). 한도 초기화 후 다시 실행한다.
 *   node tools/tts-gemini.mjs --batch --voice Kore
 *     → public/voice/gemini/v51-full.wav(24kHz) · v51-full.mp3(48kHz mono 192k) · v51-full.meta.json
 *   이후 분할: node tools/voice-import.mjs --map tools/voice-import/v51-gemini.json --plan  (확인) → 실행
 *   본문 = 문장을 빈 줄(줄바꿈 2개)로 이은 순수 대본. 말투는 speech_metadata.style 에만 둔다(--style "" 로 끈다).
 *
 * 사용법 (promo/ 에서)
 *   node tools/tts-gemini.mjs --voice Kore                     문장별(문장 수만큼 요청, 429 백오프 3회)
 *   node tools/tts-gemini.mjs --voice Kore --only 1,3          일부 문장만
 *   node tools/tts-gemini.mjs --voice Kore --api generateContent   구 엔드포인트
 *   node tools/tts-gemini.mjs [--batch] --dry-run              요청 본문만 출력(키 불필요)
 *   node tools/tts-gemini.mjs --compare                        <out>/compare.md 생성(키 불필요, 생성 후 실행)
 *
 * 입력  tools/voice-import/v51-clova.json 의 sentences (--map 으로 교체 가능)
 * 출력  <out>/<voice>/NN.wav (24kHz mono s16le 원본), NN.mp3 (48kHz mono 192k),
 *       <out>/<voice>/durations.json, <out>/<voice>-all.mp3 (문장 0.55초 간격 연결본)
 * 키    환경변수 GEMINI_API_KEY 만. 코드·로그·파일에 값을 쓰지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = process.env.AGENT_HARNESS_DIR ?? "C:/Users/FORCS/.agent-harness";
const tts = await import(pathToFileURL(path.join(HARNESS, "tools", "gemini-tts", "lib.mjs")).href);
export const { buildRequest, extractAudio, pcmToWav } = tts; // 이전 export 호환

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
    batch: false,
    batchDir: path.join(ROOT, "public", "voice", "gemini"),
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
    else if (a === "--batch") o.batch = true;
    else if (a === "--batch-dir") o.batchDir = path.resolve(next());
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  if (!["interactions", "generateContent"].includes(o.api)) throw new Error("--api 는 interactions|generateContent");
  return o;
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


/** 전문 1회 요청 — 문장을 빈 줄로 이어 한 번에 보낸다(429 재시도 없음) */
async function runBatch(o, map, apiKey) {
  fs.mkdirSync(o.batchDir, { recursive: true });
  const base = path.join(o.batchDir, `${map.set}-full`);
  const { wavBuffer, meta } = await tts.synthesize({
    sentences: map.sentences, voice: o.voice, model: o.model, style: o.style, api: o.api, apiKey,
  });
  fs.writeFileSync(base + ".wav", wavBuffer);
  tts.wavToMp3(base + ".wav", base + ".mp3");
  const out = {
    model: meta.model, voice: meta.voice, api: meta.api, style: meta.style,
    requestedAt: meta.requestedAt, responseMime: meta.responseMime, requests: meta.requests,
    inputChars: meta.inputChars, sentences: meta.sentences,
    r429: meta.r429, keyIndex: meta.keyIndex ?? null, keysTotal: meta.keysTotal ?? null,
    wavSec: tts.probeSec(base + ".wav"), mp3Sec: tts.probeSec(base + ".mp3"),
  };
  fs.writeFileSync(base + ".meta.json", JSON.stringify(out, null, 2));
  console.log(`batch: ${out.sentences}문장 ${out.inputChars}자 → ${out.mp3Sec}s, 요청 ${out.requests}, 키 ${out.keyIndex}/${out.keysTotal}`);
  console.log(`  ${path.relative(ROOT, base + ".mp3").replace(/\\/g, "/")}`);
}

function needKey() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY 환경변수가 필요하다");
  return k;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const map = JSON.parse(fs.readFileSync(o.map, "utf8"));
  let sentences = map.sentences;
  if (o.only) sentences = sentences.filter((s) => o.only.includes(s.n));

  if (o.compare) return writeCompare(o, map);

  if (o.dryRun) {
    const req = tts.previewRequest(
      o.batch ? { sentences: map.sentences, voice: o.voice, model: o.model, style: o.style, api: o.api }
              : { text: sentences[0].text, voice: o.voice, model: o.model, style: o.style, api: o.api },
    );
    console.log(req.url);
    console.log(JSON.stringify(req.body, null, 2));
    return;
  }

  if (o.batch) return runBatch(o, map, needKey());

  const apiKey = needKey();
  const dir = path.join(o.out, o.voice);
  fs.mkdirSync(dir, { recursive: true });
  const stats = { requests: 0, r429: 0 };
  const t0 = Date.now();
  const rows = [];
  let stopped = null;

  for (const s of sentences) {
    const nn = String(s.n).padStart(2, "0");
    let res;
    try {
      res = await tts.synthesize({
        text: s.text, voice: o.voice, model: o.model, style: o.style, api: o.api, apiKey, stats, retry429: true,
      });
    } catch (e) {
      stopped = { n: s.n, code: e.code ?? null, message: e.message };
      console.error(`  #${s.n} 중단: ${e.message}`);
      break;
    }
    const wavPath = path.join(dir, `${nn}.wav`);
    const mp3Path = path.join(dir, `${nn}.mp3`);
    fs.writeFileSync(wavPath, res.wavBuffer);
    tts.wavToMp3(wavPath, mp3Path);
    const sec = tts.probeSec(mp3Path);
    rows.push({ n: s.n, scene: s.scene, text: s.text, sec, ms: res.meta.elapsedMs, mime: res.meta.responseMime });
    console.log(`  #${nn} ${sec.toFixed(2)}s  ${s.text}`);
  }

  // 연결본: 문장 사이 gapSec 무음
  let allPath = null;
  if (rows.length) {
    const silence = path.join(dir, "_gap.wav");
    tts.ffmpeg(["-f", "lavfi", "-i", `anullsrc=r=24000:cl=mono`, "-t", String(o.gapSec), "-c:a", "pcm_s16le", silence]);
    const list = path.join(dir, "_concat.txt");
    const lines = [];
    rows.forEach((r, i) => {
      if (i) lines.push(`file '${silence.replace(/\\/g, "/")}'`);
      lines.push(`file '${path.join(dir, `${String(r.n).padStart(2, "0")}.wav`).replace(/\\/g, "/")}'`);
    });
    fs.writeFileSync(list, lines.join("\n"));
    allPath = path.join(o.out, `${o.voice}-all.mp3`);
    tts.ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-ar", "48000", "-ac", "1", "-b:a", "192k", allPath]);
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
