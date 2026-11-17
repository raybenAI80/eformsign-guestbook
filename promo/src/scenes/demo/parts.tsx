import React from "react";
import { AbsoluteFill } from "remotion";
import { Caption } from "../../components/Caption";
import { fitCrop, type Rect } from "../../shots-scenes";
import type { ReadyShot } from "../../demo-shots";

/** 아래쪽 흰 띠 + 자막(홍보편 Fill 과 같은 조판) — 사진·캡처 위에서도 읽힌다 */
export const CaptionBand: React.FC<{ lines: string[]; footnote?: string; from?: number; size?: number }> = ({
  lines,
  footnote,
  from = 10,
  size = 58,
}) => (
  <AbsoluteFill
    style={{
      justifyContent: "flex-end",
      alignItems: "center",
      paddingBottom: 54,
      background:
        "linear-gradient(to top, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.93) 16%, rgba(255,255,255,0) 34%)",
    }}
  >
    <Caption lines={lines} footnote={footnote} from={from} size={size} tone="light" />
  </AbsoluteFill>
);

/**
 * PC 캡처를 w×h 상자에 담는 자르기와, 캡처 화소 → 상자 좌표 변환.
 * 자르기는 viewport(없으면 전체)를 상자 비율로 최대한 담는다(위 정렬 — 문서함 머리글을 살린다).
 */
export const boxFrame = (s: ReadyShot, box: { x: number; y: number; w: number; h: number }) => {
  const cap = { width: s.width, height: s.height };
  const crop: Rect = fitCrop(s.viewport ?? { x: 0, y: 0, w: s.width, h: s.height }, box.w / box.h, cap, "top");
  const k = box.w / crop.w;
  const toBox = (px: number, py: number): [number, number] => [box.x + (px - crop.x) * k, box.y + (py - crop.y) * k];
  return { cap, crop, k, toBox };
};
