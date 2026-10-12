import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Paper } from "../scenes/Paper";
import { Designer } from "../scenes/Designer";
import { Fill } from "../scenes/Fill";
import { Manage } from "../scenes/Manage";
import { Branch } from "../scenes/Branch";
import { Hook } from "../scenes/Hook";
import { HfHook, HfRepeat, HfCta } from "../scenes/hf/HfScenes";
import { SCENES, sceneFrames, sec, type SceneId } from "../script";
import { Bgm } from "../audio";

/** 무음판은 이 prop 하나로 갈라진다 */
export interface PromoProps {
  mute?: boolean;
}

/** 🔴 v4.0 A안(2026-10-12): hook·repeat·cta 화면 = HyperFrames 렌더본(무음) — src/scenes/hf/HfScenes.tsx. 원래 Hook·Repeat·CTA 는 Preview9·Cut15·Loop30·Demo53 이 계속 쓴다 */
const COMPONENTS: Record<SceneId, React.FC<{ mute?: boolean }>> = {
  hook: HfHook,
  paper: Paper,
  designer: Designer,
  fill: Fill,
  repeat: HfRepeat,
  manage: Manage,
  branch: Branch,
  cta: HfCta,
};

export const Main60: React.FC<PromoProps> = ({ mute = false }) => (
  <AbsoluteFill style={{ background: "#FFFFFF" }}>
    {/* BGM 은 장면이 아니라 여기 — 60초 하나로 이어져야 한다. 덕킹은 src/audio.tsx */}
    <Bgm mute={mute} />
    {SCENES.map((s) => {
      const Comp = COMPONENTS[s.id];
      return (
        <Sequence
          key={s.id}
          name={s.label}
          from={sec(s.startSec)}
          durationInFrames={sec(s.endSec - s.startSec)}
        >
          <Comp mute={mute} />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);

/** Hook + Paper 만 이어 붙인 스타일 확정용 시안. 길이는 script.ts 에서 파생된다 */
export const Preview9: React.FC<PromoProps> = ({ mute = false }) => (
  <AbsoluteFill style={{ background: "#FFFFFF" }}>
    <Sequence name="Hook" from={0} durationInFrames={sceneFrames("hook")}>
      <Hook mute={mute} />
    </Sequence>
    <Sequence
      name="Paper"
      from={sceneFrames("hook")}
      durationInFrames={sceneFrames("paper")}
    >
      <Paper mute={mute} />
    </Sequence>
  </AbsoluteFill>
);
