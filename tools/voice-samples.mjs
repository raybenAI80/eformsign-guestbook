#!/usr/bin/env node
/**
 * 음성 후보 샘플 생성기 — 사용자가 **귀로 골라야 하는 것**을 한 파일로 모은다.
 *
 *   node tools/voice-samples.mjs        (🔴 PowerShell 에서 실행 — edge-tts 가 네트워크를 쓴다)
 *
 * 산출:
 *   out/check/voice-samples/<voice>-<rate>-<문장>.mp3   개별 샘플
 *   out/check/voice-samples-all.mp3                     앞에 0.5초 무음을 두고 이어 붙인 비교용
 *   out/check/voice-samples.md                          순서·파일명 표
 *
 * 🔴 public/voice/*.mp3 를 덮어쓰지 않는다. 본편 음성 교체는 사용자가 고른 뒤에 한다.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { postProcess } from "./voice-post.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out", "check", "voice-samples");
const ALL = path.join(ROOT, "out", "check", "voice-samples-all.mp3");

/** ko-KR 음성은 edge-tts 목록에 셋뿐이다(2026-09-21 확인) — 남 2 · 여 1 */
const VOICES = [
  { id: "ko-KR-SunHiNeural", label: "선히(여) — 현재 본편 음성" },
  { id: "ko-KR-InJoonNeural", label: "인준(남)" },
  { id: "ko-KR-HyunsuMultilingualNeural", label: "현수(남·다국어)" },
];
const RATES = ["+0%", "+10%"];

/** 훅 자리(첫 나레이션)와 CTA — 영상의 처음과 끝 */
const LINES = [
  { key: "a", label: "도입", text: "방문자 기록, 동의서, 접수표. 아직 종이에 적고 계세요?" },
  { key: "b", label: "CTA", text: "이폼사인 닷컴, 지금 시작해 보세요" },
];

const slug = (v) => v.replace(/^ko-KR-/, "").replace(/Neural$/, "").replace(/Multilingual$/, "M");
const rslug = (r) => r.replace(/[+%]/g, "") || "0";

function tts(text, voice, rate, outFile) {
  execFileSync("edge-tts", ["--voice", voice, "--rate", rate, "--text", text, "--write-media", outFile], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = [];

  for (const line of LINES) {
    for (const v of VOICES) {
      for (const r of RATES) {
        const name = `${line.key}-${slug(v.id)}-${rslug(r)}.mp3`;
        const file = path.join(OUT, name);
        tts(line.text, v.id, r, file);
        rows.push({ name, file, 문장: line.label, 음성: v.label, 속도: r, 후처리: "원본" });
      }
    }
    // 현재 음성·속도에 **휴지 줄이기 후처리만** 적용한 판 — 「안내방송 같다」의 기계적 원인 제거본
    const base = path.join(OUT, `${line.key}-SunHi-10.mp3`);
    const fixed = path.join(OUT, `${line.key}-SunHi-10-fix.mp3`);
    postProcess(base, fixed);
    rows.push({
      name: path.basename(fixed),
      file: fixed,
      문장: line.label,
      음성: "선히(여) — 현재 음성",
      속도: "+10%",
      후처리: "문장 휴지 0.35초 · -16 LUFS",
    });
  }

  // 이어 붙이기: 각 샘플 앞에 0.5초 무음
  const listFile = path.join(OUT, "concat.txt");
  const silence = path.join(OUT, "_sil.mp3");
  execFileSync("ffmpeg", [
    "-hide_banner", "-nostdin", "-y",
    "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
    "-t", "0.5", "-b:a", "48k", silence,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const lines = [];
  for (const r of rows) {
    lines.push(`file '${silence.replace(/\\/g, "/")}'`);
    lines.push(`file '${r.file.replace(/\\/g, "/")}'`);
  }
  fs.writeFileSync(listFile, lines.join("\n") + "\n", "utf8");
  const cat = spawnSync("ffmpeg", [
    "-hide_banner", "-nostdin", "-y",
    "-f", "concat", "-safe", "0", "-i", listFile,
    "-ar", "24000", "-b:a", "96k", ALL,
  ], { encoding: "utf8" });
  if (cat.status !== 0) throw new Error(`concat 실패: ${(cat.stderr ?? "").slice(-600)}`);

  const md = [
    "# 음성 후보 샘플",
    "",
    "`out/check/voice-samples-all.mp3` 를 처음부터 들으면 아래 순서로 나온다(샘플 사이 0.5초 무음).",
    "",
    "| # | 문장 | 음성 | 속도 | 후처리 | 파일 |",
    "|---|---|---|---|---|---|",
    ...rows.map((r, i) => `| ${i + 1} | ${r.문장} | ${r.음성} | ${r.속도} | ${r.후처리} | \`${r.name}\` |`),
    "",
    "현재 본편 = 선히(여) · +10% · 후처리 없음.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(ROOT, "out", "check", "voice-samples.md"), md, "utf8");

  console.log(`샘플 ${rows.length}개 -> ${OUT}`);
  console.log(`-> ${ALL}`);
}

main();
