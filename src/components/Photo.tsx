import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, EASE_OUT } from "../theme";

/**
 * 생성 이미지 한 장에 카메라 무빙(줌·패닝)을 얹어 영상감을 만든다.
 * 정지 이미지가 소재의 절반이므로 이 컴포넌트가 영상의 리듬을 담당한다.
 *
 * 실이미지가 도착하기 전에는 public/gen/gen-0N.png 가 회색 플레이스홀더다.
 * 파일만 교체하면 그대로 붙는다(파일명 고정).
 */
export type Pan = "in" | "out" | "left" | "right" | "up" | "down";

export const Photo: React.FC<{
  /** public/gen/ 아래 파일명. 예: "gen-01.png" */
  src: string;
  /** 무빙 종류 */
  pan?: Pan;
  /** 시작 배율 (1 = 원본) */
  from?: number;
  /** 끝 배율 */
  to?: number;
  /** 무빙이 걸리는 구간(프레임). 기본은 장면 전체를 알 수 없으므로 넉넉히 */
  durationInFrames?: number;
  /** 어두운 오버레이 세기(자막 가독용) */
  scrim?: number;
  /**
   * 줌의 기준점(컴포지션 좌표 px). 생략하면 화면 가운데.
   *
   * 🔴 왜 있나: 피사체가 프레임 구석에 있으면 가운데 기준 줌은 그것을 **화면 밖으로 밀어낸다**.
   *    방명록처럼 좌하단에 있는 것을 밀고 들어가려면 원점을 그 반대편으로 옮겨야 한다.
   *    계산은 src/geometry.ts 의 originFor() 가 한다.
   */
  originX?: number;
  originY?: number;
  children?: React.ReactNode;
}> = ({
  src,
  pan = "in",
  from = 1.06,
  to = 1.16,
  durationInFrames = 180,
  scrim = 0,
  originX,
  originY,
  children,
}) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  const scale = pan === "out" ? interpolate(t, [0, 1], [to, from]) : interpolate(t, [0, 1], [from, to]);

  const shift = 44; // px
  const tx =
    pan === "left" ? interpolate(t, [0, 1], [shift, -shift])
    : pan === "right" ? interpolate(t, [0, 1], [-shift, shift])
    : 0;
  const ty =
    pan === "up" ? interpolate(t, [0, 1], [shift, -shift])
    : pan === "down" ? interpolate(t, [0, 1], [-shift, shift])
    : 0;

  /**
   * 🔴 children 은 이미지와 **같은 변환**을 받아야 한다. 안 그러면 사진 위에 얹은
   * 덧글씨가 카메라 무빙을 따라가지 않고 제자리에 남아 지면에서 떨어져 나간다
   * (2026-09-18 Paper 장면 결함). children 좌표는 변환 전 이미지 좌표계(1920×1080) 기준.
   */
  const camera = `scale(${scale}) translate(${tx}px, ${ty}px)`;
  const origin = originX != null && originY != null ? `${originX}px ${originY}px` : "center center";

  return (
    <AbsoluteFill style={{ overflow: "hidden", background: C.lightGray }}>
      <Img
        src={staticFile(`gen/${src}`)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: camera,
          transformOrigin: origin,
        }}
      />
      {scrim > 0 ? (
        <AbsoluteFill
          style={{
            background: `linear-gradient(to top, rgba(6,14,26,${scrim}) 0%, rgba(6,14,26,${scrim * 0.35}) 45%, rgba(6,14,26,0) 100%)`,
          }}
        />
      ) : null}
      {children ? (
        <AbsoluteFill style={{ transform: camera, transformOrigin: origin }}>
          {children}
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * 생성 이미지 위에 얹는 가짜 정보 텍스트.
 * 🔴 생성 이미지 안의 글자는 쓰지 않는다 — 글자는 전부 Remotion 으로 그린다(기획서 10절 1-1).
 */
export const OverlayText: React.FC<{
  items: { text: string; x: number; y: number; rotate?: number; size?: number }[];
  from?: number;
  stagger?: number;
}> = ({ items, from = 0, stagger = 6 }) => {
  const frame = useCurrentFrame();
  return (
    <>
      {items.map((it, i) => {
        const p = interpolate(frame, [from + i * stagger, from + i * stagger + 12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={it.text + i}
            style={{
              position: "absolute",
              left: it.x,
              top: it.y,
              fontFamily: "'Nanum Pen Script', 'Malgun Gothic', sans-serif",
              fontSize: it.size ?? 34,
              color: "#1D2430",
              transform: `rotate(${it.rotate ?? -2}deg)`,
              opacity: p * 0.92,
              whiteSpace: "nowrap",
              wordBreak: "keep-all",
              overflowWrap: "break-word",
              lineBreak: "strict",
            }}
          >
            {it.text}
          </div>
        );
      })}
    </>
  );
};
