import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { DEMO_SCENES, sec, type DemoSceneId } from "../script";
import { DemoBgm } from "../audio-demo";
import { DemoHook } from "../scenes/demo/DemoHook";
import { DemoArrive } from "../scenes/demo/DemoArrive";
import { DemoFill } from "../scenes/demo/DemoFill";
import { DemoNext } from "../scenes/demo/DemoNext";
import { DemoStack } from "../scenes/demo/DemoStack";
import { DemoManage } from "../scenes/demo/DemoManage";
import { DemoBranch } from "../scenes/demo/DemoBranch";
import { DemoCTA } from "../scenes/demo/DemoCTA";

/**
 * 실제 화면 편 Demo53(1920×1080·30fps). 장면 순서·길이 = DEMO_SCENES 의 startSec/endSec
 * — 그 값은 `src/scene-durations-demo.json`(나레이션 실측 파생)에서 script.ts 가 채운다. 여기서 길이를 적지 않는다.
 * 무음판 = inputProps { mute: true }.
 * 🔴 캡처가 필요한 장면(arrive·fill·next·stack·manage)은 `src/demo-shots.json` 의 소재가 ready 가
 *    아니면 그 장면 프레임에서 렌더가 멈춘다(src/demo-shots.ts). hook·branch·cta 는 지금 렌더된다.
 */
export interface DemoProps {
  mute?: boolean;
}

const COMPONENTS: Record<DemoSceneId, React.FC<{ mute?: boolean }>> = {
  hook: DemoHook,
  arrive: DemoArrive,
  fill: DemoFill,
  next: DemoNext,
  stack: DemoStack,
  manage: DemoManage,
  branch: DemoBranch,
  cta: DemoCTA,
};

export const Demo53: React.FC<DemoProps> = ({ mute = false }) => (
  <AbsoluteFill style={{ background: "#000000" }}>
    <DemoBgm mute={mute} />
    {DEMO_SCENES.map((s) => {
      const Comp = COMPONENTS[s.id];
      return (
        <Sequence key={s.id} name={s.label} from={sec(s.startSec)} durationInFrames={sec(s.endSec - s.startSec)}>
          <Comp mute={mute} />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
