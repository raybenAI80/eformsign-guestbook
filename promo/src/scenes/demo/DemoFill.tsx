import React from "react";
import { Sequence, interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { Cut } from "../../components/ShotView";
import { DemoNarration, Sfx } from "../../audio-demo";
import { demoScene, demoSceneFrames } from "../../script";
import { requireDemoShots, type ReadyShot } from "../../demo-shots";
import type { HandKey, Pt } from "../../hand";
import { C } from "../../theme";
import { RectMark, TabletScreen, TabletStage, offscreen, rectToPhoto, shotToPhoto } from "./TabletView";
import { CaptionBand } from "./parts";

/**
 * 적고·체크·서명·전송 — 성명 → 연락처 → 방문 목적 체크 1개 → 서명 획 → 「전송」 안내 띠 점등 → 전송 탭.
 * 화면 = 단계 캡처 5장(가상 인물 입력값)을 손 동작에 맞춰 컷으로 잇는다. 손이 칸을 누른 **뒤**
 * 그 칸이 채워진 캡처로 넘어간다(누르기 전에 글자가 먼저 나타나지 않게).
 *
 * 🔴 다섯 장의 자르기는 **첫 장(name)의 viewport 하나**로 통일한다 — 캡처마다 viewport 가 다르면
 *    컷마다 화면이 미세하게 튄다. 캡처 레인은 같은 창 크기로 찍는다(768×1024 결정적 캡처).
 * 효과음 = 탭 3회(성명·방문 목적·전송). 서명 스크래치는 본편 효과음 6종에 없어 넣지 않았다.
 */
const S = demoScene("fill");
const TOTAL = demoSceneFrames("fill");
export const NEED_FILL = {
  start: [],
  name: ["nameCell"],
  phone: ["phoneCell"],
  purpose: ["purposeCheck"],
  sign: ["signBox"],
  sendBand: ["sendBand", "sendButton"],
};
const ZOOM = 2.0;
/** 손이 누르는 프레임(그 칸이 채워진 캡처는 누른 뒤 CUT_LAG 프레임에 뜬다) */
const T = { name: 24, phone: 78, purpose: 132, sign: 186, send: 246 };
const CUT_LAG = 4;

export const DemoFill: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const frame = useCurrentFrame();
  const shots = requireDemoShots("fill", NEED_FILL);
  const vp = shots.start.viewport;
  const same = (s: ReadyShot): ReadyShot => ({ ...s, viewport: vp });
  const start = same(shots.start);
  const name = same(shots.name);
  const phone = same(shots.phone);
  const purpose = same(shots.purpose);
  const sign = same(shots.sign);
  const band = same(shots.sendBand);

  const pName = rectToPhoto(name, name.marks.nameCell);
  const pPhone = rectToPhoto(phone, phone.marks.phoneCell);
  const pPurpose = rectToPhoto(purpose, purpose.marks.purposeCheck);
  const sb = sign.marks.signBox;
  const sA = shotToPhoto(sign, [sb.x + sb.w * 0.2, sb.y + sb.h / 2]);
  const sB = shotToPhoto(sign, [sb.x + sb.w * 0.8, sb.y + sb.h / 2]);
  const sMid: Pt = [(sA[0] + sB[0]) / 2, (sA[1] + sB[1]) / 2];
  const pSend = rectToPhoto(band, band.marks.sendButton);
  const keys: HandKey[] = [
    { kind: "hover", t: 0, at: [pName[0] + 10, pName[1] + 14] },
    { kind: "tap", t: T.name, at: pName },
    { kind: "tap", t: T.phone, at: pPhone },
    { kind: "tap", t: T.purpose, at: pPurpose },
    { kind: "sign", t: T.sign, at: sMid, half: Math.hypot(sB[0] - sA[0], sB[1] - sA[1]) / 2 },
    { kind: "hover", t: T.send - 26, at: [pSend[0] + 16, pSend[1] + 24] },
    { kind: "tap", t: T.send, at: pSend },
    { kind: "away", t: TOTAL - 1, at: offscreen(pSend) },
  ];
  const focus = shotToPhoto(start, [start.width / 2, start.height / 2]);

  /* 컷: [캡처, 시작 프레임]. start = 빈 열린 행(arrive 와 같은 상태), 나머지 = 그 단계가 끝난 상태 */
  const cuts: Array<[ReadyShot, number]> = [
    [start, 0],
    [name, T.name + CUT_LAG],
    [phone, T.phone + CUT_LAG],
    [purpose, T.purpose + CUT_LAG],
    [sign, T.sign + CUT_LAG],
    [band, T.sign + 24],
  ];
  /* 「전송」 안내 띠 점등을 한 번 더 짚는 테두리 — 띠 자체는 제품 화면(캡처)에 있다 */
  const bandMark = interpolate(frame, [T.sign + 30, T.sign + 42, T.send, T.send + 10], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Stage variant="light" logo="none">
      <DemoNarration id="fill" mute={mute} />
      <Sfx name="ui-tick" at={T.name - 1} mute={mute} volume={0.55} />
      <Sfx name="ui-tick" at={T.purpose - 1} mute={mute} volume={0.55} />
      <Sfx name="ui-tick" at={T.send - 1} mute={mute} volume={0.55} />
      <TabletStage focus={focus} zoom={ZOOM} push={[1, 1.04]} durationInFrames={TOTAL} handKeys={keys}>
        {cuts.map(([shot, at], i) => {
          const next = cuts[i + 1]?.[1] ?? TOTAL;
          return (
            <Sequence key={`${shot.file}-${i}`} from={at} durationInFrames={next - at + 6}>
              <Cut fade={i === 0 ? 0 : 5}>
                <TabletScreen shot={shot}>
                  {shot === band ? <RectMark rect={band.marks.sendBand} color={C.blue} opacity={bandMark} /> : null}
                </TabletScreen>
              </Cut>
            </Sequence>
          );
        })}
      </TabletStage>
      <CaptionBand lines={S.captions} />
    </Stage>
  );
};
