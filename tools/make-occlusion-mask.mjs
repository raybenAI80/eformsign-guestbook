#!/usr/bin/env node
/**
 * 생성 이미지에서 **기기 화면을 가리는 물체**(손가락·펜)를 오려 낸다.
 *
 * 왜 필요한가: 합성은 「사진 위에 캡처를 얹는」 순서라, 사진에서 화면 **앞**에 있던 손가락이
 * 캡처 층에 덮여 화면 뒤로 들어간다. 사진에서 가리는 물체만 다시 오려 캡처 층 **위**에
 * 한 겹 더 얹으면 앞뒤가 되돌아온다.
 *
 * 어떻게 가려내나: 생성 지시가 화면을 **빈 단색 화면**으로 만들도록 되어 있다
 * (public/gen/prompts.json 의 commonConstraints). 그래서 화면 사각형 **안**에서
 * 그 단색에서 벗어난 화소 = 가리는 물체다. 문턱은 눈대중이 아니라 그 사각형 안의
 * 밝기 분포(중앙값과 MAD)에서 계산한다 — 이미지를 새로 생성하면 따라온다.
 *
 * 🔴 2026-09-21 실측 결과 (판정을 한 번 잘못했다 — 그 오판을 남긴다)
 *    화면 사각형 안은 거의 전부 단색이다. gen-03 에서 그 단색을 벗어난 화소는 **228개,
 *    사각형의 0.28%** 뿐이었다. 그래서 처음에 「0.5% 미만 = 가림 없음」으로 걸렀고,
 *    「합성 문제가 아니라 소재 문제」라는 **틀린 결론**을 낼 뻔했다.
 *    검수 오버레이(out/check/mask-gen-03.png)를 확대해 보니 그 228화소는 티끌이 아니라
 *    **손끝 한 점**이었다 — 사용자가 지적한 바로 그 부분이다.
 *    ⇒ 가림 판정은 **넓이 비율이 아니라 연결 덩어리 크기**로 한다(MIN_BLOB).
 *      태블릿 gen-03·04·05 = 손끝 306~336화소 덩어리(마스크 생성),
 *      gen-02·06(노트북) = 최대 덩어리 15~54화소 = 티끌뿐(마스크 없음, 머리·손이 화면과 안 겹친다).
 *    ⇒ 기계 판정만 믿지 말고 **오버레이를 확대해서 본다**. 축소본으로는 안 보인다.
 *
 * 쓰는 법
 *   node tools/make-occlusion-mask.mjs            # 측정 + 마스크 생성 + 검수 오버레이
 *   node tools/make-occlusion-mask.mjs --print    # 측정만
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GEN = path.join(ROOT, "public/gen");
const MASK_DIR = path.join(GEN, "masks");
const CHECK_DIR = path.join(ROOT, "out/check");
const OUT_JSON = path.join(ROOT, "src/occluders.json");

const printOnly = process.argv.slice(2).includes("--print");

/**
 * 🔴 넓이 비율로 판정하면 안 된다(2026-09-21 실측, 하마터면 놓칠 뻔했다).
 *    gen-03 에서 화면을 가리는 것은 **손끝 한 점 228화소 = 사각형의 0.28%** 다.
 *    「0.5% 미만이면 가림 없음」으로 걸렀더니 그 손끝이 통째로 버려졌다 —
 *    사용자가 지적한 바로 그 부분이다. 판정은 넓이 비율이 아니라
 *    **연결 덩어리 크기**로 한다: 티끌(가장자리 안티에일리어싱)은 흩어져 있고
 *    가리는 물체는 한 덩어리다.
 */
const MIN_BLOB = 60;
/** 화면 사각형을 이만큼 넓혀서 오려 낸다 — 사각형 경계에서 손가락이 얇게 잘리지 않게.
 *  사각형 밖은 원본 사진을 원본 위에 다시 그리는 것이라 보이는 변화가 없다. */
const DILATE = 6;

function decode(file) {
  const probe = JSON.parse(
    execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "json", file,
    ]).toString(),
  );
  const { width, height } = probe.streams[0];
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1 << 30 },
  );
  return { width, height, buf };
}

function encodePng(dst, width, height, rgba) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-v", "error", "-y",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-i", "pipe:0",
      "-frames:v", "1", dst,
    ],
    { input: rgba, maxBuffer: 1 << 30 },
  );
}

