/**
 * 레인 H3D(2026-09-30) — Fill·Repeat 손 층의 **3D 자세** 정본(순수 TS: 컴포넌트 HandLayer.tsx 와 게이트
 * tools/check-hand-motion.mjs 가 같은 식을 쓴다).
 *
 * 구조: 실사 손 컷아웃(hand-03.png, 알파 그대로) 한 장을 **휘는 격자 한 장**(분절 평면을 이음매 없이 이은 것)으로
 * 둔다. 손끝→손가락 마디(finger) 구간과 마디→팔(arm) 구간이 서로 다른 기울기로 들리고, 두 구간 사이는
 * 부드럽게 이어진다(조각 평면 사이 틈·겹침이 생기지 않는다).
 *   · z = 사진 평면(태블릿 화면·바탕이 놓인 z=0) 위 높이(사진 px). 카메라 = pixel-space 원근(fov 30°, z=0 에서 1단위=1px).
 *   · 손끝의 **투영점**이 hand.ts poseAt 의 tip(= hand-path 좌표)에 정확히 오도록 손끝 월드 위치를 역산한다(위치 계약 불변).
 *   · 떠 있을수록(lift) 손 전체가 들리고 → 원근으로 조금 커지고 그림자가 멀어지며 흐려진다.
 *   · 닿는 순간 손끝 z=0, 마디는 조금 더 들린다(손가락이 화면을 누르는 각도).
 *   · 옆으로 옮길 때 팔 축을 중심으로 살짝 구른다(roll ≤ 5°).
 *   · 그림자 = 격자 꼭짓점을 빛 방향으로 z=0 에 **투영**한 같은 실루엣. 높이에 비례해 흐려진다(손끝은 또렷, 팔은 흐림).
 * 결정적: 프레임 번호만의 함수.
 */
import { PIXEL_FOV, pixelDistance } from "./components/three/moments-geometry";
import { handTransform, poseAt, type HandKey, type HandLayerSpec, type HandPose, type Pt } from "./hand";

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;
export const CAM_D = pixelDistance(CANVAS_H, PIXEL_FOV);

/** 자세·그림자 매개변수(레인 B: 후보 변형이 같은 식에 다른 값을 넣도록 형을 열었다. 본편 = HAND3D) */
export interface Hand3DParams {
  fingerLen: number; kneeBlend: number; tipLift: number; kneeBase: number; kneeLift: number; press: number;
  armSlope: number; armMax: number; rollPerPx: number; rollMaxDeg: number; light: [number, number, number];
  blur0: number; blurPerZ: number; shadowNear: number; shadowFar: number; step: number;
}

export const HAND3D: Hand3DParams = {
  /** 손끝 → 검지 마디(팔 축 방향 거리, 컷아웃 px) */
  fingerLen: 150,
  /** 마디 앞뒤 기울기 전환 폭 */
  kneeBlend: 40,
  /** 손끝 높이 = lift × tipLift */
  tipLift: 34,
  /** 마디 높이 = kneeBase + kneeLift × lift (+ 누름) */
  kneeBase: 18,
  kneeLift: 36,
  /** 닿을 때 마디가 더 들리는 양(손가락이 눌러 꺾이는 각) */
  press: 7,
  /** 마디 뒤(손등·손목·소매) 오르막 기울기 · 상한 */
  armSlope: 0.085,
  armMax: 96,
  /** 옆 이동 속도(사진 px/프레임) → 구름 각(도/px), 상한 */
  rollPerPx: 0.28,
  rollMaxDeg: 5,
  /** 빛 방향(월드: x 오른쪽, y 위, z 카메라 쪽) — 창(왼쪽 위)에서 빛 → 그림자 오른쪽 아래 */
  light: [-0.26, 0.34, 1] as [number, number, number],
  /** 그림자 흐림 반경 = blur0 + blurPerZ × 높이 (사진 px) */
  blur0: 1.2,
  blurPerZ: 0.2,
  /** 그림자 불투명도(높이 0 → 높이 armMax) */
  shadowNear: 0.36,
  shadowFar: 0.16,
  /** 격자 간격(컷아웃 px) */
  step: 6,
};

