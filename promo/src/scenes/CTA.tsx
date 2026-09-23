import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Stage } from "../components/Stage";
import { KO_WRAP } from "../components/Caption";
import { Narration } from "../components/Narration";
import { EASE, FONT_BODY, FONT_HEAD, LOGO } from "../theme";
import { scene } from "../script";

/**
 * 54–60초 — CTA. 착지 주소는 이폼사인 홈페이지 www.eformsign.com (2026-09-18 확정).
 *
 * 🔴 로고·슬로건은 제공 PNG 만 쓴다. 이름을 텍스트로 조판하지 않는다 —
 *    그래서 자막 첫 줄 「이폼사인」은 화면에 글자로 찍지 않고 로고 PNG 가 대신한다.
 * 🔴 주소는 어절이 아니라 한 덩어리다 → `white-space: nowrap` 으로 갈라지지 않게 묶는다.
 *    방명록 설치 주소는 영상에 넣지 않는다(유튜브 설명란·소개 페이지의 보조 링크).
 */
const S = scene("cta");

export const CTA: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, 22], [0, 1], { extrapolateRight: "clamp", easing: EASE });
  const q = interpolate(frame, [18, 40], [0, 1], { extrapolateRight: "clamp", easing: EASE });
  const r = interpolate(frame, [34, 58], [0, 1], { extrapolateRight: "clamp", easing: EASE });

  const [, lead, address] = S.captions;

  return (
    <Stage variant="blue" logo="none">
      <Narration id="cta" mute={mute} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 40,
        }}
      >
        {/* 로고·슬로건 = 제공 PNG. 블루 밴드 위이므로 화이트 버전 */}
        <Img
          src={staticFile(LOGO.white)}
          style={{ width: 620, opacity: p, transform: `translateY(${(1 - p) * 26}px)` }}
        />
        <Img src={staticFile(LOGO.sloganWhite)} style={{ width: 430, opacity: p * 0.9 }} />

        <div
          style={{
            ...KO_WRAP,
            fontFamily: FONT_HEAD,
            fontWeight: 800,
            fontSize: 72,
            color: "#FFFFFF",
            textAlign: "center",
            marginTop: 18,
            opacity: q,
            transform: `translateY(${(1 - q) * 22}px)`,
            textShadow: "0 4px 28px rgba(0,0,0,0.35)",
          }}
        >
          {lead}
        </div>

        {/* 착지 주소 — 한 덩어리로 묶어 어디서도 갈라지지 않게 한다 */}
        <div
          style={{
            whiteSpace: "nowrap",
            fontFamily: FONT_HEAD,
            fontWeight: 800,
            fontSize: 62,
            letterSpacing: 1,
            color: "#0E73C3",
            background: "#FFFFFF",
            borderRadius: 999,
            padding: "18px 56px",
            opacity: r,
            transform: `translateY(${(1 - r) * 18}px)`,
            boxShadow: "0 18px 46px rgba(0,0,0,0.22)",
          }}
        >
          {address}
        </div>

        {S.footnote ? (
          <div
            style={{
              ...KO_WRAP,
              fontFamily: FONT_BODY,
              fontSize: 28,
              color: "rgba(255,255,255,0.8)",
              marginTop: 10,
              opacity: r,
            }}
          >
            {S.footnote}
          </div>
        ) : null}
      </AbsoluteFill>
    </Stage>
  );
};
