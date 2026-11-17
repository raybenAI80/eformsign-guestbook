import React from "react";
import { Sequence } from "remotion";
import { Stage } from "../../components/Stage";
import { CaptureBox, Cursor, Cut, Highlight } from "../../components/ShotView";
import { DemoNarration, Sfx } from "../../audio-demo";
import { demoScene, demoSceneFrames } from "../../script";
import { requireDemoShots, rectCenterPt, type ReadyShot } from "../../demo-shots";
import { shotLayer } from "../../shots-scenes";
import { CaptionBand, boxFrame } from "./parts";

/**
 * 찾고·열고·내려받기 — 이폼사인 문서함 검색(이름으로) → PDF 미리보기 → 다운로드.
 * 세 장을 같은 상자에 크로스페이드로 잇고, 커서는 각 캡처의 표식 사이만 오간다(본편 Manage 와 같은 문법).
 * 운영시간 하루 단위 새 장은 자막 각주 한 줄(script.ts footnote)로만.
 */
const S = demoScene("manage");
const TOTAL = demoSceneFrames("manage");
export const NEED_MANAGE = {
  search: ["searchBox", "resultRow"],
  preview: ["page"],
  download: ["downloadButton"],
};
const BOX = { x: 210, y: 70, w: 1500, h: 760 };
const AT = { search: 0, preview: 66, download: 128 };
const FADE = 10;

const Panel: React.FC<{ shot: ReadyShot; children?: React.ReactNode }> = ({ shot, children }) => {
  const f = boxFrame(shot, BOX);
  return (
    <div style={{ position: "absolute", left: BOX.x, top: BOX.y }}>
      <CaptureBox src={shotLayer(shot.file).src} capture={f.cap} crop={f.crop} width={BOX.w} height={BOX.h}>
        {children}
      </CaptureBox>
    </div>
  );
};

export const DemoManage: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const { search, preview, download } = requireDemoShots("manage", NEED_MANAGE);
  const sb = rectCenterPt(search.marks.searchBox);
  const rr = rectCenterPt(search.marks.resultRow);
  const db = rectCenterPt(download.marks.downloadButton);
  return (
    <Stage variant="light" logo="none">
      <DemoNarration id="manage" mute={mute} />
      <Sfx name="ui-tick" at={14} mute={mute} volume={0.5} />
      <Sfx name="ui-tick" at={AT.preview - 8} mute={mute} volume={0.5} />
      <Sfx name="ui-tick" at={AT.download + 34} mute={mute} volume={0.5} />
      <Sequence from={AT.search} durationInFrames={AT.preview - AT.search + FADE}>
        <Panel shot={search}>
          <Highlight rect={search.marks.searchBox} from={6} />
          <Highlight rect={search.marks.resultRow} from={36} />
          <Cursor
            stops={[
              { at: 0, x: sb[0] + 120, y: sb[1] + 90 },
              { at: 14, x: sb[0], y: sb[1], click: true },
              { at: 40, x: rr[0], y: rr[1] },
              { at: 58, x: rr[0], y: rr[1], click: true },
            ]}
          />
        </Panel>
      </Sequence>
      <Sequence from={AT.preview} durationInFrames={AT.download - AT.preview + FADE}>
        <Cut fade={FADE}>
          <Panel shot={preview} />
        </Cut>
      </Sequence>
      <Sequence from={AT.download} durationInFrames={TOTAL - AT.download}>
        <Cut fade={FADE}>
          <Panel shot={download}>
            <Highlight rect={download.marks.downloadButton} from={16} />
            <Cursor
              stops={[
                { at: 0, x: db[0] - 160, y: db[1] + 120 },
                { at: 34, x: db[0], y: db[1], click: true },
              ]}
            />
          </Panel>
        </Cut>
      </Sequence>
      <CaptionBand lines={S.captions} footnote={S.footnote} />
    </Stage>
  );
};
