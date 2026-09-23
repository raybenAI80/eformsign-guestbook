import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, EASE } from "../theme";

/**
 * 화면 분할 — 왼쪽은 현장(생성 이미지), 오른쪽은 이폼사인 문서함.
 * 이 문법이 A안의 핵심이다: "현장에서 쓰는 순간 = 문서함에 들어오는 순간".
 *
 * ratio 는 왼쪽이 차지하는 비율(0~1). 세로 판형(9:16)에서는 vertical 을 켠다.
 */
export const SplitScreen: React.FC<{
  left: React.ReactNode;
  right: React.ReactNode;
  ratio?: number;
  vertical?: boolean;
  /** 분할선이 그어지는 프레임 */
  from?: number;
  rightBackground?: string;
}> = ({
  left,
  right,
  ratio = 0.56,
  vertical = false,
  from = 0,
  rightBackground = C.lightBlue,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [from, from + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const leftPct = `${ratio * 100}%`;
  const rightPct = `${(1 - ratio) * 100}%`;

  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: vertical ? "column" : "row" }}>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          ...(vertical ? { height: leftPct, width: "100%" } : { width: leftPct, height: "100%" }),
        }}
      >
        {left}
      </div>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          background: rightBackground,
          ...(vertical ? { height: rightPct, width: "100%" } : { width: rightPct, height: "100%" }),
          opacity: p,
          transform: vertical
            ? `translateY(${(1 - p) * 60}px)`
            : `translateX(${(1 - p) * 60}px)`,
        }}
      >
        {right}
      </div>
      {/* 분할선 — 메인 컬러 얇은 선 */}
      <div
        style={{
          position: "absolute",
          background: C.blue,
          opacity: 0.35 * p,
          ...(vertical
            ? { left: 0, right: 0, top: leftPct, height: 3 }
            : { top: 0, bottom: 0, left: leftPct, width: 3 }),
        }}
      />
    </AbsoluteFill>
  );
};
