import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, EASE, FONT_BODY, FONT_HEAD } from "../theme";

/**
 * 자막 — 한국어 줄바꿈 규범(W3C klreq §7.1) 준수.
 *   · 어절 내부 분리 금지: word-break: keep-all + overflow-wrap: break-word
 *     (🔴 overflow-wrap: anywhere 금지 — keep-all 을 무력화한다)
 *   · 행두·행말 금칙은 브라우저 기본(UAX#14), 의도 표기로 line-break: strict
 *   · 디스플레이형이므로 한 줄 15~25자로 원고에서 이미 끊어 둔다(script.ts)
 *     — 절마다 inline-block 으로 강제하지 않는다
 *   · 조사는 앞 어절과 같은 줄에 둔다(원고 단계에서 보장)
 */
export const KO_WRAP: React.CSSProperties = {
  wordBreak: "keep-all",
  overflowWrap: "break-word",
  lineBreak: "strict",
  textWrap: "balance" as React.CSSProperties["textWrap"],
};

/** 숫자+단위·로마자 고유명처럼 갈라지면 안 되는 덩어리 */
export const NoBreak: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ whiteSpace: "nowrap" }}>{children}</span>
);

export type CaptionTone = "light" | "dark";

export const Caption: React.FC<{
  lines: string[];
  /** 등장 시작 프레임 */
  from?: number;
  /** 줄 사이 등장 간격(프레임) */
  stagger?: number;
  size?: number;
  tone?: CaptionTone;
  align?: "center" | "left";
  footnote?: string;
  /** 하단 고정 자막 대신 자유 배치할 때 */
  style?: React.CSSProperties;
}> = ({
  lines,
  from = 0,
  stagger = 5,
  size = 78,
  tone = "light",
  align = "center",
  footnote,
  style,
}) => {
  const frame = useCurrentFrame();
  const fg = tone === "dark" ? "#FFFFFF" : C.ink;
  const shadow =
    tone === "dark"
      ? "0 4px 28px rgba(0,0,0,0.55)"
      : "0 2px 18px rgba(255,255,255,0.75)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: Math.round(size * 0.16),
        ...style,
      }}
    >
      {lines.map((line, i) => {
        const start = from + i * stagger;
        const p = interpolate(frame, [start, start + 14], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE,
        });
        return (
          <div
            key={line}
            style={{
              ...KO_WRAP,
              fontFamily: FONT_HEAD,
              fontWeight: 800,
              fontSize: size,
              lineHeight: 1.24,
              letterSpacing: -1,
              textAlign: align,
              color: fg,
              textShadow: shadow,
              opacity: p,
              transform: `translateY(${(1 - p) * 26}px)`,
            }}
          >
            {line}
          </div>
        );
      })}
      {footnote ? (
        <div
          style={{
            ...KO_WRAP,
            fontFamily: FONT_BODY,
            fontSize: Math.round(size * 0.34),
            color: tone === "dark" ? "rgba(255,255,255,0.78)" : C.dim,
            marginTop: Math.round(size * 0.1),
            textAlign: align,
            opacity: interpolate(
              frame,
              [from + lines.length * stagger, from + lines.length * stagger + 14],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            ),
          }}
        >
          {footnote}
        </div>
      ) : null}
    </div>
  );
};

/** 화면 아래쪽에 깔리는 기본 자막 자리 (무음 시청 대비 — 항상 읽히게) */
export const CaptionBar: React.FC<{
  lines: string[];
  from?: number;
  tone?: CaptionTone;
  footnote?: string;
  size?: number;
}> = ({ lines, from = 0, tone = "light", footnote, size = 74 }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 110,
      display: "flex",
      justifyContent: "center",
      padding: "0 140px",
    }}
  >
    <Caption
      lines={lines}
      from={from}
      tone={tone}
      size={size}
      footnote={footnote}
      style={{ maxWidth: 1500 }}
    />
  </div>
);
