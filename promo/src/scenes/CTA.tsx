import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage } from "../components/Stage";
import { KO_WRAP } from "../components/Caption";
import { Narration } from "../components/Narration";
import { EASE, FONT_BODY, FONT_HEAD, LOGO } from "../theme";
import { scene } from "../script";
import { CtaPanel3D, ctaFaceStyle, ctaTiltStrong } from "../components/three/Moments3D";
import { useCand } from "../cand";

/**
 * 54–60초 — CTA. 착지 주소는 이폼사인 홈페이지 www.eformsign.com (2026-09-18 확정).
 *
 * 🔴 로고·슬로건은 제공 PNG 만 쓴다. 이름을 텍스트로 조판하지 않는다 —
 *    그래서 자막 첫 줄 「이폼사인」은 화면에 글자로 찍지 않고 로고 PNG 가 대신한다.
 * 🔴 주소는 어절이 아니라 한 덩어리다 → `white-space: nowrap` 으로 갈라지지 않게 묶는다.
 *    방명록 설치 주소는 영상에 넣지 않는다(유튜브 설명란·소개 페이지의 보조 링크).
 */
const S = scene("cta");

/**
 * v3.3 레인 T ③ — 살짝 기운 3D 패널(three.js)이 0.8초(24f)에 정면으로 돈다.
 * 로고·슬로건·주소는 **DOM(제공 PNG) 그대로** 패널과 같은 원근으로 함께 돈다(ctaFaceStyle) —
 * 로고를 텍스처로 다시 그리지 않으므로 정면이 된 뒤에는 v3.2 와 같은 화소 조판이다.
 */
const TILT_FRAMES = 24;
/** cta-reveal.wav 정점까지 프레임(레인 U 계약) */
const REVEAL_HIT = 18;
const PANEL = { w: 1240, h: 780 };

export const CTA: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const tilt = Math.min(1, frame / (TILT_FRAMES - 1));
  const panelIn = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" });
  const p = interpolate(frame, [0, 22], [0, 1], { extrapolateRight: "clamp", easing: EASE });
  const q = interpolate(frame, [18, 40], [0, 1], { extrapolateRight: "clamp", easing: EASE });
  const r = interpolate(frame, [34, 58], [0, 1], { extrapolateRight: "clamp", easing: EASE });

  const [, lead, address] = S.captions;
  const c5 = useCand() === "c5";
  const ang = c5 ? ctaTiltStrong(tilt, frame) : undefined;

  return (
    <Stage variant="blue" logo="none">
      <Narration id="cta" mute={mute} />
      {/* v3.3 레인 T2 — cta-reveal.wav 정점(0.60초 = 18f)을 패널 회전이 멈추는 프레임(TILT_FRAMES-1)에 */}
      {mute ? null : (
        <Sequence name="효과음 cta-reveal" from={TILT_FRAMES - 1 - REVEAL_HIT} durationInFrames={48}>
          <Audio src={staticFile("sfx/cta-reveal.wav")} />
        </Sequence>
      )}
      <CtaPanel3D progress={tilt} w={PANEL.w} h={PANEL.h} opacity={panelIn} ang={ang} depthPx={c5 ? 64 : undefined} />
      <div style={c5 ? { ...ctaFaceStyle(tilt, height, ang), transformStyle: "preserve-3d" } : ctaFaceStyle(tilt, height)}>
      <AbsoluteFill
        style={{
          ...(c5 ? { transformStyle: "preserve-3d" as const } : null),
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 40,
        }}
      >
        {/* 로고·슬로건 = 제공 PNG. 블루 밴드 위이므로 화이트 버전 */}
        {c5 ? (
          /* 레인 B 후보 5: 제공 로고 PNG 를 패널 앞으로 띄우고(translateZ 70) 같은 PNG 를 뒤로 겹겹이 어둡게 쌓아 두께를 낸다 */
          <div style={{ position: "relative", width: 620, transformStyle: "preserve-3d", opacity: p, transform: `translateY(${(1 - p) * 26}px)` }}>
            {Array.from({ length: 10 }, (_, i) => (
              <Img
                key={i}
                src={staticFile(LOGO.white)}
                style={{
                  position: i === 9 ? "relative" : "absolute",
                  left: 0,
                  top: 0,
                  width: 620,
                  display: "block",
                  transform: `translateZ(${70 - (9 - i) * 3}px)`,
                  filter: i === 9 ? undefined : "brightness(0.62) sepia(0.5) hue-rotate(170deg) saturate(2.2)",
                }}
              />
            ))}
          </div>
        ) : (
        <Img
          src={staticFile(LOGO.white)}
          style={{ width: 620, opacity: p, transform: `translateY(${(1 - p) * 26}px)` }}
        />
        )}
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
      </div>
    </Stage>
  );
};
