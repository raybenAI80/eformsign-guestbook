import { bookCamera, bookPageScreen, bookPageSize, bookWriterSide } from "../../geometry";
import { padRect, rectToAspect } from "../../shots-scenes";
import { scene } from "../../script";
import sceneGeometry from "../../scene-geometry.json";
import promptsJson from "../../../public/gen/prompts.json";

/**
 * v3.3 three.js 연출의 **기하 정본(순수 TS, React·three 없음)**.
 *
 * 🔴 왜 따로 있나 (2026-09-30 레인 T2): 연출 자리·크기를 장면 코드에 숫자로 박으면
 *    ① 자막을 가리거나(레인 T 1차: 종이가 화면 대부분을 덮어 자막을 가렸다)
 *    ② 화면 사각형 밖에 떨어져도(카드가 노트북보다 컸다) 아무 게이트도 못 잡는다.
 *    그래서 **자리·크기·궤적을 측정값에서 파생하는 함수**를 여기 한 곳에 두고,
 *    렌더(Moments3D.tsx)와 게이트(tools/check-three-moments.mjs)가 같은 함수를 부른다.
 *    Node 타입 스트리핑으로 게이트가 직접 import 하므로 이 파일엔 JSX·React·three 금지.
 */

export const FRAME_W = 1920;
export const FRAME_H = 1080;

/* ────────────────────────── 픽셀 공간 카메라 ────────────────────────── */

export const PIXEL_FOV = 30;

/** 캔버스 높이 h(px) 일 때 z=0 평면이 1단위=1px 이 되는 카메라 거리 */
export const pixelDistance = (h: number, fov = PIXEL_FOV) =>
  h / 2 / Math.tan(((fov / 2) * Math.PI) / 180);

export const seg = (t: number, a: number, b: number) =>
  Math.min(1, Math.max(0, (t - a) / (b - a)));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** remotion Easing.inOut(Easing.cubic) 와 같은 식(게이트가 remotion 없이 돌도록 여기 직접 둔다) */
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export type Rect = { x: number; y: number; w: number; h: number };
const bottomOf = (r: Rect) => r.y + r.h;

/* ────────────────────────── 자막 자리 ────────────────────────── */

/**
 * 자막 묶음 높이 — `components/Caption.tsx` 조판과 **같은 식**이다
 * (lineHeight 1.24 · 줄 간격 round(size × 0.16)). 게이트가 Caption.tsx 에서 두 상수를 읽어 대조한다.
 */
export const captionStackHeight = (lines: number, size: number) =>
  lines * size * 1.24 + Math.max(0, lines - 1) * Math.round(size * 0.16);

/** Paper 자막: AbsoluteFill paddingBottom 120 · Caption size 84 (Paper.tsx 가 이 값을 쓴다) */
export const PAPER_CAPTION = { size: 84, bottom: 120 } as const;
/** Designer 자막: CaptionBar(bottom 110 고정) size 66 */
export const DESIGNER_CAPTION = { size: 66, bottom: 110 } as const;

/** 자막 띠(전폭으로 넓게 잡는다 — 글자 폭을 재지 않아도 보수적으로 안전) */
export const captionBand = (lines: number, c: { size: number; bottom: number }): Rect => {
  const h = captionStackHeight(lines, c.size);
  return { x: 0, y: FRAME_H - c.bottom - h, w: FRAME_W, h };
};

/** 그림자·등장 흔들림 여유 */
export const CAPTION_MARGIN = 14;

export const paperCaptionBand = () => captionBand(scene("paper").captions.length, PAPER_CAPTION);
export const designerCaptionBand = () =>
  captionBand(scene("designer").captions.length, DESIGNER_CAPTION);

/* ────────────────────────── Designer 카드 ────────────────────────── */

/** 카드 = 화면 가운데 큰 판. 자막이 앉을 아래쪽을 비워 둔다 */
export const CARD = { width: 1640, height: 760, top: 36 };
export const CARD_RECT: Rect = { x: (FRAME_W - CARD.width) / 2, y: CARD.top, w: CARD.width, h: CARD.height };