/** 다각형 안인가(짝수-홀수 규칙) */
function inPoly(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** 무게중심 기준으로 다각형을 바깥으로 밀어 낸다(대략 `px` 화소만큼) */
function dilatePoly(pts, px) {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return pts.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy) || 1;
    const k = (d + px) / d;
    return [cx + (x - cx) * k, cy + (y - cy) * k];
  });
}

const prompts = JSON.parse(fs.readFileSync(path.join(GEN, "prompts.json"), "utf8"));
const scenes = prompts.scenes.filter((s) => s.screenQuad && s.screenQuad.points?.length === 4);

const report = {};

for (const s of scenes) {
  const name = `gen-0${s.scene}.png`;
  const file = path.join(GEN, name);
  if (!fs.existsSync(file)) continue;
  const { width, height, buf } = decode(file);
  /* screenQuad 는 1920x1080 무대 좌표다. 생성 이미지가 더 크면 배율을 맞춘다 */
  const [qw, qh] = s.screenQuad.size ?? [1920, 1080];
  const sx = width / qw;
  const sy = height / qh;
  const quad = s.screenQuad.points.map(([x, y]) => [x * sx, y * sy]);
  const inner = dilatePoly(quad, -2); // 가장자리 안티에일리어싱 제외하고 분포를 잰다
  const outer = dilatePoly(quad, DILATE * Math.max(sx, sy));

  const xs = outer.map((p) => p[0]);
  const ys = outer.map((p) => p[1]);
  const bx0 = Math.max(0, Math.floor(Math.min(...xs)));
  const bx1 = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const by0 = Math.max(0, Math.floor(Math.min(...ys)));
  const by1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));

  /* 화면 사각형 안의 밝기 분포 — 여기서 문턱이 나온다 */
  const lums = [];
  const sats = [];
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      if (!inPoly(inner, x + 0.5, y + 0.5)) continue;
      const i = (y * width + x) * 3;
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      lums.push(Math.max(r, g, b));
      sats.push(Math.max(r, g, b) - Math.min(r, g, b));
    }
  }
  if (!lums.length) continue;
  lums.sort((a, b) => a - b);
  sats.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  const med = q(lums, 0.5);
  const mad = q(lums.map((l) => Math.abs(l - med)).sort((a, b) => a - b), 0.5);
  /* 빈 화면은 단색이라 MAD 가 0~1 이다 — 문턱이 0 이 되지 않게 바닥을 둔다 */
  const lumTol = Math.max(18, mad * 6);
  const satTol = Math.max(12, q(sats, 0.98) + 8);

  /* 가리는 물체 = 사각형 안에서 그 단색을 벗어난 화소 */
  const W = bx1 - bx0 + 1;
  const H = by1 - by0 + 1;
  const bin = new Uint8Array(W * H);
  let hit = 0;
  let quadPx = 0;
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      if (!inPoly(outer, x + 0.5, y + 0.5)) continue;
      const insideQuad = inPoly(inner, x + 0.5, y + 0.5);
      if (insideQuad) quadPx++;
      const i = (y * width + x) * 3;
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const l = Math.max(r, g, b);
      const sa = l - Math.min(r, g, b);
      const occ = Math.abs(l - med) > lumTol || sa > satTol;
      if (occ) {
        bin[(y - by0) * W + (x - bx0)] = 255;
        if (insideQuad) hit++;
      }
    }
  }
  const coverage = quadPx ? hit / quadPx : 0;

  /* 연결 덩어리로 티끌을 턴다 — 4방향 flood fill */
  let biggest = 0;
  {
    const label = new Int32Array(W * H).fill(-1);
    const stack = [];
    const keep = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (!bin[i] || label[i] !== -1) continue;
      const cells = [];
      stack.push(i);
      label[i] = 1;
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        const cx2 = c % W;
        const cy2 = (c - cx2) / W;
        const nb = [
          cx2 > 0 ? c - 1 : -1,
          cx2 < W - 1 ? c + 1 : -1,
          cy2 > 0 ? c - W : -1,
          cy2 < H - 1 ? c + W : -1,
        ];
        for (const n of nb) {
          if (n < 0 || !bin[n] || label[n] !== -1) continue;
          label[n] = 1;
          stack.push(n);
        }
      }
      if (cells.length > biggest) biggest = cells.length;
      if (cells.length >= MIN_BLOB) for (const c of cells) keep[c] = 255;
    }
    bin.set(keep);
  }

  /* 검수 오버레이 — 판정 근거를 눈으로 본다(사각형 = 초록, 가린다고 본 화소 = 마젠타) */
  if (!printOnly) {
    fs.mkdirSync(CHECK_DIR, { recursive: true });
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      rgba[i * 4] = buf[j];
      rgba[i * 4 + 1] = buf[j + 1];
      rgba[i * 4 + 2] = buf[j + 2];
      rgba[i * 4 + 3] = 255;
    }
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        if (!bin[(y - by0) * W + (x - bx0)]) continue;
        const i = (y * width + x) * 4;
        rgba[i] = 255; rgba[i + 1] = 0; rgba[i + 2] = 255;
      }
    }
    for (let k = 0; k < 4; k++) {
      const [x0, y0] = quad[k];
      const [x1, y1] = quad[(k + 1) % 4];
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let t = 0; t <= steps; t++) {
        const x = Math.round(x0 + ((x1 - x0) * t) / steps);
        const y = Math.round(y0 + ((y1 - y0) * t) / steps);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const px = x + dx, py = y + dy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const i = (py * width + px) * 4;
            rgba[i] = 0; rgba[i + 1] = 255; rgba[i + 2] = 80;
          }
        }
      }
    }
    encodePng(path.join(CHECK_DIR, `mask-gen-0${s.scene}.png`), width, height, rgba);
  }

  let maskFile = null;
  if (biggest >= MIN_BLOB && !printOnly) {
    /* 가장자리 2~3px 깃털 — 이진 마스크를 3x3 평균으로 두 번 문지른다 */
    let alpha = Float32Array.from(bin);
    for (let pass = 0; pass < 2; pass++) {
      const next = new Float32Array(alpha.length);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let sum = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const px = x + dx, py = y + dy;
              if (px < 0 || py < 0 || px >= W || py >= H) continue;
              sum += alpha[py * W + px];
              n++;
            }
          }
          next[y * W + x] = sum / n;
        }
      }
      alpha = next;
    }
    const rgba = Buffer.alloc(width * height * 4); // 기본 알파 0 = 투명
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const a = alpha[(y - by0) * W + (x - bx0)];
        if (a < 2) continue;
        const si = (y * width + x) * 3;
        const di = (y * width + x) * 4;
        rgba[di] = buf[si];
        rgba[di + 1] = buf[si + 1];
        rgba[di + 2] = buf[si + 2];
        rgba[di + 3] = Math.min(255, Math.round(a));
      }
    }
    maskFile = `masks/gen-0${s.scene}-occluder.png`;
    encodePng(path.join(MASK_DIR, path.basename(maskFile)), width, height, rgba);
  }

  report[name] = {
    scene: s.scene,
    width,
    height,
    screenMedianLuma: med,
    lumaMAD: mad,
    lumaTolerance: lumTol,
    satTolerance: satTol,
    quadPixels: quadPx,
    occluderPixels: hit,
    coverage: Math.round(coverage * 100000) / 100000,
    biggestBlob: biggest,
    mask: maskFile,
    note:
      biggest >= MIN_BLOB
        ? "가리는 물체 있음 — 캡처 층 위에 이 마스크를 한 겹 더 얹는다"
        : "화면 사각형 안이 단색 = 가릴 물체 없음(티끌만). 그 컷은 마스크 층이 필요 없다",
  };
  console.log(
    `  ${name} 화면 단색 ${med}(MAD ${mad}) · 가림 ${hit}/${quadPx} = ${(coverage * 100).toFixed(2)}% · 최대 덩어리 ${biggest}px → ${maskFile ?? "마스크 없음"}`,
  );
}

const json =
  JSON.stringify(
    {
      $comment:
        "🔴 손으로 고치지 말고 `node tools/make-occlusion-mask.mjs` 로 다시 만든다. 생성 이미지를 새로 받으면 반드시 재실행.",
      measuredAt: new Date().toISOString(),
      minBlob: MIN_BLOB,
      images: report,
    },
    null,
    2,
  ) + "\n";

if (printOnly) console.log(json);
else {
  fs.writeFileSync(OUT_JSON, json);
  console.log(`기록: ${path.relative(ROOT, OUT_JSON).split(path.sep).join("/")}`);
}
