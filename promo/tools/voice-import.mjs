#!/usr/bin/env node
/**
 * 외부 더빙 음성(단일 mp3) → 문장 분할 → 장면별 mp3 + 길이표.
 *
 *   node tools/voice-import.mjs --map tools/voice-import/v51-clova.json
 *   node tools/voice-import.mjs --map <매핑> --plan     분할 경계 표만(파일 안 씀)
 *
 * 왜 있는가(2026-10-13): edge-tts 가 403 으로 막혀 v5.1 나레이션을 네이버 클로바 더빙 「봄달」 단일 mp3 로 받았다.
 * tts.mjs 와 같은 산출 규약(public/voice/<prefix><id>.mp3 · public/voice/<voiceJson> · src/<voiceDurations>)으로 쓰므로
 * 그 뒤 `node tools/scene-durations.mjs --set <set>` 이 그대로 돈다.
 *
 * 분할 규칙
 *   1) silencedetect 를 noise -35~-45dB x d 0.06~0.12s 로 훑어 발화 구간이 정확히 문장 수인 조합을 찾는다.
 *   2) 없으면(클로바는 문장 사이와 쉼표 휴지가 둘 다 ~0.6s 라 구분이 안 된다 — 10-13 실측) 매핑의 detect 값으로
 *      긴 휴지만 잡은 뒤 글자 수 비율 정렬(DP: 문장별 발화 속도 log 편차 제곱합 최소, 문장 안 휴지 수 <= 쉼표 수)로
 *      어느 휴지가 문장 경계인지 정한다.
 *   3) 문장 구간 = 발화 시작 - edgeSec ~ 발화 끝 + edgeSec. 장면 안 문장은 발화-발화 간격 gapSec 로 붙인다.
 * 산출 voice json 의 scenes[id].sentences[].startSec = 장면 mp3 안 발화 시작(초) — animatic-v51-cues.mjs 가 쓴다.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveSet, LEAD_IN, TAIL_OUT, neededSeconds, loadScript } from "./tts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r3 = (x) => Math.round(x * 1000) / 1000;

export function probeSeconds(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return parseFloat(out.trim());
}

export function detectSilences(file, noiseDb, d) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", `silencedetect=noise=${noiseDb}dB:d=${d}`, "-f", "null", "-"], { encoding: "utf8" });
  const out = r.stderr ?? "";
  const starts = [...out.matchAll(/silence_start: ([\d.]+)/g)].map((x) => +x[1]);
  const ends = [...out.matchAll(/silence_end: ([\d.]+)/g)].map((x) => +x[1]);
  return starts.map((s, k) => ({ start: s, end: ends[k] ?? Infinity }));
}

/** 무음 목록 → 발화 구간 [{start,end}] */
export function speechSegments(silences, total) {
  const segs = [];
  let cur = 0;
  for (const s of silences) {
    if (s.start > cur + 1e-3) segs.push({ start: cur, end: s.start });
    cur = Math.min(s.end, total);
  }
  if (total > cur + 0.02) segs.push({ start: cur, end: total });
  return segs.filter((g) => g.end - g.start >= 0.08);
}

const chars = (t) => t.replace(/[\s.,?!]/g, "").length;
const commas = (t) => (t.match(/,/g) ?? []).length;

