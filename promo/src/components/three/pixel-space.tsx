import React, { useMemo } from "react";
import * as THREE from "three";

/**
 * three.js 공통 — 「픽셀 공간」 카메라·조명·재질.
 *
 * 🔴 3D 는 실캡처·사진 합성(2D 정합) 위에 3D 카메라를 씌우는 용도가 아니다. 사진 사이의 전환·
 *    등장 연출에만 쓴다(사용자 지시 2026-09-30, memory feedback_promo_use_threejs_tonejs).
 * 🔴 프레임 결정적: 난수·시계 금지. 모든 움직임은 useCurrentFrame 에서 파생한 진행률 0~1 이다.
 *
 * 픽셀 공간 = z=0 평면에서 1 단위 = 캔버스 1px 이 되도록 카메라 거리를 맞춘 원근 카메라.
 * 그래서 위치·크기를 화면 px 로 적을 수 있고, 같은 거리를 CSS `perspective` 에 넣으면
 * DOM(로고 PNG 등)이 three 메시와 똑같이 기운다(CTA 패널에서 사용).
 */
/** 정본 = moments-geometry.ts(게이트가 React 없이 같은 식을 쓰도록 순수 TS 로 옮겼다) */
import { PIXEL_FOV, pixelDistance, seg, lerp } from "./moments-geometry";
export { PIXEL_FOV, pixelDistance, seg, lerp };

/** 캔버스 좌상단 기준 px 좌표 → three 월드 좌표(가운데 원점, y 위) */
export const px = (x: number, y: number, w: number, h: number): [number, number] => [
  x - w / 2,
  h / 2 - y,
];

export const cameraFor = (h: number) => ({
  fov: PIXEL_FOV,
  position: [0, 0, pixelDistance(h)] as [number, number, number],
  near: 10,
  far: pixelDistance(h) * 4,
});

/**
 * 조명 — 실사 톤(부드러운 창가 빛). 🔴 플라스틱 광택 금지: 재질은 전부 roughness ≥0.85,
 * metalness 0 이고, 하이라이트를 만드는 점광원·강한 스펙큘러를 두지 않는다.
 */
export const SoftDaylight: React.FC<{ shadows?: boolean; shadowSize?: number }> = ({
  shadows = false,
  shadowSize = 1400,
}) => (
  <>
    <hemisphereLight args={["#FFFFFF", "#C9D3DF", 1.7]} />
    <directionalLight
      position={[-600, 900, 1400]}
      intensity={1.8}
      castShadow={shadows}
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-camera-left={-shadowSize}
      shadow-camera-right={shadowSize}
      shadow-camera-top={shadowSize}
      shadow-camera-bottom={-shadowSize}
      shadow-camera-near={10}
      shadow-camera-far={6000}
      shadow-radius={14}
      shadow-blurSamples={16}
    />
  </>
);

/** 무광 재질 */
export const matte = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });

/**
 * 캔버스 2D 로 그린 텍스처(결정적). 폰트 글자는 넣지 않는다 — 글꼴 로딩 경합(delayRender)을
 * 피하고, 생성·합성 화면의 「가짜 글자」 규칙과도 맞춘다(선·도형만).
 */
export const useCanvasTexture = (
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  deps: React.DependencyList,
) =>
  useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const g = cv.getContext("2d");
    if (g) draw(g, w, h);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

