import { bookCamera, bookPageScreen, bookPageSize } from "../../geometry";
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

/** 페이지 로컬 크기(측정 블록 ruling.pageWidth/Height) → 펼친 두 쪽 = 가로 2장 */
const [PAGE_W, PAGE_H] = bookPageSize();
/** 종이(펼친 지면) 로컬 크기 — 텍스처 PNG 도 이 비율이다(PageTexture 컴포지션) */
export const SPREAD = { w: PAGE_W * 2, h: PAGE_H };
/** 텍스처 해상도 배수(로컬 1단위 = TEX_SCALE px) */
export const TEX_SCALE = 2;
export const TEXTURE_FILE = "three/guestbook-spread.png";

type Pt = [number, number];
const mapZoom = (p: Pt, origin: Pt, s: number): Pt => [
  origin[0] + s * (p[0] - origin[0]),
  origin[1] + s * (p[1] - origin[1]),
];

/**
 * Paper 앞 컷 **마지막 프레임**(푸시인 최대 배율 = camera.ts zoomEnd, 초점 origin)에서
 * 펼친 지면이 화면에 놓인 사각형(경계상자). 🔴 좌표를 박지 않는다 — prompts.json pages 와
 * bookCamera() 에서 매번 푼다. 왼쪽 페이지는 이때 화면 왼쪽 밖으로 나가 있다(x<0) — 그대로 둔다.
 */
export const spreadRectAtPaperEnd = (): Rect => {
  const cam = bookCamera();
  const pts: Pt[] = [];
  for (const side of ["left", "right"] as const) {
    const q = bookPageScreen(side);
    if (!q) continue;
    for (const k of ["tl", "tr", "br", "bl"] as const) pts.push(mapZoom(q[k] as Pt, cam.origin, cam.zoomTo));
  }
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
  const hw = (SPREAD.w * p.k) / 2;
  const hh = (SPREAD.h * p.k) / 2;
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
const fitWidth = (tilt: number, T: Rect): SheetPose => {
  const p: SheetPose = {
    tilt,
    k: T.w / SPREAD.w,
    x: T.x + T.w / 2 - FRAME_W / 2,
    y: FRAME_H / 2 - (T.y + T.h / 2),
    z: 0,
  };
  for (let i = 0; i < 40; i++) {
    const b = bboxOf(projectSheet(p));
    p.k *= T.w / b.w;
    p.x += T.x + T.w / 2 - (b.x + b.w / 2);
    p.y -= T.y + T.h / 2 - (b.y + b.h / 2);
  }
  return p;
};

/** 화면 경계상자가 목표 rect 와 같아지는 **누운 종이** 자세(기울기 이분 탐색) */
export const solveLyingPose = (T: Rect): SheetPose => {
  let lo = 0;
  let hi = 1.5;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const h = bboxOf(projectSheet(fitWidth(mid, T))).h;
    if (h > T.h) lo = mid;
    else hi = mid;
  }
  return fitWidth((lo + hi) / 2, T);
};

/** rect 를 위로 밀어 아래 변이 limit 이하가 되게 한다(크기는 그대로) */
const liftAbove = (r: Rect, limit: number): Rect =>
  bottomOf(r) > limit ? { ...r, y: r.y - (bottomOf(r) - limit) } : r;

/** 시작 자리 = Paper 끝 지면 사각형. 🔴 자막 띠와 겹치면 크기는 두고 **위로만** 민다(요구 ③) */
export const paperLiftStartRect = (): Rect =>
  liftAbove(spreadRectAtPaperEnd(), paperCaptionBand().y - CAPTION_MARGIN);

/**
 * 끝 자리 = Designer 카드. 종이 비율(SPREAD)을 지킨 채 카드 안에 **꽉 맞춘다(contain)** —
 * 단 카드 아래 변(796)이 Designer 자막 띠 윗변(≈795)과 붙어 있어, 자막 띠 위까지만 쓴다.
 */
export const paperLiftEndRect = (): Rect => {
  const limit = designerCaptionBand().y - CAPTION_MARGIN;
  const box: Rect = { ...CARD_RECT, h: Math.min(CARD_RECT.h, limit - CARD_RECT.y) };
  const aspect = SPREAD.w / SPREAD.h;
  const w = Math.min(box.w, box.h * aspect);
  const h = w / aspect;
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
export const paperLiftState = (f: number): LiftState => {
  const t = Math.min(1, Math.max(0, f / Math.max(1, PAPER_LIFT_FRAMES - 1)));
  const a = easeInOutCubic(seg(t, 0, 0.55));
  const opacity = seg(t, 0, 0.2) * (1 - seg(t, 0.6, 1));
  const w = Math.exp(lerp(Math.log(START_RECT.w), Math.log(END_RECT.w), a));
  const h = Math.exp(lerp(Math.log(START_RECT.h), Math.log(END_RECT.h), a));
  const cx = lerp(START_RECT.x + START_RECT.w / 2, END_RECT.x + END_RECT.w / 2, a);
  const cy = lerp(START_RECT.y + START_RECT.h / 2, END_RECT.y + END_RECT.h / 2, a);
  const limit = liftCaptionBand(f).y - CAPTION_MARGIN;
  const R = liftAbove({ x: cx - w / 2, y: cy - h / 2, w, h }, limit);
  const pose = solveLyingPose(R);
  return { pose, opacity, bbox: bboxOf(projectSheet(pose)) };
};

export const liftCamera = () => ({
  fov: LIFT_FOV,
  position: [0, 0, LIFT_D] as [number, number, number],
  near: 10,
  far: LIFT_D * 4,
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

/**
 * D01 문서 목록 **한 행 높이**를 노트북 화면(이미지 px)으로 옮긴 값.
 * 행 높이 = scene-geometry D01.listRow.pitch(캡처 px) × (화면 사각형 평균 세로 / 자르기 높이).
 * 자르기 = D01.frame(폭 기준) — Manage 가 D01 에 쓰는 것과 같다.
 */
export const d01RowPx = (): number | null => {
  const d01 = (sceneGeometry as { captures: Record<string, CapGeo> }).captures.D01;
  const q = manageQuad();
  if (!d01?.listRow || !q) return null;
  const cropH = d01.frame?.h ?? d01.height;
  const side = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const quadH = (side(q.tl, q.bl) + side(q.tr, q.br)) / 2;
  return (d01.listRow.pitch * quadH) / cropH;
};

/** 카드 높이 = 목록 한 행의 이 배수(요구 1.5 ~ 2배) */
export const DOC_CARD_ROW_MULT = 1.75;
export const DOC_CARD_ASPECT = 3 / 4;
export const docCardSize = () => {
  const row = d01RowPx() ?? 24;
  const h = row * DOC_CARD_ROW_MULT;
  return { w: h * DOC_CARD_ASPECT, h, row };
};

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
      lx + (i - 1) * w * 0.07 + (1 - p) * (i - 1) * w * 0.27,
      ly + i * w * 0.05 + (1 - p) * (box.h * 0.62),
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
