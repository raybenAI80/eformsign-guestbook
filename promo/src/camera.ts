import { bookCamera } from "./geometry";
import { sceneFrames } from "./script";

/**
 * 훅(gen-01 정지)과 Paper 앞 컷(같은 gen-01 푸시인)을 **하나의 카메라 움직임**으로 잇는
 * 배율 곡선의 **단일 정본**.
 *
 * 🔴 왜 이 파일이 따로 있나 (2026-09-21 v3 레인 J)
 *   v3 에서 훅은 1.00 → 1.06, Paper 는 1.42 → 3.657 이었다. 두 장면이 **같은 사진**을
 *   쓰는데 경계에서 배율이 1.06 → 1.42 로 튀어 점프컷으로 보였다. 사용자 지시 =
 *   「연속 줌으로」. 고치는 방법은 훅 끝 배율·초점을 Paper 시작값으로 올리는 것인데,
 *   그 값을 두 파일에 각각 적으면 한쪽만 고쳐져 다시 어긋난다. 그래서 두 장면이 읽는
 *   값과 곡선을 여기 한 곳에 둔다. 배율의 원천은 여전히 `prompts.json ①.geometry.camera`
 *   → `geometry.ts bookCamera()` 다(목표 글자 높이에서 역산). 이 파일은 그 위에
 *   **시간축**만 얹는다.
 *
 * 🔴 곡선은 프레임 수가 아니라 **진행률(0~1)** 로 쓴다. 장면 길이는 나레이션 실측에 따라
 *    바뀌고(script.ts 는 다른 레인 소유) 길이가 바뀌어도 곡선은 그대로 성립해야 한다.
 */

/** 훅의 시작 배율. 1.00 = 변환 없음 = 생성 이미지 원본 구도 */
export const ZOOM_START = 1.0;

/**
 * Paper 앞 컷(종이) 이 장면에서 차지하는 비율. 나머지는 뒷 컷(밤 사무실 노트북).
 * 🔴 Paper.tsx 에 박혀 있던 값을 여기로 올렸다 — 훅이 Paper 의 램프 길이를 알아야
 *    경계 속도를 맞출 수 있기 때문이다(아래 `k`).
 */
export const PAPER_FIRST_CUT_RATIO = 0.55;
/** 푸시인이 앞 컷의 몇 %에서 끝나고 최대 배율로 머무는지 */
export const PAPER_RAMP_RATIO = 0.88;

export const paperFirstCutFrames = (paperFrames: number): number =>
  Math.round(paperFrames * PAPER_FIRST_CUT_RATIO);

export const paperRampFrames = (paperFrames: number): number =>
  Math.max(1, Math.round(paperFirstCutFrames(paperFrames) * PAPER_RAMP_RATIO));

