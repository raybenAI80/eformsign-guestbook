/**
 * 레인 B(2026-09-30) — 3D 확장 후보 판정용 스틸을 1920 원본으로 뽑는다(축소 없음).
 *
 *   node tools/cand-b-stills.mjs base  <outDir>        # Main60 현행(비교 기준) — 후보와 같은 프레임
 *   node tools/cand-b-stills.mjs cand  <outDir>        # CandB 후보별
 *   node tools/cand-b-stills.mjs keep  <outDir>        # 무변경 확인용 Main60 383·414·1238
 *   node tools/cand-b-stills.mjs cand  <outDir> hA,c3  # 일부만
 *
 * 🔴 순차 실행(remotion still 1회 = 번들 캐시 재사용). 동시 실행은 WebGL 컨텍스트 손실 위험(레인 H3D 함정).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** 후보 → 프레임(본편 전역 프레임). 손 후보는 브리프 고정 734·631 */
export const CAND_FRAMES = {
  hA: [734, 631],
  hB: [734, 631],
  hC: [734, 631],
  c2: [631, 734],
  c3: [917, 1511],
  c4: [395, 399],
  c5: [1676, 1745],
  c6: [800],
};
const KEEP = [383, 414, 1238];

const [mode, outDir, only] = process.argv.slice(2);
if (!mode || !outDir) {
  console.error("usage: node tools/cand-b-stills.mjs base|cand|keep <outDir> [ids]");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const jobs = [];
const pad = (n) => String(n).padStart(4, "0");
if (mode === "base") {
  const frames = [...new Set(Object.values(CAND_FRAMES).flat())].sort((a, b) => a - b);
  for (const f of frames) jobs.push({ comp: "Main60", props: null, frame: f, out: path.join(outDir, `base-f${pad(f)}.png`) });
} else if (mode === "keep") {
  for (const f of KEEP) jobs.push({ comp: "Main60", props: null, frame: f, out: path.join(outDir, `keep-f${f}.png`) });
} else if (mode === "cand") {
  const ids = only ? only.split(",") : Object.keys(CAND_FRAMES);
  for (const id of ids)
    for (const f of CAND_FRAMES[id]) jobs.push({ comp: "CandB", props: { cand: id }, frame: f, out: path.join(outDir, `raw-${id}-f${pad(f)}.png`) });
} else {
  console.error("unknown mode", mode);
  process.exit(2);
}
let fail = 0;
for (const j of jobs) {
  const args = ["remotion", "still", j.comp, j.out, `--frame=${j.frame}`, "--timeout=180000", "--image-format=png", "--log=error"];
  // 🔴 shell:true(Windows) 는 인라인 JSON 의 따옴표를 먹는다 → props 는 파일 경로로 넘긴다
  if (j.props) {
    const pf = path.join(outDir, `_props-${j.props.cand}.json`);
    fs.writeFileSync(pf, JSON.stringify(j.props));
    args.push(`--props=${pf}`);
  }
  const t0 = Date.now();
  const r = spawnSync("npx", args, { stdio: ["ignore", "pipe", "pipe"], shell: true, encoding: "utf8" });
  const ok = r.status === 0 && fs.existsSync(j.out);
  if (!ok) fail++;
  console.log(`${ok ? "OK " : "ERR"} ${j.comp} ${j.props ? j.props.cand : "-"} f${j.frame} ${((Date.now() - t0) / 1000).toFixed(1)}s ${ok ? "" : (r.stderr || r.stdout).slice(-600)}`);
}
process.exit(fail ? 1 : 0);
