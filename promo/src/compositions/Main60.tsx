import React from "react";
import { AbsoluteFill, Freeze, Sequence, useCurrentFrame } from "remotion";
import { Paper } from "../scenes/Paper";
import { Designer } from "../scenes/Designer";
import { Fill } from "../scenes/Fill";
import { Manage } from "../scenes/Manage";
import { Branch } from "../scenes/Branch";
import { Hook } from "../scenes/Hook";
import { HfHook, HfRepeat, HfCta } from "../scenes/hf/HfScenes";
import { SCENES, sceneFrames, sec, type SceneId } from "../script";
import { Bgm } from "../audio";
import { CameraFrameOffset } from "../components/BookCamera";

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

/**
 * v4.1(2026-10-12) — HF↔Remotion 경계 크로스페이드. 0.3초(9f).
 * 🔴 총 길이·HF 장면 길이·장면 시작 프레임·나레이션 시작 프레임은 그대로다. 겹침은 **Remotion 장면이 흡수**한다:
 *   · hook(HF)→paper : Paper 0프레임을 경계 9f 앞부터 겹쳐 들인다(무음). 사진 줌만은 CameraFrameOffset
 *                      으로 −9..−1 프레임을 돌려 옛 훅 곡선 꼬리로 움직인다 → 0프레임에서 C1 연속
 *                      (tools/check-zoom-continuity.mjs 가 판정).
 *   · fill→repeat(HF): Fill 마지막 프레임을 경계 뒤 9f 동안 HF 위에 남겨 걷어 낸다(무음).
 * repeat→manage·branch→cta 는 색이 이어지므로 하드컷 유지(10-12 오케스트레이터 판정).
 */
export const XFADE_FRAMES = 9;
/** 경계 이름 → 방향. 숫자 프레임은 scene-durations.json 에서 파생 */
export const XFADE_SEAMS = [
  { from: "hook", to: "paper", kind: "lead-in" },
  { from: "fill", to: "repeat", kind: "tail-out" },
] as const;

const seamFrame = (to: SceneId): number => {
  const s = SCENES.find((x) => x.id === to)!;
  return sec(s.startSec);
};

/** k = 0..XFADE-1 → 들어오는 쪽 불투명도 (k+1)/(XFADE+1): 0.1 … 0.9 */
const inOpacity = (k: number) => (k + 1) / (XFADE_FRAMES + 1);

const LeadIn: React.FC<{ Comp: React.FC<{ mute?: boolean }> }> = ({ Comp }) => {
  const k = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: inOpacity(k) }}>
      <CameraFrameOffset.Provider value={k - XFADE_FRAMES}>
        <Freeze frame={0}>
          <Comp mute />
        </Freeze>
      </CameraFrameOffset.Provider>
    </AbsoluteFill>
  );
};

const TailOut: React.FC<{ Comp: React.FC<{ mute?: boolean }>; lastFrame: number }> = ({ Comp, lastFrame }) => {
  const k = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: 1 - inOpacity(k) }}>
      <Freeze frame={lastFrame}>
        <Comp mute />
      </Freeze>
    </AbsoluteFill>
  );
};

const Crossfades: React.FC = () => (
  <>
    {XFADE_SEAMS.map((x) => {
      const at = seamFrame(x.to);
      if (x.kind === "lead-in") {
        return (
          <Sequence key={x.to} name={`크로스페이드 ${x.from}→${x.to}`} from={at - XFADE_FRAMES} durationInFrames={XFADE_FRAMES}>
            <LeadIn Comp={COMPONENTS[x.to]} />
          </Sequence>
        );
      }
      return (
        <Sequence key={x.to} name={`크로스페이드 ${x.from}→${x.to}`} from={at} durationInFrames={XFADE_FRAMES}>
          <TailOut Comp={COMPONENTS[x.from]} lastFrame={sceneFrames(x.from) - 1} />
        </Sequence>
      );
    })}
  </>
);

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
    <Crossfades />
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
