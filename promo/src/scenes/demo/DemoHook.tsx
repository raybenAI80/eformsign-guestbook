import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { Caption } from "../../components/Caption";
import { DemoNarration } from "../../audio-demo";
import { demoScene, demoSceneFrames } from "../../script";
import { requireDemoShots } from "../../demo-shots";
import { TabletScreen, TabletStage, rectToPhoto } from "./TabletView";

/**
 * 훅 — 「수기 방명록을 이폼사인으로 바꾸면 / 실제 화면은 이렇습니다」.
 * 검은 바탕 → 기기 바탕(gen-03-plate) 위 실캡처(S00 동의 통과 직후 빈 명부) 페이드인.
 * 시작 배율 = 헤더 밴드 「방문자 기록부」가 읽히는 배율, 장면 내내 살짝 당긴다(1.00→1.05).
 *
 * 🔴 S00 은 746×926(0.81) 이고 기기 화면 사각형은 0.55 라 screenCrop 이 좌우를 잘라 담는다
 *    (marks.focus 를 viewport 로 넘겨 「방문자 기록부」 제목·명부 가운데를 살린다).
 */
const S = demoScene("hook");
const TOTAL = demoSceneFrames("hook");
const NEED = { screen: ["header", "focus"] };
/** 헤더가 읽히는 배율 — 기기 화면 높이(약 386px)가 화면 세로를 거의 채운다 */
const ZOOM = 2.55;
const FADE_IN = 22;

export const DemoHook: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const frame = useCurrentFrame();
  const { screen } = requireDemoShots("hook", NEED);
  const shot = { ...screen, viewport: screen.marks.focus };
  /* 초점 = 헤더와 화면 가운데 사이(헤더가 위쪽 1/4 에 오도록) */
  const h = rectToPhoto(shot, screen.marks.header);
  const c = rectToPhoto(shot, { x: 0, y: 0, w: screen.width, h: screen.height });
  const focus: [number, number] = [c[0] * 0.6 + h[0] * 0.4, c[1] * 0.55 + h[1] * 0.45];
  const fade = interpolate(frame, [0, FADE_IN], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <Stage variant="photo" logo="none">
      <DemoNarration id="hook" mute={mute} />
      <AbsoluteFill style={{ background: "#000000" }} />
      <AbsoluteFill style={{ opacity: fade }}>
        <TabletStage focus={focus} zoom={ZOOM} push={[1, 1.05]} durationInFrames={TOTAL}>
          <TabletScreen shot={shot} />
        </TabletStage>
      </AbsoluteFill>
      {/* 자막 가독 — 아래쪽만 어둡게 */}
      <AbsoluteFill
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.45) 22%, rgba(0,0,0,0) 40%)",
        }}
      />
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 96 }}>
        <Caption lines={S.captions} from={14} size={72} tone="dark" />
      </AbsoluteFill>
    </Stage>
  );
};
