import React from "react";
import { Audio, staticFile } from "remotion";
import type { SceneId } from "../script";
import voice from "../voice-durations.json";

/** tools/tts.mjs 가 만든 음성 길이표. 없는 장면은 음성이 없다는 뜻 */
export const VOICE_DURATIONS = voice as Record<string, number>;

export const voiceSeconds = (id: SceneId | string): number | null =>
  typeof VOICE_DURATIONS[id] === "number" ? VOICE_DURATIONS[id] : null;

/**
 * 장면 나레이션.
 * 무음판은 컴포지션 inputProps 의 mute:boolean 하나로 갈라진다 —
 * 같은 장면 컴포넌트를 그대로 쓰고 오디오만 빠진다.
 */
export const Narration: React.FC<{
  id: SceneId | string;
  mute?: boolean;
  volume?: number;
}> = ({ id, mute = false, volume = 1 }) => {
  if (mute) return null;
  if (voiceSeconds(id) === null) return null;
  return <Audio src={staticFile(`voice/${id}.mp3`)} volume={volume} />;
};