/** 발화 구간 M개를 문장 N개에 연속 배정(DP). 반환 = 문장별 [첫 구간, 끝 구간] */
export function alignByCharRatio(segs, sentences) {
  const M = segs.length;
  const N = sentences.length;
  const dur = segs.map((g) => g.end - g.start);
  const totC = sentences.reduce((a, s) => a + chars(s.text), 0);
  const totD = dur.reduce((a, b) => a + b, 0);
  const logG = Math.log(totC / totD);
  const INF = 1e18;
  const cost = Array.from({ length: N + 1 }, () => Array(M + 1).fill(INF));
  const prev = Array.from({ length: N + 1 }, () => Array(M + 1).fill(-1));
  cost[0][0] = 0;
  for (let j = 1; j <= N; j++) {
    const c = chars(sentences[j - 1].text);
    const maxSeg = commas(sentences[j - 1].text) + 1;
    for (let m = 1; m <= M; m++) {
      for (let g = 1; g <= maxSeg && g <= m; g++) {
        const k = m - g;
        if (cost[j - 1][k] >= INF) continue;
        let d = 0;
        for (let q = k; q < m; q++) d += dur[q];
        const v = cost[j - 1][k] + (Math.log(c / d) - logG) ** 2;
        if (v < cost[j][m]) {
          cost[j][m] = v;
          prev[j][m] = k;
        }
      }
    }
  }
  if (cost[N][M] >= INF) throw new Error(`글자 비율 정렬 실패: 발화 구간 ${M}개를 문장 ${N}개에 쉼표 제약 안에서 배정할 수 없다`);
  const groups = [];
  for (let j = N, m = M; j > 0; j--) {
    const k = prev[j][m];
    groups.unshift([k, m - 1]);
    m = k;
  }
  return { groups, cost: cost[N][M] };
}

export function split(map, src) {
  const total = probeSeconds(src);
  const N = map.sentences.length;
  // 1) 브리프 범위 스윕 — 정확히 N 구간
  for (const noise of [-35, -38, -40, -42, -45]) {
    for (const d of [0.06, 0.08, 0.1, 0.12]) {
      const segs = speechSegments(detectSilences(src, noise, d), total);
      if (segs.length === N) return { method: `silencedetect noise=${noise}dB d=${d}`, total, segs, groups: segs.map((_, i) => [i, i]) };
    }
  }
  // 2) 긴 휴지 + 글자 비율 정렬
  const { noiseDb, minSilenceSec } = map.detect;
  const segs = speechSegments(detectSilences(src, noiseDb, minSilenceSec), total);
  const { groups, cost } = alignByCharRatio(segs, map.sentences);
  return {
    method: `스윕(-35~-45dB x 0.06~0.12s)에 ${N}구간 조합 없음 → silencedetect noise=${noiseDb}dB d=${minSilenceSec} (발화 ${segs.length}구간) + 글자 비율 정렬(cost ${cost.toFixed(4)})`,
    total,
    segs,
    groups,
  };
}

