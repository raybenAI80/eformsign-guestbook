import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { C, FONT_BODY, LOGO } from "../theme";

/**
 * 한국어 줄바꿈 전역 규칙 (W3C klreq §7.1).
 * 🔴 overflow-wrap 에 anywhere 를 쓰지 않는다 — keep-all 을 무력화한다.
 */
export const KOREAN_TYPOGRAPHY_CSS = `
  * { word-break: keep-all; overflow-wrap: break-word; line-break: strict; }
  .nb { white-space: nowrap; }
`;

export const KoreanTypography: React.FC = () => (
  <style dangerouslySetInnerHTML={{ __html: KOREAN_TYPOGRAPHY_CSS }} />
);

/** 장면 공통 무대. light = 흰/연파랑, blue = 이폼사인 블루 밴드 */
export const Stage: React.FC<{
  children: React.ReactNode;
  variant?: "light" | "blue" | "photo";
  /** 우하단 로고 워터마크. 로고는 제공 PNG 만 쓴다 */
  logo?: "br" | "none";
}> = ({ children, variant = "light", logo = "br" }) => (
  <AbsoluteFill
    style={{
      background:
        variant === "blue"
          ? `linear-gradient(160deg, ${C.blue} 0%, ${C.blueDeep} 100%)`
          : variant === "photo"
            ? "#0B1420"
            : `radial-gradient(1400px 900px at 30% 0%, ${C.lightBlue} 0%, #FFFFFF 60%)`,
      fontFamily: FONT_BODY,
      color: variant === "light" ? C.ink : "#FFFFFF",
    }}
  >
    <KoreanTypography />
    {children}
    {logo !== "none" ? (
      <Img
        src={staticFile(variant === "light" ? LOGO.blue : LOGO.white)}
        style={{ position: "absolute", right: 64, bottom: 48, width: 200, opacity: 0.95 }}
      />
    ) : null}
  </AbsoluteFill>
);