/* ────────────────────────── ① Paper → Designer 종이 ────────────────────────── */

/** 전환 길이(0.6초). 경계 앞 절반은 Paper, 뒤 절반은 Designer 가 각자 **자막 아래** 층에 넣는다 */
export const PAPER_LIFT_FRAMES = 18;

/**
 * 종이 전환 캔버스의 시야각. 🔴 사진 속 지면은 거의 평행 투영이다(위 변 2556px / 아래 변 2764px,
 * 비 1.08). 기본 30° 카메라로 눕히면 앞 변이 뒷 변의 두 배가 넘는 사다리꼴이 되어 「누운 종이」가
 * 아니라 「덮쳐 오는 판」으로 보인다 → 좁은 시야(먼 카메라)로 원근을 약하게 한다. 연출값.
 */
export const LIFT_FOV = 10;
const LIFT_D = pixelDistance(FRAME_H, LIFT_FOV);

/**
 * 🔴 레인 T3(2026-09-30): 종이 = **읽는 쪽 한 페이지만**(펼친 두 쪽 폐기 — T2 는 두 쪽 + 손·펜이 섞여
 *    화면 2/3 를 덮었다). 크기 = 페이지 로컬(ruling.pageWidth × pageHeight), 세로 종이.
 */
const [PAGE_W, PAGE_H] = bookPageSize();
export const SHEET = { w: PAGE_W, h: PAGE_H };
/** 텍스처 해상도 배수(로컬 1단위 = TEX_SCALE px) */
export const TEX_SCALE = 2;
/** tools/make-page-texture.mjs 가 굽는다(정방향 · 손/펜 영역 제거) */
export const TEXTURE_FILE = "three/guestbook-page.png";

/**
 * 읽는 쪽 = 펜이 놓인 쪽(writerSide, 지금 써지는 쪽)의 **반대 쪽** — 이미 여러 줄이 채워진 쪽이다.
 * Paper 앞 컷 끝 푸시인이 비추는 쪽이기도 하다(4차 gen-01: writer=left → 읽는 쪽=right).
 */
export const readSide = (): "left" | "right" => (bookWriterSide() === "left" ? "right" : "left");

/** 종이는 어느 프레임에서도 화면 높이의 이 비율을 넘지 않는다(레인 T3 요구 — T2 는 2/3) */
export const SHEET_MAX_H = Math.floor(FRAME_H * 0.4);

type Pt = [number, number];
const mapZoom = (p: Pt, origin: Pt, s: number): Pt => [
  origin[0] + s * (p[0] - origin[0]),
  origin[1] + s * (p[1] - origin[1]),
];

/**
 * Paper 앞 컷 **마지막 프레임**(푸시인 최대 배율 = camera.ts zoomEnd, 초점 origin)에서
 * 읽는 쪽 페이지가 화면에 놓인 사각형(경계상자). 🔴 좌표를 박지 않는다 — prompts.json pages 와
 * bookCamera() 에서 매번 푼다.
 */
