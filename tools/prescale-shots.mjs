#!/usr/bin/env node
/**
 * 실캡처를 **기기 화면에 얹히는 크기에 가깝게 미리 줄여** `public/shots/_scaled/` 에 둔다.
 *
 * 왜 필요한가(2026-09-21 v3 레인 D, 사용자 지적 「쭈굴쭈굴하다」)
 *   태블릿 화면 사각형은 렌더 화면에서 **가로 약 345px** 다. 거기에 1920px 캡처를
 *   CSS `matrix3d` 로 **한 번에** 얹으면 브라우저는 밉맵 없이 이중선형 표본화만 한다
 *   (축소율 5.5배). 글자 획과 표 괘선이 표본 사이로 빠지면서 계단·모아레가 생기고,
 *   카메라가 1px 만 움직여도 그 무늬가 프레임마다 바뀌어 화면이 우글거린다.
 *   해결은 **한 번에 줄이지 않는 것**이다: ffmpeg lanczos 로 목표 크기의 1.3~1.5배까지
 *   미리 줄여 두고(면적 평균이 들어간 제대로 된 재표본화), 거기서 조금만 더 줄인다.
 *
 * 목표 크기의 근거(= **화질 예산**이지 기하가 아니다. 틀려도 위치는 안 변하고 선명도만 바뀐다)
 *   세로(태블릿·폰) : 화면 사각형 가로 212px × StagePane 배율 1.55 × 카메라 1.05 ≈ 345px.
 *                    Branch 의 서식 카드는 380px. 자르기가 캡처 가로의 약 0.64 이므로
 *                    필요한 원본 가로 ≈ 1.35 × 380 ÷ 0.64 ≈ 800 → **840px**
 *   가로(노트북)   : 화면 사각형 가로 476px × 카메라 2.0 ≈ 952px. 자르기 비율 0.84 →
 *                    1.35 × 952 ÷ 0.84 ≈ 1530 → **1500px**
 *
 * 🔴 원본은 지우지 않는다. `_scaled/` 는 파생물이고, 캡처를 재촬영하면 이 도구를 다시 돌린다.
 * 🔴 배율은 코드에 박지 않는다 — 결과를 `src/shot-scale.json` 에 쓰고 장면은 그 값을 읽는다
 *    (`shotLayer()`, src/shots-scenes.ts). 파일이 없으면 원본을 그대로 쓴다(배율 1).
 *
 * 쓰는 법
 *   node tools/prescale-shots.mjs            # 없는 것·원본이 더 새것인 것만 다시 만든다
 *   node tools/prescale-shots.mjs --force    # 전부 다시 만든다
 *   node tools/prescale-shots.mjs --print    # 만들지 않고 계획만 출력
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "public/shots");
const OUT_DIR = path.join(SHOTS, "_scaled");
const OUT_JSON = path.join(ROOT, "src/shot-scale.json");
const GEOMETRY = path.join(ROOT, "src/scene-geometry.json");

const args = process.argv.slice(2);
const force = args.includes("--force");
const printOnly = args.includes("--print");

/** 목표 원본 가로(px). 위 주석의 화질 예산에서 나온 값 */
const TARGET_W = { portrait: 840, landscape: 1500 };

const geometry = JSON.parse(fs.readFileSync(GEOMETRY, "utf8"));

/** 줄일 대상 = 기기 화면에 얹히는 캡처 전부(측정값이 있는 것 = 파일이 있다는 증거) */
const targets = new Set();
const SHOT_FILES = {
  A01: "A/A01-designer-form.png",
  B02: "B/B02-empty-form.png",
  B03: "B/B03-filled-form.png",
  B04: "B/B04-send-dialog.png",
  B05: "B/B05-complete.png",
  C01: "C/C01-kiosk-blank.png",
  C01b: "C/C01b-kiosk-blank-active.png",
  C02: "C/C02-kiosk-filled.png",
  C04: "C/C04-thanks.png",
  D01: "D/D01-document-list.png",
  D02: "D/D02-search.png",
  D03: "D/D03-pdf-preview.png",
};
for (const [key, rel] of Object.entries(SHOT_FILES)) {
  if (geometry.captures[key]) targets.add(rel);
}
for (const seq of Object.values(geometry.optional ?? {})) {
  for (const rel of seq?.frames ?? []) targets.add(rel);
}

const probe = (file) => {
  const j = JSON.parse(
    execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "json", file,
    ]).toString(),
  );
  return j.streams[0];
};

const table = {};
let made = 0;
let kept = 0;
let skipped = 0;

for (const rel of [...targets].sort()) {
  const src = path.join(SHOTS, rel);
  if (!fs.existsSync(src)) continue;
  const { width, height } = probe(src);
  const target = width <= height ? TARGET_W.portrait : TARGET_W.landscape;
  if (width <= target) {
    /* 이미 충분히 작다 — 줄이면 오히려 흐려진다 */
    skipped++;
    continue;
  }
  const outW = target;
  const outH = Math.round((height * outW) / width);
  const dst = path.join(OUT_DIR, rel);
  const fresh =
    !force &&
    fs.existsSync(dst) &&
    fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs;

  if (!printOnly && !fresh) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    execFileSync("ffmpeg", [
      "-v", "error", "-y", "-i", src,
      /* lanczos = 축소에서 계단·모아레가 가장 적다. 기본 bicubic 보다 획이 또렷하다 */
      "-vf", `scale=${outW}:${outH}:flags=lanczos`,
      "-frames:v", "1", dst,
    ]);
    made++;
  } else if (fresh) {
    kept++;
  }

  table[rel] = {
    /* 원본 대비 배율. 장면은 좌표를 **원본 캡처 화소**로 두고 이 값만 넘긴다 */
    k: Math.round((outW / width) * 100000) / 100000,
    width: outW,
    height: outH,
    sourceWidth: width,
    sourceHeight: height,
  };
}

const json =
  JSON.stringify(
    {
      $comment:
        "🔴 손으로 고치지 말고 `node tools/prescale-shots.mjs` 로 다시 만든다. 캡처를 재촬영하면 measure-scenes → prescale-shots 순서로 돌린다.",
      scaledAt: new Date().toISOString(),
      targetWidth: TARGET_W,
      method: "ffmpeg scale=flags=lanczos (원본 유지, public/shots/_scaled/ 에 사본)",
      files: table,
    },
    null,
    2,
  ) + "\n";

if (printOnly) {
  console.log(json);
} else {
  fs.writeFileSync(OUT_JSON, json);
  console.log(`기록: ${path.relative(ROOT, OUT_JSON).split(path.sep).join("/")}`);
}
console.log(
  `  새로 만듦 ${made}장 · 그대로 둠 ${kept}장 · 이미 작아서 건너뜀 ${skipped}장 · 표 ${Object.keys(table).length}행`,
);
