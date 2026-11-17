import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile } from "remotion";
import { Narration } from "../../components/Narration";

/**
 * v4.0 A안(2026-10-12 사용자 확정) — Main60 의 hook·repeat·cta 화면은 HyperFrames 렌더본이다.
 *
 *  - 화면 = public/hf/{hook,repeat,cta}.mp4 (무음, tools/build-hf-clips.mjs 가 만든다).
 *    소스는 promo-hf/(HF CLI 0.8.149) — 화면을 고치려면 그쪽을 고치고 위 명령을 다시 돌린다.
 *  - 소리 = Remotion 트랙만. 나레이션·룸톤·cta-reveal 은 원래 Remotion 장면과 같은 자리에서 낸다.
 *    BGM 덕킹은 Main60 의 <Bgm> 이 scene-durations.json(HF 고정 길이 반영)에서 자동으로 따라온다.
 *  - 길이는 렌더본에 고정(tools/scene-durations.mjs HF_FIXED_FRAMES).
 *
 * 🔴 원래 Hook/Repeat/CTA 컴포넌트는 지우지 않는다 — Cut15·Loop30·Demo53·Preview9 가 그대로 쓴다.
 */
const HfVideo: React.FC<{ name: "hook" | "repeat" | "cta" }> = ({ name }) => (
  <OffthreadVideo src={staticFile(`hf/${name}.mp4`)} muted style={{ width: "100%", height: "100%" }} />
);

/** Hook.tsx 의 HookAir 와 같은 소리(룸톤 4.0초 · 3.7초부터 페이드아웃) */
export const HfHook: React.FC<{ mute?: boolean }> = ({ mute }) => (
  <AbsoluteFill style={{ background: "#FFFFFF" }}>
    <HfVideo name="hook" />
    <Narration id="hook" mute={mute} />
    {mute ? null : <Audio src={staticFile("sfx/room-tone.wav")} volume={0.7} />}
  </AbsoluteFill>
);

export const HfRepeat: React.FC<{ mute?: boolean }> = ({ mute }) => (
  <AbsoluteFill style={{ background: "#FFFFFF" }}>
    <HfVideo name="repeat" />
    <Narration id="repeat" mute={mute} />
  </AbsoluteFill>
);

/**
 * CTA.tsx 와 같은 박자: cta-reveal.wav 정점(18f)을 패널 회전이 멈추는 프레임(TILT_FRAMES-1 = 23)에.
 * HF cta.html 은 CTA.tsx 이식본이라 회전·로고 등장 박자가 같다(로고 0f·문구 18f·주소 34f).
 */
const TILT_FRAMES = 24;
const REVEAL_HIT = 18;
export const HfCta: React.FC<{ mute?: boolean }> = ({ mute }) => (
  <AbsoluteFill style={{ background: "#0E73C3" }}>
    <HfVideo name="cta" />
    <Narration id="cta" mute={mute} />
    {mute ? null : (
      <Sequence name="효과음 cta-reveal" from={TILT_FRAMES - 1 - REVEAL_HIT} durationInFrames={48}>
        <Audio src={staticFile("sfx/cta-reveal.wav")} />
      </Sequence>
    )}
  </AbsoluteFill>
);
