import React from "react";
import { AbsoluteFill } from "remotion";
import { BookSpread } from "../scenes/Paper";
import { quadToRectMatrix3d, type Corners } from "../components/ScreenComposite";
import { bookPageLeft, bookPageRight, bookPageSize } from "../geometry";
import { paperFirstCutFrames } from "../camera";
import { sceneFrames } from "../script";
import { TEX_SCALE, readSide } from "../components/three/moments-geometry";

/**
 * v3.3 레인 T3 — Paper→Designer 3D 종이의 **텍스처 굽기용** 컴포지션(영상에 나가지 않는다).
 *
 * gen-01 사진 + 손글씨 층(Paper 앞 컷의 `BookSpread` 그대로)에서 **읽는 쪽 한 페이지만**
 * 직사각형으로 편다. 크기 = 페이지 로컬(ruling.pageWidth × pageHeight) × TEX_SCALE.
 *
 * 🔴 정방향(레인 T3 결함 ①): gen-01 은 쓰는 사람이 카메라를 **마주 보는** 구도라 지면이 화면에서 180° 돌아
 *    있다(prompts.json pageLocalFromScreen = "rot180"). T2 는 화면 라벨(bookPageScreen)로 펴서 글씨가
 *    뒤집힌 채 구워졌다. 여기서는 **페이지 로컬 라벨**(bookPageLeft/Right — tl = 첫 줄 시작 모서리)로 펴므로
 *    사진·손글씨 모두 쓰는 사람이 본 방향(정방향)이 된다. 손글씨는 로컬 직사각형에 직접 그린다.
 * 🔴 손/펜(결함 ②): 오른손 손가락이 읽는 쪽 먼 변에 걸려 있다 → 굽기 뒤 `tools/mask-page-texture.py` 가
 *    피부·펜 화소를 지면 색으로 메운다(`node tools/make-page-texture.mjs` 가 두 단계를 다 돈다).
 */
export const pageTextureSize = () => {
  const [w, h] = bookPageSize();
  return { width: w * TEX_SCALE, height: h * TEX_SCALE };
};
export const pageTextureFrames = () => paperFirstCutFrames(sceneFrames("paper"));

/** 페이지 로컬 라벨 직사각형(tl = 로컬 좌상 = 첫 줄 시작) */
const rect = (x0: number, w: number, h: number): Corners => ({
  tl: [x0, 0],
  tr: [x0 + w, 0],
  br: [x0 + w, h],
  bl: [x0, h],
});

export const PageTexture: React.FC = () => {
  const [pw, ph] = bookPageSize();
  const w = pw * TEX_SCALE;
  const h = ph * TEX_SCALE;
  const side = readSide();
  const q = side === "left" ? bookPageLeft() : bookPageRight();
  /* 읽는 쪽 = 캔버스 [0,w], 다른 쪽 = 캔버스 밖 [w,2w](잘려 안 보인다) */
  const corners = side === "left" ? { left: rect(0, w, h), right: rect(w, w, h) } : { left: rect(w, w, h), right: rect(0, w, h) };
  return (
    <AbsoluteFill style={{ background: "#FFFFFF", overflow: "hidden" }}>
      {q ? (
        <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden" }}>
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
      ) : null}
      {/* 손글씨는 펼친 좌표에 **직접** 그린다. 🔴 사진과 같이 matrix3d 로 펴면 Chrome 이 글자 층을
          원근 축소 배율로 래스터한 뒤 늘려 계단 글자가 된다(2026-09-30 1차 굽기 왼쪽 쪽 실측). */}
      <BookSpread durationInFrames={pageTextureFrames()} photo={false} pageCorners={corners} />
    </AbsoluteFill>
  );
};