export const pageRectAtPaperEnd = (): Rect => {
  const cam = bookCamera();
  const q = bookPageScreen(readSide());
  const pts: Pt[] = q
    ? (["tl", "tr", "br", "bl"] as const).map((k) => mapZoom(q[k] as Pt, cam.origin, cam.zoomTo))
    : [[0, 0], [FRAME_W, FRAME_H]];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

/** three 월드 자세. 위치는 픽셀 공간(가운데 원점·y 위), 회전 = [-tilt, 0, 0] (윗변이 멀어진다) */
export interface SheetPose {
  tilt: number;
  /** 로컬 1단위당 월드 px */
  k: number;
  x: number;
  y: number;
  z: number;
}

/** 종이 네 꼭짓점의 화면 좌표(px, 좌상 원점) */
export const projectSheet = (p: SheetPose, D = LIFT_D): Pt[] => {
  const hw = (SHEET.w * p.k) / 2;
  const hh = (SHEET.h * p.k) / 2;
  const c = Math.cos(p.tilt);
  const s = Math.sin(p.tilt);
  return ([
    [-hw, hh],
    [hw, hh],
    [hw, -hh],
    [-hw, -hh],
  ] as Pt[]).map(([u, v]) => {
    const X = p.x + u;
    const Y = p.y + v * c;
    const Z = p.z - v * s;
    const m = D / (D - Z);
    return [FRAME_W / 2 + X * m, FRAME_H / 2 - Y * m] as Pt;
  });
};

export const bboxOf = (pts: Pt[]): Rect => {
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

/** 기울기 tilt 에서 화면 경계상자가 목표 rect 의 폭·중심과 맞도록 k·x·y 를 푼다 */
const fitWidth = (tilt: number, T: Rect, D = LIFT_D): SheetPose => {
  const p: SheetPose = {
    tilt,
    k: T.w / SHEET.w,
    x: T.x + T.w / 2 - FRAME_W / 2,
    y: FRAME_H / 2 - (T.y + T.h / 2),
    z: 0,
  };
  for (let i = 0; i < 40; i++) {
    const b = bboxOf(projectSheet(p, D));
    p.k *= T.w / b.w;
    p.x += T.x + T.w / 2 - (b.x + b.w / 2);
    p.y -= T.y + T.h / 2 - (b.y + b.h / 2);
  }
  return p;
};

/** 화면 경계상자가 목표 rect 와 같아지는 **누운 종이** 자세(기울기 이분 탐색) */
export const solveLyingPose = (T: Rect, D = LIFT_D): SheetPose => {
  let lo = 0;
  let hi = 1.5;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const h = bboxOf(projectSheet(fitWidth(mid, T, D), D)).h;
    if (h > T.h) lo = mid;
    else hi = mid;
  }
  return fitWidth((lo + hi) / 2, T, D);
};

/** rect 를 위로 밀어 아래 변이 limit 이하가 되게 한다(크기는 그대로) */
const liftAbove = (r: Rect, limit: number): Rect =>
  bottomOf(r) > limit ? { ...r, y: r.y - (bottomOf(r) - limit) } : r;

/** rect 를 중심 고정으로 줄여 높이가 maxH 이하가 되게 한다(비율 유지) */
const capHeight = (r: Rect, maxH: number): Rect => {
  if (r.h <= maxH) return r;
  const s = maxH / r.h;
  const w = r.w * s;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - maxH) / 2, w, h: maxH };
};

/**
 * 시작 자리 = Paper 끝에서 읽는 쪽 페이지가 놓였던 사각형을 **중심 고정으로 높이 40% 이하**까지 줄이고,
 * 자막 띠와 겹치면 **위로만** 민다(레인 T3 요구 ③ · 높이 40%).
 */
export const paperLiftStartRect = (): Rect =>
  liftAbove(capHeight(pageRectAtPaperEnd(), SHEET_MAX_H), paperCaptionBand().y - CAPTION_MARGIN);

/**
 * Designer A01 캡처 안의 **서식 페이지(세로 종이)** — 편집 화면 가운데 흰 지면의 파란 좌우 테두리와
 * 도구 막대 아래 변(캡처 px). 측정 = A01-designer-form.png 열 스캔(파랑 b>180·r<150 이 세로 950px 이상
 * 이어지는 열 x=433·1627) · 도구 막대 아래 y=156. 🔴 A01 을 다시 캡처하면 다시 잰다.
 */
export const A01_FORM_PAGE: Rect = { x: 433, y: 156, w: 1627 - 433, h: 1350 - 156 };

/**
 * Designer **첫 프레임**에 A01 서식 페이지가 화면에 놓인 사각형(카드로 잘림).
 * Designer.tsx 와 같은 식: crop = rectToAspect(padRect(fieldsArea, 420), 카드 비율) ·
 * CaptureBox 는 폭 기준 배율 k = CARD.width / crop.w, 원점 = CARD_RECT 좌상.
 */