function encodeScene(src, clips, gapInsert, outFile, o) {
  const parts = [];
  const labels = [];
  clips.forEach((c, i) => {
    parts.push(`[0:a]atrim=start=${c.from.toFixed(4)}:end=${c.to.toFixed(4)},asetpts=PTS-STARTPTS,aresample=${o.sampleRate},aformat=channel_layouts=mono[c${i}]`);
    labels.push(`[c${i}]`);
    if (i < clips.length - 1) {
      parts.push(`anullsrc=r=${o.sampleRate}:cl=mono,atrim=duration=${gapInsert.toFixed(4)}[g${i}]`);
      labels.push(`[g${i}]`);
    }
  });
  parts.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1[out]`);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-filter_complex", parts.join(";"), "-map", "[out]", "-ac", "1", "-ar", String(o.sampleRate), "-b:a", o.bitrate, outFile]);
}

export function run({ mapPath, plan = false }) {
  const map = JSON.parse(fs.readFileSync(path.resolve(ROOT, mapPath), "utf8"));
  const set = resolveSet(map.set);
  const src = path.resolve(ROOT, map.source);
  if (!fs.existsSync(src)) throw new Error(`원본이 없다: ${src}`);
  const sp = split(map, src);
  const edge = map.edgeSec;
  const gap = map.gapSec;
  // 파일 맨 앞·맨 뒤처럼 긴 휴지 검출(d)에 안 걸린 짧은 무음도 깎는다 — 같은 noise, d=0.06
  const fine = detectSilences(src, map.detect.noiseDb, 0.06);
  const sentences = map.sentences.map((s, i) => {
    const [a, b] = sp.groups[i];
    let start = sp.segs[a].start;
    let end = sp.segs[b].end;
    for (const f of fine) {
      if (f.start <= start + 1e-3 && f.end > start && f.end < end) start = f.end;
      if (f.start < end && f.end >= end - 1e-3 && f.start > start) end = f.start;
    }
    return { ...s, speechStart: r3(start), speechEnd: r3(end), speechSec: r3(end - start), innerPauses: b - a, from: Math.max(0, start - edge), to: Math.min(sp.total, end + edge) };
  });
  console.log(`분할: ${sp.method}`);
  console.table(
    sentences.map((s) => ({
      "#": s.n,
      장면: s.scene,
      시작: s.speechStart,
      끝: s.speechEnd,
      길이: s.speechSec,
      문장안휴지: s.innerPauses,
      글자: chars(s.text),
      "글자/초": +(chars(s.text) / s.speechSec).toFixed(2),
    })),
  );
  if (plan) return { sentences, split: sp };

  const order = loadScript(set.array).scenes;
  const outDir = path.join(ROOT, "public", "voice");
  const srcHash = crypto.createHash("sha1").update(fs.readFileSync(src)).digest("hex").slice(0, 12);
  const result = {
    set: set.name,
    voice: map.voice,
    rate: "n/a(외부 더빙)",
    generatedAt: new Date().toISOString(),
    leadIn: LEAD_IN,
    tailOut: TAIL_OUT,
    import: {
      tool: "tools/voice-import.mjs",
      map: path.relative(ROOT, path.resolve(ROOT, mapPath)).replace(/\\/g, "/"),
      source: map.source,
      sourceSha1: srcHash,
      sourceSec: r3(sp.total),
      method: sp.method,
      edgeSec: edge,
      gapSec: gap,
      boundaries: sentences.map((s) => ({ n: s.n, scene: s.scene, start: s.speechStart, end: s.speechEnd, sec: s.speechSec, innerPauses: s.innerPauses })),
    },
    scenes: {},
  };
  const durations = {};
  const warn = [];
  for (const sc of order) {
    const mine = sentences.filter((s) => s.scene === sc.id);
    const storyboardSec = sc.endSec - sc.startSec;
    if (!mine.length) {
      result.scenes[sc.id] = { text: "", seconds: null, storyboardSec, neededSec: null, note: "나레이션 없음" };
      continue;
    }
    const text = mine.map((s) => s.text).join(" ");
    if (text.trim() !== (sc.narration ?? "").trim()) warn.push(`${sc.id}: 매핑 문장 합이 script.ts narration 과 다르다`);
    const file = path.join(outDir, `${set.prefix}${sc.id}.mp3`);
    const insert = Math.max(0, gap - 2 * edge);
    encodeScene(src, mine, insert, file, map.output);
    let off = 0;
    const sents = mine.map((s, i) => {
      const rec = { n: s.n, text: s.text, startSec: r3(off + (s.speechStart - s.from)), speechSec: s.speechSec, sourceStart: s.speechStart, sourceEnd: s.speechEnd };
      off += s.to - s.from + (i < mine.length - 1 ? insert : 0);
      return rec;
    });
    const seconds = r3(probeSeconds(file));
    durations[sc.id] = seconds;
    result.scenes[sc.id] = {
      text,
      hash: crypto.createHash("sha1").update(`${srcHash}::${JSON.stringify(sents)}`).digest("hex").slice(0, 12),
      seconds,
      bytes: fs.statSync(file).size,
      storyboardSec,
      neededSec: neededSeconds(seconds),
      sentences: sents,
    };
  }
  fs.writeFileSync(path.join(outDir, set.voiceJson), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(ROOT, "src", set.voiceDurations), `${JSON.stringify(durations, null, 2)}\n`, "utf8");
  console.table(Object.entries(result.scenes).map(([id, v]) => ({ 장면: id, 음성초: v.seconds, 목표초: v.storyboardSec, 문장: v.sentences?.length ?? 0 })));
  console.log(`총 음성 ${r3(Object.values(durations).reduce((a, b) => a + b, 0))}초`);
  for (const w of warn) console.log(`  WARN ${w}`);
  console.log(`-> public/voice/${set.voiceJson} · src/${set.voiceDurations}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const mapPath = a.includes("--map") ? a[a.indexOf("--map") + 1] : "tools/voice-import/v51-clova.json";
  run({ mapPath, plan: a.includes("--plan") });
}
