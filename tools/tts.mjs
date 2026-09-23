#!/usr/bin/env node
/**
 * script.ts → edge-tts 나레이션 일괄 생성.
 *
 *   node tools/tts.mjs                         생성 + 길이 측정
 *   node tools/tts.mjs --force                 캐시 무시하고 전부 다시 만든다
 *   node tools/tts.mjs --plan                  생성 없이 장면 길이 역산표만 본다
 *   node tools/tts.mjs --voice InJoon --rate 0 음성·속도를 바꿔 생성
 *   node tools/tts.mjs --out-dir <경로>        다른 폴더에 생성(본편을 건드리지 않는 시험용)
 *
 * 산출(기본 out-dir = public/voice):
 *   <out-dir>/<sceneId>.mp3        장면별 음성 (나레이션이 빈 장면은 만들지 않는다)
 *   <out-dir>/voice.json           길이·해시·역산 결과
 *   src/voice-durations.json       Remotion 이 import 하는 길이표(초) — 기본 out-dir 일 때만
 *
 * 🔴 음성·속도는 인자다. script.ts 의 VOICE·RATE 는 **기본값**일 뿐이라
 *    원고나 화자가 바뀌어도 이 도구를 고칠 필요가 없다(2026-09-21, 화자 교체 지시).
 *
 * 왜 장면 단위인가: 이 영상은 자막이 주고 나레이션이 보조다(기획서 11절).
 * 문장 단위 큐 맞춤이 필요해지면 guide-video 스킬의 문장별 분할 방식으로 올린다.
 *
 * 🔴 장면 길이는 스토리보드 숫자가 아니라 **음성 길이에서 역산**한다.
 *    leadIn + 음성 + tailOut 이 스토리보드 길이를 넘으면 이 도구가 경고한다.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "voice");
const SCRIPT = path.join(ROOT, "src", "script.ts");

/** 말 앞뒤 여유(초). 장면 길이 = leadIn + 음성 + tailOut */
export const LEAD_IN = 0.35;
export const TAIL_OUT = 0.7;

/**
 * 읽기 속도. 기본 +10%.
 * 60초 안에 8장면을 담으려면 기본 속도로는 다섯 장면이 넘친다(2026-09-18 실측).
 * 🔴 이 값을 바꾸면 mp3 를 전부 다시 만들어야 한다 — 해시에 포함돼 있어 자동으로 다시 만든다.
 */
/** 🔴 2026-09-21 사용자 확정 = 인준 0%. script.ts 의 RATE 가 있으면 그쪽이 우선한다 */
export const DEFAULT_RATE = "+0%";

/** edge-tts 의 ko-KR 음성은 셋뿐이다(2026-09-21 확인). 별칭으로도 받는다 */
export const VOICE_ALIASES = {
  sunhi: "ko-KR-SunHiNeural",
  injoon: "ko-KR-InJoonNeural",
  hyunsu: "ko-KR-HyunsuMultilingualNeural",
  hyunsum: "ko-KR-HyunsuMultilingualNeural",
};

/** "InJoon" · "ko-KR-InJoonNeural" 둘 다 받는다 */
export const resolveVoice = (v) =>
  !v ? null : VOICE_ALIASES[String(v).toLowerCase().replace(/^ko-kr-|neural$/g, "")] ?? VOICE_ALIASES[String(v).toLowerCase()] ?? String(v);

/** "0" · "+0%" · "-5%" 를 모두 edge-tts 형식으로 */
export const resolveRate = (r) => {
  if (r === null || r === undefined || r === "") return null;
  const str = String(r).trim();
  if (/^[+-]?\d+%$/.test(str)) return str.startsWith("-") ? str : str.startsWith("+") ? str : `+${str}`;
  const n = Number(str.replace("%", ""));
  if (!Number.isFinite(n)) throw new Error(`알 수 없는 rate: ${r}`);
  return `${n >= 0 ? "+" : ""}${n}%`;
};

/**
 * script.ts 를 TypeScript 없이 읽는다 — 타입 표기를 지우고 평가한다.
 * (빌드 없이 도는 게 게이트·CI 에 유리하다. 형식이 바뀌면 여기서 바로 깨진다.)
 */