export const designerFormPageRect = (): Rect => {
  const a01 = (sceneGeometry as { captures: Record<string, CapGeo & { fieldsArea?: Rect; fields?: Rect[] }> })
    .captures.A01;
  const area = a01?.fieldsArea ?? a01?.fields?.[0];
  if (!a01 || !area) return { ...CARD_RECT };
  const crop = rectToAspect(padRect(area, 420, a01), CARD.width / CARD.height, a01);
  const k = CARD.width / crop.w;
  const x0 = CARD_RECT.x + (A01_FORM_PAGE.x - crop.x) * k;
  const y0 = CARD_RECT.y + (A01_FORM_PAGE.y - crop.y) * k;
  const x1 = CARD_RECT.x + (A01_FORM_PAGE.x + A01_FORM_PAGE.w - crop.x) * k;
  const y1 = CARD_RECT.y + (A01_FORM_PAGE.y + A01_FORM_PAGE.h - crop.y) * k;
  /* 카드 밖은 보이지 않는다 */
  const cx0 = Math.max(x0, CARD_RECT.x);
  const cy0 = Math.max(y0, CARD_RECT.y);
  const cx1 = Math.min(x1, CARD_RECT.x + CARD_RECT.w);
  const cy1 = Math.min(y1, CARD_RECT.y + CARD_RECT.h);
  return { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 };
};

/**
 * 끝 자리 = Designer 카드 안 **서식 페이지(세로 종이) 위**. 종이 비율(SHEET, 세로)을 지킨 채
 * 서식 페이지 보이는 부분 ∩ 자막 띠 위 영역에 맞추되 높이는 SHEET_MAX_H 이하, 가운데 정렬.
 */
export const paperLiftEndRect = (): Rect => {
  const page = designerFormPageRect();
  const limit = designerCaptionBand().y - CAPTION_MARGIN;
  const box: Rect = { ...page, h: Math.min(page.h, limit - page.y) };
  const aspect = SHEET.w / SHEET.h;
  const h = Math.min(SHEET_MAX_H, box.h * 0.92, (box.w * 0.92) / aspect);
  const w = h * aspect;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
};

const START_RECT = paperLiftStartRect();
const END_RECT = paperLiftEndRect();

/** 전환 f 번째 프레임(0 ~ PAPER_LIFT_FRAMES-1)이 어느 장면 위인가 → 그 장면의 자막 띠 */
export const liftCaptionBand = (f: number) =>
  f < PAPER_LIFT_FRAMES / 2 ? paperCaptionBand() : designerCaptionBand();

export interface LiftState {
  pose: SheetPose;
  opacity: number;
  /** 화면 경계상자(px) */
  bbox: Rect;
}

/**
 * 전환 f 번째 프레임의 종이 상태. 진행률 0 ~ 0.55 들려 서며 축소·이동, 0.6 ~ 1 사라짐.
 *
 * 🔴 자세(기울기·크기)를 따로 보간하지 않는다 — 그러면 기울기가 풀리는 속도가 축소보다 빨라
 *    중간 프레임에서 종이가 시작보다 **커진다**(1차 구현 실측 f5 1581x936). 대신 **화면 경계상자**를
 *    시작 사각형 → 카드 사각형으로 보간(크기는 로그, 중심은 선형)하고, 매 프레임 그 상자에 맞는
 *    누운 자세를 다시 푼다(solveLyingPose). 비율이 평평한 종이 비율에 닿으면 기울기 0 = 곧게 선다.
 * 🔴 마지막에 자막 띠 위로 강제한다(겹치면 크기는 두고 위로 민다) — 요구 ③ 전 프레임 교집합 0.
 */
/** 전환 f 번째 프레임의 목표 화면 사각형과 불투명도(paperLiftState·paperDepthPose 공통) */
export const liftTarget = (f: number): { R: Rect; opacity: number } => {
  const t = Math.min(1, Math.max(0, f / Math.max(1, PAPER_LIFT_FRAMES - 1)));
  const a = easeInOutCubic(seg(t, 0, 0.55));
  const opacity = seg(t, 0, 0.2) * (1 - seg(t, 0.6, 1));
  const w = Math.exp(lerp(Math.log(START_RECT.w), Math.log(END_RECT.w), a));
  const h = Math.exp(lerp(Math.log(START_RECT.h), Math.log(END_RECT.h), a));
  const cx = lerp(START_RECT.x + START_RECT.w / 2, END_RECT.x + END_RECT.w / 2, a);
  const cy = lerp(START_RECT.y + START_RECT.h / 2, END_RECT.y + END_RECT.h / 2, a);
  const limit = liftCaptionBand(f).y - CAPTION_MARGIN;
  const R = liftAbove({ x: cx - w / 2, y: cy - h / 2, w, h }, limit);
  return { R, opacity };
};

