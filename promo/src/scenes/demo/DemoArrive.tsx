import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { DemoNarration, Sfx } from "../../audio-demo";
import { demoScene, demoSceneFrames } from "../../script";
import { requireDemoShots } from "../../demo-shots";
import type { HandKey } from "../../hand";
import { C } from "../../theme";
import { RectMark, TabletScreen, TabletStage, offscreen, rectToPhoto, shotToPhoto } from "./TabletView";
import { CaptionBand } from "./parts";

/**
 * 열린 한 줄만 입력 — 기기 전체. 열린 행 1개만 입력 가능, 나머지 행은 빈 칸.
 * 손 층(hand-03)이 화면 밖에서 성명 칸으로 들어와 한 번 누른다(탭 효과음).
 * 열린 행은 옅은 파란 테두리로 한 번 짚는다(제품 화면 위 강조는 이것 하나).
 */
const S = demoScene("arrive");
const TOTAL = demoSceneFrames("arrive");
export const NEED_ARRIVE = { screen: ["openRow", "nameCell"] };
const ZOOM = 1.6;
const MARK_AT = 26;
const HOVER_AT = 78;
const TAP_AT = 112;

export const DemoArrive: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const frame = useCurrentFrame();
  const { screen } = requireDemoShots("arrive", NEED_ARRIVE);
  const name = rectToPhoto(screen, screen.marks.nameCell);
  const center = shotToPhoto(screen, [screen.width / 2, screen.height / 2]);
  const keys: HandKey[] = [
    { kind: "away", t: 0, at: offscreen(name) },
    { kind: "away", t: HOVER_AT - 40, at: offscreen(name) },
    { kind: "hover", t: HOVER_AT, at: [name[0] + 10, name[1] + 14] },
    { kind: "tap", t: TAP_AT, at: name },
    { kind: "hover", t: TOTAL - 1, at: [name[0] + 8, name[1] + 12] },
  ];
  const mark = interpolate(frame, [MARK_AT, MARK_AT + 14, TOTAL - 20, TOTAL], [0, 1, 1, 0.6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <Stage variant="light" logo="none">
      <DemoNarration id="arrive" mute={mute} />
      <Sfx name="ui-tick" at={TAP_AT - 1} mute={mute} volume={0.55} />
      <TabletStage focus={center} zoom={ZOOM} push={[1, 1.06]} durationInFrames={TOTAL} handKeys={keys}>
        <TabletScreen shot={screen}>
          <RectMark rect={screen.marks.openRow} color={C.blue} opacity={mark * 0.85} />
        </TabletScreen>
      </TabletStage>
      <CaptionBand lines={S.captions} />
    </Stage>
  );
};