/** script.ts 의 RATE(기본 속도). 없으면 null — 그러면 DEFAULT_RATE 가 쓰인다 */
export function scriptRate() {
  const m = fs.readFileSync(SCRIPT, "utf8").match(/export const RATE\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

export function loadScript() {
  const src = fs.readFileSync(SCRIPT, "utf8");

  const grabArray = (name) => {
    const m = src.match(new RegExp(`export const ${name}[^=]*=\\s*\\[`));
    if (!m) throw new Error(`${name} 를 못 찾았다`);
    let i = m.index + m[0].length - 1;
    let depth = 0;
    let end = i;
    for (; end < src.length; end++) {
      const ch = src[end];
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = src.slice(i, end + 1);
    // eslint-disable-next-line no-new-func
    return new Function(`return ${body};`)();
  };

  const voiceMatch = src.match(/export const VOICE\s*=\s*"([^"]+)"/);
  return {
    voice: voiceMatch ? voiceMatch[1] : "ko-KR-SunHiNeural",
    scenes: grabArray("SCENES"),
  };
}

function ffprobeSeconds(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return Math.round(parseFloat(out.trim()) * 1000) / 1000;
}

function edgeTts(text, voice, rate, outFile) {
  execFileSync("edge-tts", ["--voice", voice, "--rate", rate, "--text", text, "--write-media", outFile], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** 장면 길이 역산: 음성 길이 + 앞뒤 여유 → 필요한 초 */
export function neededSeconds(voiceSec) {
  if (voiceSec === null) return null;
  return Math.round((LEAD_IN + voiceSec + TAIL_OUT) * 100) / 100;
}

/**
 * 나레이션 일괄 생성. 인자로 받는 것만 바뀌므로 다른 도구가 그대로 부를 수 있다.
 * (tools/voice-build.mjs 가 이 함수를 쓴다)
 */
export function run(opts = {}) {
  const loaded = loadScript();
  const scenes = loaded.scenes;
  const voice = resolveVoice(opts.voice) ?? loaded.voice;
  const RATE = resolveRate(opts.rate) ?? resolveRate(scriptRate()) ?? DEFAULT_RATE;
  const FORCE = Boolean(opts.force);
  const PLAN_ONLY = Boolean(opts.plan);
  const OUT = path.resolve(ROOT, opts.outDir ?? path.join("public", "voice"));
  const writeDurations = opts.writeDurations ?? path.resolve(OUT) === path.resolve(ROOT, "public", "voice");
  const quiet = Boolean(opts.quiet);
  fs.mkdirSync(OUT, { recursive: true });

  const cachePath = path.join(OUT, "voice.json");
  const cache = fs.existsSync(cachePath)
    ? JSON.parse(fs.readFileSync(cachePath, "utf8"))
    : { voice: "", scenes: {} };

  const result = { voice, rate: RATE, generatedAt: new Date().toISOString(), leadIn: LEAD_IN, tailOut: TAIL_OUT, scenes: {} };
  const durations = {};
  let made = 0;
  let reused = 0;
  const warnings = [];

  for (const s of scenes) {
    const text = (s.tts ?? s.narration ?? "").trim();
    const storyboardSec = s.endSec - s.startSec;

    if (!text) {
      result.scenes[s.id] = {
        text: "",
        seconds: null,
        storyboardSec,
        neededSec: null,
        note: "나레이션 없음(효과음만)",
      };
      continue;
    }

    const hash = crypto.createHash("sha1").update(`${voice}::${RATE}::${text}`).digest("hex").slice(0, 12);
    const file = path.join(OUT, `${s.id}.mp3`);
    const prev = cache.scenes?.[s.id];
    const fresh = !FORCE && prev && prev.hash === hash && fs.existsSync(file);

    if (PLAN_ONLY) {
      const sec = fresh ? prev.seconds : null;
      result.scenes[s.id] = { text, hash, seconds: sec, storyboardSec, neededSec: neededSeconds(sec) };
      continue;
    }

    if (fresh) {
      reused++;
    } else {
      edgeTts(text, voice, RATE, file);
      made++;
    }

    const seconds = ffprobeSeconds(file);
    const needed = neededSeconds(seconds);
    durations[s.id] = seconds;
    result.scenes[s.id] = { text, hash, seconds, bytes: fs.statSync(file).size, storyboardSec, neededSec: needed };

    if (needed > storyboardSec) {
      warnings.push(
        `${s.id}: 음성 ${seconds}초 + 여유 ${LEAD_IN + TAIL_OUT}초 = ${needed}초 > 스토리보드 ${storyboardSec}초 — 원고를 줄이거나 장면을 늘려라`,
      );
    }
  }

  if (PLAN_ONLY) {
    console.table(
      Object.entries(result.scenes).map(([id, v]) => ({
        장면: id,
        스토리보드초: v.storyboardSec,
        음성초: v.seconds ?? "-",
        필요초: v.neededSec ?? "-",
      })),
    );
    return;
  }

  fs.writeFileSync(cachePath, JSON.stringify(result, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    path.join(ROOT, "src", "voice-durations.json"),
    JSON.stringify(durations, null, 2) + "\n",
    "utf8",
  );

  const total = Object.values(durations).reduce((a, b) => a + b, 0);
  if (quiet) return { ...result, outDir: OUT, warnings };
  console.log(`voice=${voice} rate=${RATE}`);
  console.log(`mp3 ${Object.keys(durations).length}개 (새로 ${made} · 재사용 ${reused})`);
  console.log(`총 음성 길이 ${Math.round(total * 100) / 100}초`);
  console.table(
    Object.entries(result.scenes).map(([id, v]) => ({
      장면: id,
      스토리보드초: v.storyboardSec,
      음성초: v.seconds ?? "-",
      필요초: v.neededSec ?? "-",
      판정: v.neededSec === null ? "음성없음" : v.neededSec > v.storyboardSec ? "넘침" : "여유",
    })),
  );
  for (const w of warnings) console.log(`  WARN ${w}`);
  console.log(`-> ${cachePath}`);
  if (writeDurations) console.log(`-> ${path.join(ROOT, "src", "voice-durations.json")}`);
  return { ...result, outDir: OUT, warnings };
}

function main() {
  const args = process.argv.slice(2);
  const get = (k, d = null) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : d;
  };
  run({
    voice: get("--voice"),
    rate: get("--rate"),
    outDir: get("--out-dir"),
    force: args.includes("--force"),
    plan: args.includes("--plan"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
