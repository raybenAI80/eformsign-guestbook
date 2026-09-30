import React from "react";
import { AbsoluteFill } from "remotion";
import { BookSpread } from "../scenes/Paper";
import { quadToRectMatrix3d, type Corners } from "../components/ScreenComposite";
import { bookPageLocalFromScreen, bookPageScreen, bookPageSize } from "../geometry";
import { paperFirstCutFrames } from "../camera";
import { sceneFrames } from "../script";
import { TEX_SCALE } from "../components/three/moments-geometry";

/**
 * v3.3 레인 T2 — Paper→Designer 3D 종이의 **텍스처 굽기용** 컴포지션(영상에 나가지 않는다).
 *
 * gen-01 사진 + 손글씨 층(Paper 앞 컷의 `BookSpread` 그대로)을 두 페이지 사각형
 * (prompts.json ①.geometry.pages, **화면 라벨 그대로**)에서 직사각형으로 펴서 가로로 붙인다.
 * 크기 = 페이지 로컬(ruling.pageWidth × pageHeight) × 2쪽 × TEX_SCALE.
 * 🔴 손글씨가 다 써진 앞 컷 **마지막 프레임**으로 굽는다: `node tools/make-page-texture.mjs`.
 *    gen-01·prompts.json·손글씨 설정이 바뀌면 다시 굽는다(게이트가 PNG 크기·시각을 대조).
 */
export const pageTextureSize = () => {
  const [w, h] = bookPageSize();
  return { width: w * 2 * TEX_SCALE, height: h * TEX_SCALE };
};
export const pageTextureFrames = () => paperFirstCutFrames(sceneFrames("paper"));

/**
 * 텍스처 한 쪽 직사각형(화면 라벨 tl=좌상)을 **페이지 로컬 순서**로. 배정은 geometry.ts 와 같아야 한다
 * (pageLocalFromScreen). 텍스처는 화면에 보이던 방향 그대로 펴므로 화면 라벨 → 로컬 변환만 한다.
 */
const rectLocal = (x0: number, w: number, h: number): Corners => {
  const screen: Corners = { tl: [x0, 0], tr: [x0 + w, 0], br: [x0 + w, h], bl: [x0, h] };
  return bookPageLocalFromScreen() === "rot180"
    ? { tl: screen.br, tr: screen.bl, br: screen.tl, bl: screen.tr }
    : screen;
};

export const PageTexture: React.FC = () => {
  const [pw, ph] = bookPageSize();
  const w = pw * TEX_SCALE;
  const h = ph * TEX_SCALE;
  return (
    <AbsoluteFill style={{ background: "#FFFFFF" }}>
      {(["left", "right"] as const).map((side, i) => {
        const q = bookPageScreen(side);
        if (!q) return null;
        return (
          <div
            key={side}
            style={{ position: "absolute", left: i * w, top: 0, width: w, height: h, overflow: "hidden" }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 1920,
                height: 1080,
                transformOrigin: "0 0",
                transform: quadToRectMatrix3d(q, w, h),
              }}
            >
              <BookSpread durationInFrames={pageTextureFrames()} ink={false} />
            </div>
          </div>
        );
      })}
      {/* 손글씨는 펼친 좌표에 **직접** 그린다. 🔴 사진과 같이 matrix3d 로 펴면 Chrome 이 글자 층을
          원근 축소 배율로 래스터한 뒤 늘려 계단 글자가 된다(2026-09-30 1차 굽기 왼쪽 쪽 실측). */}
      <BookSpread
        durationInFrames={pageTextureFrames()}
        photo={false}
        pageCorners={{ left: rectLocal(0, w, h), right: rectLocal(w, w, h) }}
      />
    </AbsoluteFill>
  );
};
