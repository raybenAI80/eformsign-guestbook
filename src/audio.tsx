import React from "react";
import { Audio, interpolate, staticFile, useVideoConfig } from "remotion";
import { SCENES } from "./script";
import voiceJson from "../public/voice/voice.json";

/**
 * BGM 트랙과 자동 덕킹.
 *
 * 왜 장면이 아니라 루트 컴포지션에 얹는가
 *   BGM 은 60초 하나로 이어져야 한다. 장면별 <Audio> 로 쪼개면 장면 경계마다
 *   끊기고 위상이 어긋난다. 그래서 Main60 이 직접 들고 있다.
 *
 * 🔴 덕킹 구간은 **voice.json 을 읽어 자동으로** 잡는다.
 *   원고나 화자가 바뀌면 tools/voice-build.mjs 가 voice.json 의 seconds 를 다시 쓰고,
 *   이 파일은 그 값을 그대로 따라간다 — 손으로 고칠 표가 없다.
 *   「어느 장면에 나레이션이 있다/없다」를 코드에 적어두지 않는다(훅에 나레이션이
 *   생기는 개편이 예정돼 있다 — 2026-09-21).
 *
 * 덕킹 설계 근거
 *   나레이션은 -16 LUFS 로 정합돼 있다(tools/voice-post.mjs). BGM 은 말소리 아래
 *   -14~-18 dB 에 있어야 들리되 가리지 않는다. 나레이션이 있는 구간에서 -12 dB,
 *   없는 구간에서 -6 dB 로 두면 파일 자체(-20 LUFS)와 합쳐 그 범위에 들어간다.
 *
 * 🔴 문장 사이 휴지(0.3~0.4초)에서는 BGM 을 올리지 않는다.
 *   릴리스가 600ms 라 0.4초 휴지에서는 어차피 다 못 올라오고, 올렸다 내리면
 *   「펌핑」으로 들린다. 덕킹 단위는 **문장이 아니라 장면**이다.
 *
 * 🔴 효과음 구간(첫 장면 = 훅)은 상한을 따로 둔다 — 알림음 3발이 BGM 에 묻히면 안 된다.
 *   나레이션 덕킹과 이 상한 중 **더 낮은 쪽**이 적용된다.
 */
export const DUCK = {
  /** 나레이션이 없는 구간 */
  baseDb: -6,
  /** 나레이션 구간 */
  narrationDb: -12,
  /** 효과음 구간(첫 장면) 상한 */
  sfxCapDb: -9,
  /** 덕킹 어택·릴리스(초) */
  attackSec: 0.15,
  releaseSec: 0.6,
};

const db = (v: number) => Math.pow(10, v / 20);

type Scenes = Record<string, { seconds: number | null }>;
const VOICE_SCENES = (voiceJson as { scenes: Scenes }).scenes;

/** voice.json 의 길이 — 없으면 나레이션이 없는 장면 */
export const voiceLength = (id: string): number | null => {
  const v = VOICE_SCENES[id];
  return v && typeof v.seconds === "number" ? v.seconds : null;
};

/** 나레이션이 울리는 구간 [시작초, 끝초]. 나레이션은 장면 시작과 함께 재생된다 */
export const narrationWindows = (): Array<[number, number]> =>
  SCENES.flatMap((s) => {
    const len = voiceLength(s.id);
    return len === null ? [] : [[s.startSec, s.startSec + len] as [number, number]];
  });

/** 효과음 구간 = 첫 장면 전체 */
export const sfxWindowEnd = (): number => (SCENES.length ? SCENES[0].endSec : 0);

/** 그 시각의 목표 레벨(dB). 나레이션 덕킹과 효과음 상한 중 낮은 쪽 */
export const targetDbAt = (t: number, windows = narrationWindows(), sfxEnd = sfxWindowEnd()): number => {
  const speaking = windows.some(([s, e]) => t >= s && t <= e);
  const level = speaking ? DUCK.narrationDb : DUCK.baseDb;
  return t <= sfxEnd ? Math.min(level, DUCK.sfxCapDb) : level;
};

/**
 * BGM 볼륨 키프레임. 시간이 단조 증가하도록 만들어 interpolate 에 바로 넘긴다.
 * 순수 함수라 도구에서 그대로 불러 표로 찍을 수 있다(tools/check-mix.mjs).
 */
export const duckKeyframes = (totalSec: number): Array<{ t: number; v: number }> => {
  const windows = narrationWindows();
  const sfxEnd = sfxWindowEnd();

  // 레벨이 바뀔 수 있는 시각만 표본으로 잡는다
  const times = [0, sfxEnd, sfxEnd + DUCK.releaseSec, totalSec];
  for (const [s, e] of windows) {
    times.push(s - DUCK.attackSec, s, e, e + DUCK.releaseSec);
  }

  const pts = times
    .map((t) => Math.max(0, Math.min(totalSec, t)))
    .sort((a, b) => a - b)
    .map((t) => ({ t, v: db(targetDbAt(t, windows, sfxEnd)) }));

  // 시간 단조 증가 보정 — 같은 시각이 겹치면 더 낮은 쪽을 남긴다(덕킹은 안전한 방향이 아래다)
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

/** 60초 BGM. mute 면 아예 렌더하지 않는다(무음판) */
export const Bgm: React.FC<{ mute?: boolean }> = ({ mute = false }) => {
  const { fps, durationInFrames } = useVideoConfig();
  if (mute) return null;
  const totalSec = durationInFrames / fps;
  const kf = duckKeyframes(totalSec);
  const ts = kf.map((p) => p.t);
  const vs = kf.map((p) => p.v);
  return (
    <Audio
      src={staticFile("bgm/track.mp3")}
      volume={(frame) =>
        interpolate(frame / fps, ts, vs, { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      }
    />
  );
};