export interface ZoomPlan {
  /** 훅 첫 프레임 배율 */
  zoomStart: number;
  /** 훅 끝 = Paper 첫 프레임 배율 (경계값, 두 장면이 같은 값을 쓴다) */
  zoomHandoff: number;
  /** Paper 램프 끝 배율 */
  zoomEnd: number;
  /** 두 장면이 **공유하는** transform-origin(= 줌 초점). 화면 px */
  origin: [number, number];
  hookFrames: number;
  paperRampFrames: number;
  /** Paper 이징의 시작 기울기(정규화). 훅 끝 속도와 같아지도록 푼 값 */
  k: number;
  /** k 가 단조 상한(3)에 걸렸는지 — 걸리면 경계 속도가 완전히 일치하지 않는다 */
  kClamped: boolean;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * 배율·초점·속도를 한 번에 푼다.
 *
 * 훅:   s_h(u) = z0 + (z1−z0)·u²                     (ease-in, u = 훅 진행률)
 * Paper: s_p(v) = z1 + (z2−z1)·e(v),  e(v)=k·v+(3−2k)·v²+(k−2)·v³
 *                                                     (v = 램프 진행률)
 *
 * e 는 e(0)=0 · e(1)=1 · e′(0)=k · e′(1)=0 인 3차 Hermite 다. 끝 기울기 0 이라
 * 최대 배율에 **부드럽게 안착**해 그대로 머문다(정지 컷으로 읽힌다).
 *
 * 🔴 경계 속도 일치 조건 (프레임당 배율 변화):
 *     훅 끝   s_h′ = (z1−z0)·2/Hf
 *     Paper 시작 s_p′ = (z2−z1)·k/Rf
 *   두 값을 같게 놓으면 k = 2·Rf·(z1−z0) / (Hf·(z2−z1)).
 *   경계에서 배율이 같으므로 절대속도 일치 = 로그속도(체감 줌 속도) 일치다.
 *
 * 🔴 k 는 [0,3] 으로 자른다. k>3 이면 e′ 이 구간 안에서 음수가 되어 줌이 잠깐
 *    **뒤로 간다**. 장면 길이가 크게 재배분되면(훅이 아주 짧아지면) 실제로 걸릴 수
 *    있고, 그때는 kClamped 가 참이 되며 tools/check-zoom-continuity.mjs 가 경고한다.
 */
export const zoomPlan = (hookFrames: number, rampFrames: number): ZoomPlan => {
  const cam = bookCamera();
  const zoomStart = ZOOM_START;
  const zoomHandoff = cam.zoomFrom;
  const zoomEnd = cam.zoomTo;
  const wanted =
    (2 * rampFrames * (zoomHandoff - zoomStart)) /
    Math.max(hookFrames * (zoomEnd - zoomHandoff), 1e-9);
  const k = Math.min(Math.max(wanted, 0), 3);
  return {
    zoomStart,
    zoomHandoff,
    zoomEnd,
    origin: cam.origin,
    hookFrames,
    paperRampFrames: rampFrames,
    k,
    kClamped: Math.abs(k - wanted) > 1e-9,
  };
};

/** 현재 대본 길이에서 푼 계획. 훅·Paper 가 **같은 객체**를 본다 */
export const bookZoomPlan = (): ZoomPlan =>
  zoomPlan(sceneFrames("hook"), paperRampFrames(sceneFrames("paper")));

/* ---------- 이징(정규화) ---------- */

export const hookEase = (u: number): number => u * u;
export const hookEaseSlope = (u: number): number => 2 * u;

export const paperEase = (v: number, k: number): number =>
  k * v + (3 - 2 * k) * v * v + (k - 2) * v * v * v;
export const paperEaseSlope = (v: number, k: number): number =>
  k + 2 * (3 - 2 * k) * v + 3 * (k - 2) * v * v;

/* ---------- 배율(장면 로컬 프레임 → 배율) ---------- */

export const hookScaleAt = (frame: number, p: ZoomPlan): number =>
  p.zoomStart + (p.zoomHandoff - p.zoomStart) * hookEase(clamp01(frame / p.hookFrames));

export const paperScaleAt = (frame: number, p: ZoomPlan): number =>
  p.zoomHandoff +
  (p.zoomEnd - p.zoomHandoff) * paperEase(clamp01(frame / p.paperRampFrames), p.k);

/* ---------- 해석적 속도(프레임당 배율 변화) — 검증용 ---------- */

export const hookScaleSlopeAt = (frame: number, p: ZoomPlan): number =>
  frame < 0 || frame > p.hookFrames
    ? 0
    : ((p.zoomHandoff - p.zoomStart) * hookEaseSlope(clamp01(frame / p.hookFrames))) /
      p.hookFrames;

export const paperScaleSlopeAt = (frame: number, p: ZoomPlan): number =>
  frame < 0 || frame > p.paperRampFrames
    ? 0
    : ((p.zoomEnd - p.zoomHandoff) * paperEaseSlope(clamp01(frame / p.paperRampFrames), p.k)) /
      p.paperRampFrames;
