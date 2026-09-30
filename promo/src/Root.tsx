import React from "react";
import { Composition } from "remotion";
import { Main60, Preview9 } from "./compositions/Main60";
import { Cut15H, Cut15V } from "./compositions/Cut15";
import { Loop30, Gif3, Still } from "./compositions/Extras";
import { PageTexture, pageTextureFrames, pageTextureSize } from "./compositions/PageTexture";
import {
  CUT15_FRAMES,
  FPS,
  GIF3_FRAMES,
  LOOP30_FRAMES,
  MAIN60_FRAMES,
  PREVIEW9_FRAMES,
} from "./script";

/**
 * 컴포지션 7개.
 * 무음판은 따로 등록하지 않는다 — 같은 컴포지션에 inputProps 로 mute 를 넘긴다.
 *   pnpm remotion render Main60 out/main60-mute.mp4 --props='{"mute":true}'
 */
export const RemotionRoot: React.FC = () => (
  <>
    {/* ① 60초 본편 */}
    <Composition
      id="Main60"
      component={Main60}
      durationInFrames={MAIN60_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ mute: false }}
    />

    {/* ② 15초 컷다운 가로 */}
    <Composition
      id="Cut15H"
      component={Cut15H}
      durationInFrames={CUT15_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ mute: false }}
    />

    {/* ③ 15초 컷다운 세로 */}
    <Composition
      id="Cut15V"
      component={Cut15V}
      durationInFrames={CUT15_FRAMES}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ mute: false }}
    />

    {/* ④ 30초 부스 루프판 — 부스는 소리를 안 쓰므로 기본 무음 */}
    <Composition
      id="Loop30"
      component={Loop30}
      durationInFrames={LOOP30_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ mute: true }}
    />

    {/* ⑤ 3초 GIF — 문서함에 쌓이는 장면 */}
    <Composition
      id="Gif3"
      component={Gif3}
      durationInFrames={GIF3_FRAMES}
      fps={FPS}
      width={1200}
      height={675}
    />

    {/* ⑥ 스틸컷 — remotion still Still out/still-01.png --frame=N */}
    <Composition
      id="Still"
      component={Still}
      durationInFrames={MAIN60_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ mute: true }}
    />

    {/* 굽기 전용 — 3D 종이 텍스처(영상 아님). node tools/make-page-texture.mjs */}
    <Composition
      id="PageTexture"
      component={PageTexture}
      durationInFrames={pageTextureFrames()}
      fps={FPS}
      width={pageTextureSize().width}
      height={pageTextureSize().height}
    />

    {/* ⑦ 9초 시안 — Hook + Paper 스타일 확정용 */}
    <Composition
      id="Preview9"
      component={Preview9}
      durationInFrames={PREVIEW9_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ mute: false }}
    />
  </>
);