export const paperLiftState = (f: number): LiftState => {
  const { R, opacity } = liftTarget(f);
  const pose = solveLyingPose(R);
  return { pose, opacity, bbox: bboxOf(projectSheet(pose)) };
};

export const liftCamera = () => ({
  fov: LIFT_FOV,
  position: [0, 0, LIFT_D] as [number, number, number],
  near: 10,
  far: LIFT_D * 4,
});

/* ── v3.5(2026-09-30 사용자 확정 후보 4): 종이 전환 깊이 강화 — 본편 기본 ──
 * 같은 풀이 자세(paperLiftState) 위에 가운데서 부푸는 추가 회전(앞으로 들림·옆으로 틂)·앞당김 +
 * 강한 원근(fov 22) + 두꺼운 종이(7). 🔴 Moments3D 가 이 식을 그대로 쓰고, check-three-moments 가
 * 이 식의 **실제 화면 투영**(fov 22, 8 꼭짓점)으로 자막 겹침·정방향·높이 상한을 잰다(식 이중화 금지).
 * 레인 B 에서 컴포넌트 안에 인라인이던 값을 그대로 옮겼다(값 불변).
 */
export const DEPTH_FOV = 22;
export const DEPTH_D = pixelDistance(FRAME_H, DEPTH_FOV);
export const DEPTH_SLAB = 7;
export const DEPTH_BUMP = { z: 150, rx: 0.32, ry: 0.5, rz: 0.07 } as const;

export interface DepthPose {
  /** 그룹 위치(픽셀 월드, 가운데 원점·y 위) */
  position: [number, number, number];
  /** three.js Euler XYZ(라디안) */
  rotation: [number, number, number];
  w: number;
  h: number;
  depth: number;
}

/**
 * 🔴 v3.5 개정(레인 T3 규칙 유지): 레인 B 후보 4 는 fov 10 에서 푼 자세를 fov 22 로 그려 화면 그림이
 *    풀이 사각형과 어긋났다(f1~f3 자막 띠 침범 최대 10867px² · 높이 최대 499px > 40%). 그래서
 *    ① 누운 자세를 **깊이 카메라(DEPTH_D)로** 다시 풀고(부풂 0 인 첫·끝 프레임 = 풀이 사각형 그대로)
 *    ② 부풂(회전·앞당김)을 얹은 뒤 ③ 실제 투영이 높이 ≤ SHEET_MAX_H · 자막 띠 위가 되도록 크기만 줄이고 위로만 민다.
 *    부풂 값(DEPTH_BUMP)·시야각·두께는 후보 그대로다.
 */
export const paperDepthPose = (f: number): DepthPose => {
  const { R } = liftTarget(f);
  const base = solveLyingPose(R, DEPTH_D);
  const t = Math.min(1, Math.max(0, f / Math.max(1, PAPER_LIFT_FRAMES - 1)));
  const b = Math.sin(Math.PI * t);
  const p: DepthPose = {
    position: [base.x, base.y, base.z + DEPTH_BUMP.z * b],
    rotation: [-base.tilt - DEPTH_BUMP.rx * b, DEPTH_BUMP.ry * b, -DEPTH_BUMP.rz * b],
    w: SHEET.w * base.k,
    h: SHEET.h * base.k,
    depth: DEPTH_SLAB,
  };
  const limit = liftCaptionBand(f).y - CAPTION_MARGIN;
  for (let i = 0; i < 24; i++) {
    const g = depthGeomOf(p);
    const s = Math.min(1, (SHEET_MAX_H - 0.25) / g.bbox.h);
    const over = g.bbox.y + g.bbox.h - (limit - 0.25);
    if (s >= 1 && over <= 0) break;
    if (s < 1) {
      p.w *= s;
      p.h *= s;
    }
    if (over > 0) p.position[1] += over / (DEPTH_D / (DEPTH_D - p.position[2]));
  }
  return p;
};

