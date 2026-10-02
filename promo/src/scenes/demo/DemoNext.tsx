import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { SplitScreen } from "../../components/SplitScreen";
import { DemoNarration, Sfx } from "../../audio-demo";
import { demoScene, demoSceneFrames } from "../../script";
import { requireDemoShots } from "../../demo-shots";
import { C } from "../../theme";
import { RectMark, TabletScreen, TabletStage, rectToPhoto } from "./TabletView";
import { CaptionBand } from "./parts";

/**
 * 다음 사람 — 앞 행 가림. 좌우 분할(홍보편 SplitScreen 재사용).
 *   왼쪽 = 첫 방문자가 쓴 행(firstRow.marks.writtenRow 를 짚는다)
 *   오른쪽 = 두 번째 방문자가 보는 같은 한 장 — 앞 행이 가려져 있다(secondView.marks.hiddenRow),
 *           열린 줄은 둘째 행(secondView.marks.openRow)
 * 전송 직후 화면이 스스로 처음으로 돌아가는 순간 = 짧은 「휙」(whoosh-out).
 * 🔴 가림은 제품 동작(SetVisible) 그대로의 캡처다 — 편집으로 가리지 않는다. 테두리는 짚기만 한다.
 */
const S = demoScene("next");
const TOTAL = demoSceneFrames("next");
export const NEED_NEXT = {
  firstRow: ["writtenRow"],
  secondView: ["hiddenRow", "openRow"],
};
const RATIO = 0.5;
const PANE_W = Math.round(1920 * RATIO);
const ZOOM = 2.3;
const SPLIT_AT = 6;
const HIDDEN_AT = 40;
const OPEN_AT = 78;

export const DemoNext: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const frame = useCurrentFrame();
  const { firstRow, secondView } = requireDemoShots("next", NEED_NEXT);
  const fWritten = rectToPhoto(firstRow, firstRow.marks.writtenRow);
  const fHidden = rectToPhoto(secondView, secondView.marks.hiddenRow);
  const fOpen = rectToPhoto(secondView, secondView.marks.openRow);
  const focusR: [number, number] = [(fHidden[0] + fOpen[0]) / 2, (fHidden[1] + fOpen[1]) / 2];
  const op = (at: number) =>
    interpolate(frame, [at, at + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <Stage variant="light" logo="none">
      <DemoNarration id="next" mute={mute} />
      <Sfx name="whoosh-out" at={0} mute={mute} volume={0.6} />
      <SplitScreen
        ratio={RATIO}
        from={SPLIT_AT}
        left={
          <TabletStage paneWidth={PANE_W} focus={fWritten} zoom={ZOOM} push={[1, 1.03]} durationInFrames={TOTAL}>
            <TabletScreen shot={firstRow}>
              <RectMark rect={firstRow.marks.writtenRow} color={C.blue} opacity={op(SPLIT_AT + 10) * 0.8} />
            </TabletScreen>
          </TabletStage>
        }
        right={
          <TabletStage paneWidth={1920 - PANE_W} focus={focusR} zoom={ZOOM} push={[1, 1.03]} durationInFrames={TOTAL}>
            <TabletScreen shot={secondView}>
              <RectMark rect={secondView.marks.hiddenRow} color={C.ink} opacity={op(HIDDEN_AT) * 0.7} />
              <RectMark rect={secondView.marks.openRow} color={C.blue} opacity={op(OPEN_AT) * 0.85} />
            </TabletScreen>
          </TabletStage>
        }
      />
      <CaptionBand lines={S.captions} />
    </Stage>
  );
};