export interface Hand3DPose {
  visible: boolean;
  /** 투영된 손끝 = pose.tip */
  tip: Pt;
  lift: number;
  /** 평면 회전(라디안, 사진 좌표 y 아래 기준 — handTransform 과 같은 값) */
  rot: number;
  /** 팔 축 구름(라디안) */
  roll: number;
  zTip: number;
  zKnee: number;
  /** 손끝 월드 위치(사진 좌표 x·y, 높이 z) */
  anchor: [number, number, number];
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** 팔 축(손끝 → 팔꿈치) 단위 벡터, 사진 좌표 */
export const armAxis = (spec: HandLayerSpec): Pt => {
  const vx = spec.pivot[0] - spec.tip[0], vy = spec.pivot[1] - spec.tip[1];
  const n = Math.hypot(vx, vy);
  return [vx / n, vy / n];
};

/** 사진 좌표 점 (x, y, z) → 투영된 사진 좌표 */
export const project = (x: number, y: number, z: number): Pt => {
  const k = CAM_D / (CAM_D - z);
  return [CANVAS_W / 2 + (x - CANVAS_W / 2) * k, CANVAS_H / 2 + (y - CANVAS_H / 2) * k];
};

export const hand3dPose = (spec: HandLayerSpec, keys: HandKey[], frame: number, P: Hand3DParams = HAND3D): Hand3DPose => {
  const pose: HandPose = poseAt(keys, frame);
  const t = handTransform(spec, pose, frame);
  const rot = (t.rotDeg * Math.PI) / 180;
  // 옆 이동 속도(팔 축에 수직 성분) → 구름
  // 속도는 ±6f 삼각 가중 평균(이동 시작·끝에서 구름이 한 프레임에 튀지 않게 — 게이트: 한 프레임 ≤ 1.5°)
  const [ax, ay] = armAxis(spec);
  let vPerp = 0, wSum = 0;
  for (let d = -6; d <= 6; d++) {
    const a = poseAt(keys, frame + d - 0.5).tip, b = poseAt(keys, frame + d + 0.5).tip;
    const wt = 7 - Math.abs(d);
    vPerp += wt * ((b[0] - a[0]) * -ay + (b[1] - a[1]) * ax);
    wSum += wt;
  }
  vPerp /= wSum;
  const roll = (clamp(vPerp * P.rollPerPx, -P.rollMaxDeg, P.rollMaxDeg) * Math.PI) / 180;
  const lift = clamp(pose.lift, 0, 1);
  const zTip = P.tipLift * lift;
  const pressK = clamp(1 - lift / 0.5, 0, 1);
  const zKnee = P.kneeBase + P.kneeLift * lift + P.press * pressK;
  // 투영점 = pose.tip 이 되도록 손끝 월드 위치 역산
  const k = (CAM_D - zTip) / CAM_D;
  const anchor: [number, number, number] = [
    CANVAS_W / 2 + (pose.tip[0] - CANVAS_W / 2) * k,
    CANVAS_H / 2 + (pose.tip[1] - CANVAS_H / 2) * k,
    zTip,
  ];
  return { visible: pose.visible, tip: pose.tip, lift, rot, roll, zTip, zKnee, anchor };
};

/** 팔 축 거리 s(컷아웃 px, 손끝=0) → 높이 */
export const heightAt = (s: number, p: Hand3DPose, P: Hand3DParams = HAND3D): number => {
  const F = P.fingerLen, B = P.kneeBlend;
  const fingerSlope = (p.zKnee - p.zTip) / F;
  const lin1 = p.zTip + fingerSlope * s;
  const lin2 = p.zKnee + P.armSlope * (s - F);
  // 두 직선을 마디 주변 ±B/2 에서 부드럽게 잇는다(3차 블렌드)
  const u = clamp((s - (F - B / 2)) / B, 0, 1);
  const w = u * u * (3 - 2 * u);
  const z = lin1 * (1 - w) + lin2 * w;
  return clamp(z, 0, p.zKnee + P.armMax);
};

/**
 * 컷아웃 텍셀(u, v: 컷아웃 좌상단 기준 px) → 월드 점(사진 좌표 x·y 와 높이 z).
 * 순서: 손끝 기준 상대 위치 → 높이 → 팔 축 구름 → 평면 회전 → 손끝 월드 위치로 이동.
 */
export const texelWorld = (spec: HandLayerSpec, p: Hand3DPose, u: number, v: number, P: Hand3DParams = HAND3D): [number, number, number] => {
  const qx = spec.origin[0] + u - spec.tip[0];
  const qy = spec.origin[1] + v - spec.tip[1];
  const [ax, ay] = armAxis(spec);
  const s = qx * ax + qy * ay; // 축 방향
  const w = -qx * ay + qy * ax; // 축에 수직(평면 안)
  const z0 = heightAt(Math.max(0, s), p, P) - p.zTip; // 손끝 기준 상대 높이
  // 구름: 축 둘레로 (w, z) 회전
  const cr = Math.cos(p.roll), sr = Math.sin(p.roll);
  const w2 = w * cr - z0 * sr;
  const z2 = w * sr + z0 * cr;
  const lx = s * ax - w2 * ay;
  const ly = s * ay + w2 * ax;
  const c = Math.cos(p.rot), sn = Math.sin(p.rot);
  return [p.anchor[0] + c * lx - sn * ly, p.anchor[1] + sn * lx + c * ly, p.anchor[2] + z2];
};

/** 컷아웃 텍셀 → 화면(사진 좌표)에 투영된 점 — 게이트의 표본점 판정용 */
export const projectTexel = (spec: HandLayerSpec, p: Hand3DPose, u: number, v: number): Pt => {
  const [x, y, z] = texelWorld(spec, p, u, v);
  return project(x, y, z);
};

/** 월드 점을 빛 방향으로 z=0 에 떨어뜨린 그림자 점(사진 좌표) */
export const shadowPoint = (x: number, y: number, z: number, P: Hand3DParams = HAND3D): Pt => {
  const [lx, ly, lz] = P.light;
  // 월드 y 위 = 사진 y 아래의 반대. 사진 좌표로: 그림자 = 점 - z·(lx, -ly)/lz
  return [x - (z * lx) / lz, y + (z * ly) / lz];
};

/**
 * 레인 B 판정용 후보 변형(본편 미사용). A = 들림 2배 + 그림자 진하고 멀리 · B = A + 구름 12° + 접촉 눌림 강화 · C = B(+카메라 궤도는 HandLayer/Fill 쪽)
 */
export const HAND3D_VARIANTS: Record<"hA" | "hB" | "hC", Hand3DParams> = (() => {
  const A: Hand3DParams = {
    ...HAND3D,
    tipLift: 68, kneeBase: 30, kneeLift: 76, armSlope: 0.19, armMax: 200,
    light: [-0.5, 0.62, 1], blur0: 1.4, blurPerZ: 0.16, shadowNear: 0.58, shadowFar: 0.34,
  };
  const B: Hand3DParams = { ...A, rollPerPx: 0.6, rollMaxDeg: 12, press: 22 };
  return { hA: A, hB: B, hC: B };
})();