/** three.js Euler 'XYZ' 회전: v' = Rx · Ry · Rz · v */
const rotXYZ = ([x, y, z]: [number, number, number], [a, b, c]: [number, number, number]): [number, number, number] => {
  // Rz
  let X = x * Math.cos(c) - y * Math.sin(c);
  let Y = x * Math.sin(c) + y * Math.cos(c);
  let Z = z;
  // Ry
  const X2 = X * Math.cos(b) + Z * Math.sin(b);
  const Z2 = -X * Math.sin(b) + Z * Math.cos(b);
  X = X2; Z = Z2;
  // Rx
  const Y3 = Y * Math.cos(a) - Z * Math.sin(a);
  const Z3 = Y * Math.sin(a) + Z * Math.cos(a);
  return [X, Y3, Z3];
};

const projectDepth = ([X, Y, Z]: [number, number, number]): Pt => {
  const m = DEPTH_D / (DEPTH_D - Z);
  return [FRAME_W / 2 + X * m, FRAME_H / 2 - Y * m];
};

export interface DepthGeom {
  /** 앞면 네 꼭짓점 화면 좌표 tl,tr,br,bl (종이 로컬 위 = +y) */
  face: Pt[];
  /** 두께 포함 8 꼭짓점 화면 경계상자 */
  bbox: Rect;
  /** 앞면 법선의 카메라 쪽 성분(> 0 = 앞면이 보인다 = 뒤집힘 없음) */
  facing: number;
}

export const paperDepthGeom = (f: number): DepthGeom => depthGeomOf(paperDepthPose(f));

const depthGeomOf = (p: DepthPose): DepthGeom => {
  const hw = p.w / 2, hh = p.h / 2, hd = p.depth / 2;
  const toWorld = (u: number, v: number, d: number): [number, number, number] => {
    const r = rotXYZ([u, v, d], p.rotation);
    return [r[0] + p.position[0], r[1] + p.position[1], r[2] + p.position[2]];
  };
  const face = ([[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]] as Pt[]).map(([u, v]) => projectDepth(toWorld(u, v, hd)));
  const all: Pt[] = [];
  for (const d of [-hd, hd]) for (const [u, v] of [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]] as Pt[]) all.push(projectDepth(toWorld(u, v, d)));
  const n = rotXYZ([0, 0, 1], p.rotation);
  // 카메라(0,0,D) 에서 앞면 중심으로 향하는 시선과 법선의 내적 → 앞면이 카메라를 향하면 양수
  const c = toWorld(0, 0, hd);
  const vx = -c[0], vy = -c[1], vz = DEPTH_D - c[2];
  const L = Math.hypot(vx, vy, vz);
  return { face, bbox: bboxOf(all), facing: (n[0] * vx + n[1] * vy + n[2] * vz) / L };
};

export const depthCamera = () => ({
  fov: DEPTH_FOV,
  position: [0, 0, DEPTH_D] as [number, number, number],
  near: 10,
  far: DEPTH_D * 4,
});

/* ────────────────────────── ② Manage 도입 문서 카드 ────────────────────────── */

type Quad4 = { tl: Pt; tr: Pt; br: Pt; bl: Pt };
interface CapGeo {
  width: number;
  height: number;
  frame?: Rect | null;
  listRow?: { pitch: number } | null;
}

/** 노트북 화면 네 점(prompts.json scene 6 screenQuad, 이미지 px) */
export const manageQuad = (): Quad4 | null => {
  const q = (promptsJson as { scenes: { scene: number; screenQuad?: { points: number[][] } }[] }).scenes.find(
    (s) => s.scene === 6,
  )?.screenQuad;
  if (!q || q.points.length !== 4) return null;
  const [tl, tr, br, bl] = q.points as Pt[];
  return { tl, tr, br, bl };
};

/** 노트북 화면 사각형(= D01 이 붙는 자리)의 평균 세로 길이(이미지 px) */
export const manageQuadHeight = (): number | null => {
  const q = manageQuad();
  if (!q) return null;
  const side = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return (side(q.tl, q.bl) + side(q.tr, q.br)) / 2;
};

