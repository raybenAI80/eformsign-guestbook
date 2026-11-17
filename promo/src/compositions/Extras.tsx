import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Hook } from "../scenes/Hook";
import { Fill } from "../scenes/Fill";
import { Manage } from "../scenes/Manage";
import { Branch } from "../scenes/Branch";
import { CTA } from "../scenes/CTA";
import { Main60 } from "./Main60";
import { sec } from "../script";
import type { PromoProps } from "./Main60";

/**
 * 30초 부스 루프판 — 전시회 부스에서 소리 없이 계속 돌아간다.
 * 그래서 기본이 무음이고, 끝과 처음이 이어지도록 훅으로 되돌아온다.
 */
export const Loop30: React.FC<PromoProps> = ({ mute = true }) => (
  <AbsoluteFill style={{ background: "#FFFFFF" }}>
    <Sequence name="훅" from={0} durationInFrames={sec(4)}>
      <Hook mute={mute} />
    </Sequence>
    <Sequence name="작성·도착" from={sec(4)} durationInFrames={sec(10)}>
      <Fill mute={mute} />
    </Sequence>
    <Sequence name="관리" from={sec(14)} durationInFrames={sec(8)}>
      <Manage mute={mute} />
    </Sequence>
    <Sequence name="전이" from={sec(22)} durationInFrames={sec(4)}>
      <Branch mute={mute} />
    </Sequence>
    <Sequence name="CTA" from={sec(26)} durationInFrames={sec(4)}>
      <CTA mute={mute} />
    </Sequence>
  </AbsoluteFill>
);

/** 3초 GIF — 문서함에 문서가 쌓이는 장면만. 뉴스레터용이라 항상 무음 */
export const Gif3: React.FC = () => (
  <AbsoluteFill style={{ background: "#FFFFFF" }}>
    <Hook mute />
  </AbsoluteFill>
);

/**
 * 스틸컷 — 영업 메일·제안서용 정지 이미지 5장을 한 컴포지션에서 뽑는다.
 * `remotion still Still out/still-01.png --frame=<n>` 로 프레임을 지정한다.
 * 추천 프레임: 60(훅) / 250(작성) / 560(관리) / 1470(전이) / 1720(CTA)
 */
export const Still: React.FC<PromoProps> = ({ mute = true }) => (
  <AbsoluteFill style={{ background: "#FFFFFF" }}>
    <Main60 mute={mute} />
  </AbsoluteFill>
);
