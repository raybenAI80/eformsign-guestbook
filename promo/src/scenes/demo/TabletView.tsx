import React from "react";
import { Photo } from "../../components/Photo";
import { QuadShot, StagePane } from "../../components/ShotView";
import { HandLayer } from "../../components/HandLayer";
import { squareToQuad, type HandKey, type Pt } from "../../hand";
import { quadAspect, screenCrop, screenQuad, shotLayer, type Rect } from "../../shots-scenes";
import { DEMO_PLATE, type ReadyShot } from "../../demo-shots";
import type { Corners } from "../../components/ScreenComposite";

/**
 * 실제 화면 편의 기기 화면 — 홍보편 기기 바탕(gen-03-plate, 손 없는 바탕)의 screenQuad 에
 * 실캡처를 원근 매핑하고, 그 위에 손 층(hand-03)을 얹는다. 홍보편 Fill 과 **같은 부품**
 * (Photo · StagePane · QuadShot · HandLayer)만 쓴다 — 자르기·손 좌표가 한 함수(tabletCrop)를 공유.
 */
/**
 * 🔴 BLEED — 측정 screenQuad 를 무게중심 기준으로 이만큼 넓힌다(demo 전용, 본편 Fill 은 1.0 그대로).
 *    홍보편 배율(1.55)에서는 안 보이던 「화면 사각형과 베젤 사이 회색 띠」(바탕 사진의 빈 화면 회색)가
 *    훅 배율(2.55)에서 위·왼쪽 가장자리에 3px(사진 좌표) 남짓 드러났다(2026-10-03 스틸 200% 크롭).
 */
const BLEED = 1.022;
const grow = (c: Corners | null): Corners | null => {
  if (!c) return null;
  const cx = (c.tl[0] + c.tr[0] + c.br[0] + c.bl[0]) / 4;
  const cy = (c.tl[1] + c.tr[1] + c.br[1] + c.bl[1]) / 4;
  const g = (p: [number, number]): [number, number] => [cx + (p[0] - cx) * BLEED, cy + (p[1] - cy) * BLEED];
  return { tl: g(c.tl), tr: g(c.tr), br: g(c.br), bl: g(c.bl) };
};
const QUAD = grow(screenQuad(DEMO_PLATE.screenQuadScene));

export const tabletQuad = (): Corners => {
  if (!QUAD) throw new Error(`[Demo53] 기기 바탕 screenQuad(scene ${DEMO_PLATE.screenQuadScene})가 public/gen/prompts.json 에 없다`);
  return QUAD;
};
export const tabletAspect = () => quadAspect(tabletQuad());

const capOf = (s: ReadyShot) => ({ width: s.width, height: s.height, viewport: s.viewport });

/**
 * 🔴 캡처 비 허용 오차 — 캡처(viewport) 비가 기기 화면 비와 이 안이면 **자르지 않고 전체를** 맞춰 넣는다
 *    (최대 2% 늘림/눌림, 육안 불가). 밖이면 렌더를 멈춘다 — 자르기로 맞추지 않는다.
 *    근거(2026-10-03): 옛 캡처(0.81)를 바탕 화면(0.553)에 자르기로 맞추자 좌우가 잘려 훅 스틸 불통과.
 *    새 캡처 규격 = 768×1389@2.5 = 1920×3473(0.5528).
 */
export const ASPECT_TOLERANCE = 0.02;
const warned = new Set<string>();

/** 기기 화면에 담을 캡처 영역 — 무자르기(기본) 또는 재캡처 예정 소재의 옛 자르기 */
export const tabletCrop = (s: ReadyShot): Rect => {
  const area = s.viewport ?? { x: 0, y: 0, w: s.width, h: s.height };
  const want = tabletAspect();
  const got = area.w / area.h;
  if (Math.abs(got / want - 1) <= ASPECT_TOLERANCE) return area;
  if (s.legacyCrop) {
    if (!warned.has(s.file)) {
      warned.add(s.file);
      console.warn(
        `[Demo53] 재캡처 예정 소재 옛 자르기 경로 사용: ${s.file} 비 ${got.toFixed(3)} ≠ 기기 화면 ${want.toFixed(3)} (좌우가 잘린다)`,
      );
    }
    return screenCrop(capOf(s), want);
  }
  throw new Error(
    `[Demo53] 캡처 비 불일치, 렌더 중단: ${s.file} 비 ${got.toFixed(3)}(${area.w}×${area.h}) ≠ 기기 화면 ${want.toFixed(3)} ±${ASPECT_TOLERANCE * 100}% — 768×1389@2.5(1920×3473) 규격으로 재캡처`,
  );
};

/** 캡처 화소 → 사진(1920×1080) 좌표 — 손 키·카메라 초점용. QuadShot 과 **같은 crop**(tabletCrop) */
export const shotToPhoto = (s: ReadyShot, pt: Pt): Pt => {
  const crop = tabletCrop(s);
  return squareToQuad(tabletQuad())((pt[0] - crop.x) / crop.w, (pt[1] - crop.y) / crop.h);
};
export const rectToPhoto = (s: ReadyShot, r: Rect): Pt => shotToPhoto(s, [r.x + r.w / 2, r.y + r.h / 2]);

/** 화면 한 장(카메라 없음) — Photo 안에 여러 장을 겹칠 때 */
export const TabletScreen: React.FC<{ shot: ReadyShot; opacity?: number; children?: React.ReactNode }> = ({
  shot,
  opacity = 1,
  children,
}) => (
  <QuadShot
    {...shotLayer(shot.file)}
    capture={capOf(shot)}
    crop={tabletCrop(shot)}
    corners={tabletQuad()}
    opacity={opacity}
  >
    {children}
  </QuadShot>
);

/** 기기 바탕 + 화면들 + 손 층을 한 카메라로 */
export const TabletStage: React.FC<{
  paneWidth?: number;
  paneHeight?: number;
  /** 사진 좌표 초점 */
  focus: Pt;
  zoom: number;
  /** Photo 의 느린 줌(1 = 없음) */
  push?: [number, number];
  durationInFrames: number;
  handKeys?: HandKey[];
  children: React.ReactNode;
}> = ({ paneWidth = 1920, paneHeight = 1080, focus, zoom, push = [1, 1.04], durationInFrames, handKeys, children }) => (
  <StagePane paneWidth={paneWidth} paneHeight={paneHeight} focus={focus} zoom={zoom}>
    <Photo
      src={DEMO_PLATE.file}
      pan="in"
      from={push[0]}
      to={push[1]}
      durationInFrames={durationInFrames}
      originX={focus[0]}
      originY={focus[1]}
    >
      {children}
      {handKeys && handKeys.length ? <HandLayer keys={handKeys} /> : null}
    </Photo>
  </StagePane>
);

/** 손이 화면 밖(오른쪽 아래)에서 들어오고 나가는 지점 */
export const offscreen = (p: Pt): Pt => [p[0] + 300, p[1] + 460];

/** 캡처 화소 사각형 테두리 강조(QuadShot children = 캡처 좌표) */
export const RectMark: React.FC<{ rect: Rect; color: string; opacity: number; fill?: string; thickness?: number }> = ({
  rect,
  color,
  opacity,
  fill = "transparent",
  thickness = 5,
}) => (
  <div
    style={{
      position: "absolute",
      left: rect.x - 4,
      top: rect.y - 4,
      width: rect.w + 8,
      height: rect.h + 8,
      border: `${thickness}px solid ${color}`,
      borderRadius: 8,
      background: fill,
      opacity,
      boxSizing: "border-box",
    }}
  />
);
