import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { bookZoomPlan, hookScaleAt, paperLeadScaleAt } from "../camera";

/**
 * 훅과 Paper 앞 컷이 **공유하는 카메라**.
 *
 * 🔴 두 장면이 같은 사진(gen-01.png)을 쓰므로 배율과 초점(transform-origin)이
 *    경계에서 같아야 점프컷이 안 난다. 값과 곡선의 정본은 `src/camera.ts` 하나뿐이고
 *    이 컴포넌트는 그것을 프레임에 얹기만 한다.
 *
 * 🔴 카메라를 Photo 안이 아니라 **바깥 래퍼**로 두는 이유(레인 B 가 먼저 확인한 것):
 *   · Photo 의 이징은 EASE_OUT 고정이고 그 컴포넌트는 다른 레인 장면들도 함께 쓴다.
 *   · Photo 의 스크림은 카메라 변환을 **받으면 안 된다**(화면 고정 그라데이션인데
 *     같이 확대되면 프레임 전체가 어두워진다). 그래서 Photo 에는 scrim 0 을 주고
 *     `CameraScrim` 을 카메라 **밖**에 깐다.
 *   사진과 덧글씨(PaperInk)는 같은 래퍼 안에 있으므로 원근 매핑이 함께 확대된다 —
 *   matrix3d 는 부모 scale 과 곱해질 뿐이고 transform-origin 은 상속되지 않는다.
 *
 * 🔴 자막은 절대 이 래퍼 안에 넣지 않는다. 넣으면 줌을 따라 커지고 흔들린다.
 */
const PLAN = bookZoomPlan();

/**
 * v4.1 — 카메라 프레임 보정값. 기본 0. Main60 의 hook→paper 크로스페이드 리드인이
 * `<Freeze frame={0}>` 로 Paper 를 세워 둔 채 이 값에 음수(−XFADE..−1)를 넣어
 * **사진 줌만** 경계 앞 프레임으로 움직인다(자막·스크림은 화면 고정이라 무관).
 */
export const CameraFrameOffset = React.createContext(0);

export const BookCamera: React.FC<{
  /** "hook" = 1.00 → 인계 배율(ease-in) · "paper" = 인계 배율 → 최대(속도 연속) */
  phase: "hook" | "paper";
  children: React.ReactNode;
}> = ({ phase, children }) => {
  const frame = useCurrentFrame() + React.useContext(CameraFrameOffset);
  const scale = phase === "hook" ? hookScaleAt(frame, PLAN) : paperLeadScaleAt(frame, PLAN);
  return (
    <AbsoluteFill
      style={{
        transform: `scale(${scale})`,
        transformOrigin: `${PLAN.origin[0]}px ${PLAN.origin[1]}px`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** 자막 가독용 스크림 — 카메라 **밖**(화면 고정). Photo 의 것과 같은 그라데이션 */
export const CameraScrim: React.FC<{ strength: number }> = ({ strength }) => (
  <AbsoluteFill
    style={{
      background: `linear-gradient(to top, rgba(6,14,26,${strength}) 0%, rgba(6,14,26,${
        strength * 0.35
      }) 45%, rgba(6,14,26,0) 100%)`,
    }}
  />
);
