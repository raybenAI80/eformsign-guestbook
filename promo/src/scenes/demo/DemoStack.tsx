import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { CaptureBox, Highlight } from "../../components/ShotView";
import { DemoNarration, Sfx } from "../../audio-demo";
import { demoScene, demoSceneFrames } from "../../script";
import { requireDemoShots } from "../../demo-shots";
import { shotLayer } from "../../shots-scenes";
import { C, EASE } from "../../theme";
import { CaptionBand, boxFrame } from "./parts";

/**
 * 하루 한 장 — PC 이폼사인 문서함(정식 UI). 문서 **1건**(inbox.marks.docRow)을 짚고,
 * 그 행에서 선이 뻗어 완료 PDF 미리보기(10행이 다 보이는 완료본, preview.rows ≥ 10)가 옆에 내려앉는다.
 * 🔴 완료본에는 모든 행이 보이는 것이 정상(작성 화면의 행 가림은 완료 PDF 에 적용되지 않는다).
 * 카드 착지음 = stack-shimmer.
 */
const S = demoScene("stack");
const TOTAL = demoSceneFrames("stack");
export const NEED_STACK = {
  inbox: ["docRow"],
  preview: ["page", "#rows:10"],
};
const INBOX_BOX = { x: 80, y: 90, w: 1060, h: 640 };
const PREV_BOX = { x: 1240, y: 60, w: 600, h: 780 };
const ROW_AT = 24;
const LINE_AT = 56;
const CARD_AT = 72;
const LAND = 18;

export const DemoStack: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const frame = useCurrentFrame();
  const { inbox, preview } = requireDemoShots("stack", NEED_STACK);
  const ib = boxFrame(inbox, INBOX_BOX);
  const pv = boxFrame({ ...preview, viewport: preview.viewport ?? preview.marks.page }, PREV_BOX);
  const row = inbox.marks.docRow;
  const a = ib.toBox(row.x + row.w, row.y + row.h / 2);
  const b: [number, number] = [PREV_BOX.x - 6, PREV_BOX.y + 120];
  const line = interpolate(frame, [LINE_AT, LINE_AT + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const card = interpolate(frame, [CARD_AT, CARD_AT + LAND], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const inIn = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp", easing: EASE });
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.3;

  return (
    <Stage variant="light" logo="none">
      <DemoNarration id="stack" mute={mute} />
      <Sfx name="stack-shimmer" at={CARD_AT + LAND - 6} mute={mute} volume={0.7} />
      <div style={{ position: "absolute", left: INBOX_BOX.x, top: INBOX_BOX.y, opacity: inIn }}>
        <CaptureBox
          src={shotLayer(inbox.file).src}
          capture={ib.cap}
          crop={ib.crop}
          width={INBOX_BOX.w}
          height={INBOX_BOX.h}
        >
          <Highlight rect={row} from={ROW_AT} />
        </CaptureBox>
      </div>
      <AbsoluteFill>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <path
            d={`M ${a[0]} ${a[1]} C ${a[0] + 70} ${a[1]}, ${b[0] - 70} ${b[1]}, ${b[0]} ${b[1]}`}
            stroke={C.blue}
            strokeWidth={4}
            fill="none"
            opacity={0.7 * line}
            strokeDasharray={len}
            strokeDashoffset={len * (1 - line)}
          />
        </svg>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: PREV_BOX.x,
          top: PREV_BOX.y,
          opacity: card,
          transform: `translateY(${(1 - card) * -60}px)`,
        }}
      >
        <CaptureBox
          src={shotLayer(preview.file).src}
          capture={pv.cap}
          crop={pv.crop}
          width={PREV_BOX.w}
          height={PREV_BOX.h}
          radius={10}
        />
      </div>
      <CaptionBand lines={S.captions} />
    </Stage>
  );
};
