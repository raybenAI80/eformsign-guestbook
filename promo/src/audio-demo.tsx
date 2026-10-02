import React from "react";
import { Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { DUCK, targetDbAt } from "./audio";
import { DEMO_SCENES, type DemoSceneId } from "./script";
import voiceDemo from "./voice-durations-demo.json";

/**
 * 실제 화면 편(Demo53) 소리 — 나레이션·BGM·효과음.
 *
 * 🔴 본편 `src/audio.tsx` 는 고치지 않는다(Main60 무변경). 덕킹 **규칙**(DUCK 레벨·어택·릴리스,
 *    「나레이션 덕킹과 첫 장면 효과음 상한 중 낮은 쪽」)은 그쪽 `DUCK`·`targetDbAt` 을 그대로 불러
 *    쓰고, 구간(나레이션 창)만 demo 세트(`voice-durations-demo.json` + `DEMO_SCENES`)에서 만든다.
 * BGM = 본편 `bgm/track.mp3`(60초)를 53.1초에 맞춰 **끝 페이드**(END_FADE_SEC).
 */
const VOICE = voiceDemo as Record<string, number>;
const db = (v: number) => Math.pow(10, v / 20);
/** BGM 끝 페이드 길이(초) — track.mp3 는 60초라 그대로 두면 53.1초에서 뚝 끊긴다 */
export const END_FADE_SEC = 1.6;

export const demoVoiceSeconds = (id: DemoSceneId): number | null =>
  typeof VOICE[id] === "number" ? VOICE[id] : null;

/** demo 나레이션 = public/voice/demo-<id>.mp3, 장면 시작과 함께 */
export const DemoNarration: React.FC<{ id: DemoSceneId; mute?: boolean }> = ({ id, mute = false }) => {
  if (mute || demoVoiceSeconds(id) === null) return null;
  return <Audio src={staticFile(`voice/demo-${id}.mp3`)} />;
};

export const demoNarrationWindows = (): Array<[number, number]> =>
  DEMO_SCENES.flatMap((s) => {
    const len = demoVoiceSeconds(s.id);
    return len === null ? [] : [[s.startSec, s.startSec + len] as [number, number]];
  });

/** 본편 duckKeyframes 와 같은 표본·보정 — 구간만 demo 세트 */
export const demoDuckKeyframes = (totalSec: number): Array<{ t: number; v: number }> => {
  const windows = demoNarrationWindows();
  const sfxEnd = DEMO_SCENES.length ? DEMO_SCENES[0].endSec : 0;
  const times = [0, sfxEnd, sfxEnd + DUCK.releaseSec, totalSec - END_FADE_SEC, totalSec];
  for (const [s, e] of windows) times.push(s - DUCK.attackSec, s, e, e + DUCK.releaseSec);
  const pts = times
    .map((t) => Math.max(0, Math.min(totalSec, t)))
    .sort((a, b) => a - b)
    .map((t) => ({ t, v: db(targetDbAt(t, windows, sfxEnd)) }));
  const out: Array<{ t: number; v: number }> = [];
  for (const p of pts) {
    if (out.length && p.t <= out[out.length - 1].t) {
      out[out.length - 1].v = Math.min(out[out.length - 1].v, p.v);
      continue;
    }
    out.push(p);
  }
  return out;
};

export const DemoBgm: React.FC<{ mute?: boolean }> = ({ mute = false }) => {
  const { fps, durationInFrames } = useVideoConfig();
  if (mute) return null;
  const totalSec = durationInFrames / fps;
  const kf = demoDuckKeyframes(totalSec);
  const ts = kf.map((p) => p.t);
  const vs = kf.map((p) => p.v);
  return (
    <Audio
      src={staticFile("bgm/track.mp3")}
      volume={(frame) => {
        const t = frame / fps;
        const duck = interpolate(t, ts, vs, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const fade = interpolate(t, [totalSec - END_FADE_SEC, totalSec], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return duck * fade;
      }}
    />
  );
};

/** 본편 효과음 재사용(public/sfx). 탭 = ui-tick */
export type DemoSfxName = "ui-tick" | "whoosh-in" | "whoosh-out" | "stack-shimmer" | "cta-reveal";

export const Sfx: React.FC<{ name: DemoSfxName; at: number; mute?: boolean; volume?: number; len?: number }> = ({
  name,
  at,
  mute = false,
  volume = 0.8,
  len = 45,
}) =>
  mute ? null : (
    <Sequence name={`효과음 ${name}`} from={Math.max(0, Math.round(at))} durationInFrames={len}>
      <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
    </Sequence>
  );
