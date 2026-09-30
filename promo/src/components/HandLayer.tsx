import React from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import { handLayerSpec, handTransform, poseAt, type HandKey } from "../hand";

/**
 * 손 컷아웃 한 장을 궤적(`src/hand.ts`)대로 움직인다(레인 V, 2026-09-30).
 *
 * 🔴 `Photo` 의 children 안, **캡처 층들 뒤(=위)** 에 둔다 — 사진과 같은 카메라 변환을 받고,
 *    손이 언제나 화면 캡처 위에 온다(v3 의 Occluder 가 손끝만 하던 일을 손 전체가 한다).
 */
export const HandLayer: React.FC<{ keys: HandKey[]; from?: number }> = ({ keys, from = 0 }) => {
  const frame = useCurrentFrame() - from;
  const spec = handLayerSpec();
  if (!spec || !keys.length) return null;
  const pose = poseAt(keys, frame);
  if (!pose.visible) return null;
  const t = handTransform(spec, pose, frame);
  const [ox, oy] = spec.origin;
  const [w, h] = spec.size;
  const [px, py] = spec.pivot;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <Img
        src={staticFile(`gen/${spec.file}`)}
        style={{
          position: "absolute",
          left: ox,
          top: oy,
          width: w,
          height: h,
          maxWidth: "none",
          transformOrigin: `${px - ox}px ${py - oy}px`,
          transform: `translate(${t.dx}px, ${t.dy}px) rotate(${t.rotDeg}deg) scale(${t.scale})`,
          filter: `drop-shadow(${t.shadow.x}px ${t.shadow.y}px ${t.shadow.blur}px rgba(20,24,30,${t.shadow.a}))`,
        }}
      />
    </div>
  );
};