/**
 * 카드 높이 = D01 화면 사각형 높이의 이 비율. 🔴 레인 T3(2026-09-30): T2 의 「목록 한 행 1.75배」(≈43px)는
 * 점처럼 보여 불통과 → 행 pitch 기준 폐기, 화면 사각형 높이의 25%.
 */
export const DOC_CARD_OF_SCREEN = 0.25;
export const DOC_CARD_ASPECT = 3 / 4;
export const docCardSize = () => {
  const screenH = manageQuadHeight() ?? 300;
  const h = screenH * DOC_CARD_OF_SCREEN;
  return { w: h * DOC_CARD_ASPECT, h, screenH };
};

/** 착지한 카드 가로 간격 = 카드 폭의 이 배수 → 이웃 카드와 (1 - 이 값) 만큼 **살짝 겹친다** */
export const DOC_CARD_STEP = 0.74;

/** 도입 길이·카드 간격 */
export const DOC_INTRO_FRAMES = 30;
const DOC_STAGGER = 0.22;
const DOC_FALL = 0.5;
/** 카드 i 가 착지(낙하 진행률 1)하는 첫 프레임 */
export const docLandFrame = (i: number) => {
  for (let f = 0; f < DOC_INTRO_FRAMES; f++) {
    const prog = f / (DOC_INTRO_FRAMES - 1);
    if (seg(prog, i * DOC_STAGGER, i * DOC_STAGGER + DOC_FALL) >= 1) return f;
  }
  return DOC_INTRO_FRAMES - 1;
};

/**
 * 카드 i 의 자세(캔버스 box 안 픽셀 공간). p = 낙하 진행률 0~1(이징 적용 후).
 * 착지 흩어짐·낙하 시작 오프셋은 **카드 폭의 비율**이다(크기가 바뀌어도 모양이 같다).
 */
export const docCardPose = (i: number, p: number, land: Pt, box: Rect) => {
  const { w } = docCardSize();
  const lx = land[0] - box.x - box.w / 2;
  const ly = box.h / 2 - (land[1] - box.y);
  return {
    position: [
      lx + (i - 1) * w * DOC_CARD_STEP + (1 - p) * (i - 1) * w * 0.27,
      ly + (i === 1 ? w * 0.06 : 0) + (1 - p) * (box.h * 0.62),
      6 + i * 4 + (1 - p) * 90,
    ] as [number, number, number],
    rotation: [
      (1 - p) * 0.55,
      (1 - p) * (i - 1) * 0.25,
      [-0.07, 0.05, -0.015][i] + (1 - p) * (0.25 - i * 0.2),
    ] as [number, number, number],
  };
};

/** 착지한 카드 i 의 네 꼭짓점 → 이미지 px (게이트용: 화면 사각형 안인가) */
export const docCardLandedCorners = (i: number, land: Pt, box: Rect): Pt[] => {
  const { w, h } = docCardSize();
  const { position, rotation } = docCardPose(i, 1, land, box);
  const D = pixelDistance(box.h);
  const rz = rotation[2];
  return ([
    [-w / 2, h / 2],
    [w / 2, h / 2],
    [w / 2, -h / 2],
    [-w / 2, -h / 2],
  ] as Pt[]).map(([u, v]) => {
    const X = position[0] + u * Math.cos(rz) - v * Math.sin(rz);
    const Y = position[1] + u * Math.sin(rz) + v * Math.cos(rz);
    const m = D / (D - position[2]);
    return [box.x + box.w / 2 + X * m, box.y + box.h / 2 - Y * m] as Pt;
  });
};

export const pointInQuad = (p: Pt, q: Quad4): boolean => {
  const poly = [q.tl, q.tr, q.br, q.bl];
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % 4];
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cr === 0) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
};

/** 카드 낙하 캔버스 자리(이미지 px) — 사진 카메라 줌을 같이 받는다(Photo children) */
export const DOC_BOX: Rect = { x: 700, y: 180, w: 720, h: 640 };
