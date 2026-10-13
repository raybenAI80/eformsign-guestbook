/**
 * 홍보 영상 속도(페이싱) 게이트 — 「정신없다」 시청자 의견을 수치로 판정한다.
 *
 * 사용: node tools/check-pacing.mjs --durations src/scene-durations.json \
 *        --manifest tools/pacing/main60-v4.1.json [--json out.json] [--warn-only]
 * exit 0 = 위반 0 (또는 --warn-only), 1 = 위반 있음, 2 = 입력 오류
 *
 * 규칙: P1 장면>=6.0s · P2 평균>=8.0s · P3 컷<=2 · P4 컷>=3.0s · P5 첫 장면 외 hard 금지·전환>=0.4s
 *       P6 장면 끝-나레이션 끝>=0.4s · P7 textBlocks<=1·captionLines<=2 · P8 장면 id 집합 일치
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LIMITS = { sceneMin: 6.0, avgMin: 8.0, maxCuts: 2, cutMin: 3.0, transMin: 0.4, breath: 0.4, maxText: 1, maxCaption: 2 };
const EPS = 1e-6;
const round = (n) => Math.round(n * 1000) / 1000;

export function checkPacing(durations, manifest) {
  const v = [];
  const add = (code, scene, detail) => v.push({ code, scene, detail });
  const dScenes = durations?.scenes;
  if (!dScenes || typeof dScenes !== "object" || !Array.isArray(manifest?.scenes)) {
    throw new Error("durations.scenes 객체와 manifest.scenes 배열이 필요하다");
  }
  const lead = durations.leadSec ?? 0;
  const dIds = Object.keys(dScenes);
  const mIds = manifest.scenes.map((s) => s.id);

  // P8
  for (const id of dIds) if (!mIds.includes(id)) add("P8", id, "매니페스트에 누락된 장면");
  for (const id of mIds) if (!dIds.includes(id)) add("P8", id, "durations 에 없는 초과 장면");

  let total = 0;
  let n = 0;
  manifest.scenes.forEach((m, idx) => {
    const d = dScenes[m.id];
    if (!d) return;
    const sec = d.seconds;
    total += sec;
    n++;
    if (sec < LIMITS.sceneMin - EPS) add("P1", m.id, `장면 길이 ${sec}s < ${LIMITS.sceneMin}s`);

    const cuts = [...new Set([0, ...(m.cuts ?? [0])])].sort((a, b) => a - b);
    if (cuts.length > LIMITS.maxCuts) add("P3", m.id, `컷 ${cuts.length}개 > ${LIMITS.maxCuts}개`);
    cuts.forEach((c, i) => {
      const len = (i + 1 < cuts.length ? cuts[i + 1] : sec) - c;
      if (len < LIMITS.cutMin - EPS) add("P4", m.id, `컷 ${i + 1}(시작 ${c}s) 길이 ${round(len)}s < ${LIMITS.cutMin}s`);
    });

    if (idx > 0) {
      const tr = m.transitionIn;
      const ts = m.transitionSec ?? 0;
      if (tr === "hard") add("P5", m.id, "첫 장면 외 hard 전환");
      else if (ts < LIMITS.transMin - EPS) add("P5", m.id, `전환 ${ts}s < ${LIMITS.transMin}s (${tr})`);
    }

    const nEnd = m.narrationEndSec ?? (d.narrationSec ?? 0) + lead;
    const breath = sec - nEnd;
    if (breath < LIMITS.breath - EPS) add("P6", m.id, `숨 ${round(breath)}s < ${LIMITS.breath}s (나레이션 끝 ${round(nEnd)}s / 장면 ${sec}s)`);

    if ((m.textBlocks ?? 0) > LIMITS.maxText) add("P7", m.id, `textBlocks ${m.textBlocks} > ${LIMITS.maxText}`);
    if ((m.captionLines ?? 0) > LIMITS.maxCaption) add("P7", m.id, `captionLines ${m.captionLines} > ${LIMITS.maxCaption}`);
  });

  const avg = n ? total / n : 0;
  if (n && avg < LIMITS.avgMin - EPS) add("P2", "*", `평균 장면 길이 ${round(avg)}s < ${LIMITS.avgMin}s`);
  return { ok: v.length === 0, totalSec: round(total), avgSceneSec: round(avg), violations: v };
}

function main() {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const dp = get("--durations"), mp = get("--manifest"), out = get("--json");
  const warnOnly = a.includes("--warn-only");
  let result;
  try {
    if (!dp || !mp) throw new Error("--durations 와 --manifest 가 필요하다");
    result = checkPacing(JSON.parse(fs.readFileSync(dp, "utf8")), JSON.parse(fs.readFileSync(mp, "utf8")));
  } catch (e) {
    console.error(`[check-pacing] 입력 오류: ${e.message}`);
    process.exit(2);
  }
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
  }
  console.log(`[check-pacing] ${result.ok ? "PASS" : "FAIL"} — 총 ${result.totalSec}s · 평균 ${result.avgSceneSec}s · 위반 ${result.violations.length}건`);
  for (const x of result.violations) console.log(`  ${x.code} ${x.scene}: ${x.detail}`);
  process.exit(result.ok || warnOnly ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
