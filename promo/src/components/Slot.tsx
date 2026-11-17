import React from "react";
import { C, FONT_BODY, FONT_HEAD } from "../theme";

/**
 * 아직 소재가 도착하지 않은 자리.
 * 무엇이 들어올 자리인지 화면에 적어 둔다 — 리뷰에서 "여기가 비었다"가 아니라
 * "여기에 무엇이 온다"가 보이게 하기 위해서다.
 *
 * 소재가 도착하면 이 컴포넌트를 Photo / ScreenComposite / Inbox 로 갈아 끼운다.
 */
export const Slot: React.FC<{
  /** 무엇이 들어올 자리인가 */
  label: string;
  /** 어디서 오는 소재인가 — 예: "생성 이미지 ③" / "실화면 캡처: 문서함" */
  source?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ label, source, style, children }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 14,
      background: "repeating-linear-gradient(45deg, #EFF3F8 0 26px, #E7ECF3 26px 52px)",
      border: `2px dashed ${C.border}`,
      borderRadius: 18,
      color: C.dim,
      textAlign: "center",
      padding: 28,
      ...style,
    }}
  >
    <div
      style={{
        fontFamily: FONT_HEAD,
        fontWeight: 600,
        fontSize: 40,
        color: C.blue,
        wordBreak: "keep-all",
      }}
    >
      {label}
    </div>
    {source ? (
      <div style={{ fontFamily: FONT_BODY, fontSize: 28, wordBreak: "keep-all" }}>{source}</div>
    ) : null}
    {children}
  </div>
);

/** 장면 좌상단에 붙는 타이밍 표식 — 조립 단계 확인용(최종 렌더 전에 뺀다) */
export const TimeTag: React.FC<{ startSec: number; endSec: number; label: string }> = ({
  startSec,
  endSec,
  label,
}) => (
  <div
    style={{
      position: "absolute",
      left: 48,
      top: 44,
      display: "flex",
      alignItems: "center",
      gap: 14,
      background: "rgba(14,115,195,0.10)",
      border: `1px solid ${C.blue}`,
      borderRadius: 999,
      padding: "12px 24px",
      fontFamily: FONT_BODY,
      fontSize: 26,
      color: C.blue,
      wordBreak: "keep-all",
    }}
  >
    <span className="nb" style={{ whiteSpace: "nowrap", fontWeight: 700 }}>
      {startSec}–{endSec}초
    </span>
    <span style={{ opacity: 0.8 }}>{label}</span>
  </div>
);
