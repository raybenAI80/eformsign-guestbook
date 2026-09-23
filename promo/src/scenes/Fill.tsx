import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Stage } from "../components/Stage";
import { SplitScreen } from "../components/SplitScreen";
import { Inbox } from "../components/Inbox";
import { Photo } from "../components/Photo";
import { Caption } from "../components/Caption";
import { Narration } from "../components/Narration";
import { Cut, Occluder, QuadShot, StagePane } from "../components/ShotView";
import { scene, sceneFrames } from "../script";
import { inboxShot } from "../shots";
import {
  SHOT_FILES,
  fillSeq,
  geo,
  shotLayer,
  quadAspect,
  quadCentroid,
  screenCrop,
  screenQuad,
  trimInbox,
  type Rect,
  type ShotKey,
} from "../shots-scenes";

/**
 * 17–27초 — 로그인 없이 누구나 쓰고, 전송하면 그 순간 문서함에 완료 문서가 들어온다.
 *
 * 왼쪽 = 현장(생성 이미지 ③) + 태블릿 화면 자리에 **외부 작성 실캡처**를 원근 매핑.
 * 오른쪽 = 이폼사인 문서함 실캡처. 왼쪽에서 전송하는 순간 오른쪽에 행이 도착한다.
 *
 * 🔴 전송 확인 팝업(B04)은 제품 동작이다. 편집으로 지우지 않는다(기획서 10절 3).
 * 🔴 「채워지는 과정」 연속 캡처(B/fill-seq)가 있으면 앞 2/3 을 그것으로 채운다. 다만
 *    **전송 팝업·완료 화면까지 시퀀스에 들어 있지는 않으므로** 뒤 1/3 은 B04·B05 정지
 *    캡처로 맺는다(시퀀스만 쓰면 「전송하면 문서함에」라는 자막이 화면과 어긋난다).
 *    시퀀스가 없으면 빈 화면 → 채워진 화면 → 전송 팝업 → 완료 네 장으로 간다.
 */
const S = scene("fill");
const TOTAL = sceneFrames("fill");

const LEFT_RATIO = 0.58;
const PANE_W = Math.round(1920 * LEFT_RATIO);
const QUAD = screenQuad(3);
const SEQ = fillSeq();

/** 캡처 → 태블릿 화면 컷 순서. 시퀀스가 생기면 그쪽을 먼저 쓴다 */
const STILL_CUTS: { key: ShotKey; at: number; len: number }[] = [
  { key: "B02", at: 0, len: 92 },
  { key: "B03", at: 82, len: 88 },
  { key: "B04", at: 160, len: 70 },
  { key: "B05", at: 222, len: TOTAL - 222 },
];

/** 시퀀스를 쓸 때 뒤에 붙이는 맺음 컷 — 전송 팝업은 제품 동작이라 반드시 남긴다 */
const TAIL_CUTS: { key: ShotKey; at: number; len: number }[] = [
  { key: "B04", at: 196, len: 66 },
  { key: "B05", at: 256, len: TOTAL - 256 },
];

export const Fill: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const aspect = QUAD ? quadAspect(QUAD) : 1;
  const focus = QUAD ? quadCentroid(QUAD) : ([960, 540] as [number, number]);

  /* 🔴 자르기는 `screenCrop` 한 곳에서만 계산한다 — 캡처의 **내용 있는 영역**(viewport,
     측정값)을 화면 사각형 비율에 맞춰 담는다. 캡처 전체를 담던 v2 는 서식 아래 백지가
     화면의 절반을 먹었다. */
  const tabletCut = (
    rel: string,
    cap: { width: number; height: number; viewport?: Rect | null },
  ) =>
    QUAD ? (
      <QuadShot
        {...shotLayer(rel)}
        capture={cap}
        crop={screenCrop(cap, aspect)}
        corners={QUAD}
      />
    ) : null;

  return (
    <Stage variant="light" logo="none">
      <Narration id="fill" mute={mute} />
      <SplitScreen
        ratio={LEFT_RATIO}
        from={8}
        left={
          <StagePane paneWidth={PANE_W} paneHeight={1080} focus={focus} zoom={1.55}>
            <Photo src="gen-03.png" pan="in" from={1.0} to={1.05} durationInFrames={TOTAL}>
              {SEQ.frames.length > 0 ? (
                <>
                  {/* 채워지는 과정 — 연속 캡처를 그대로 넘긴다 */}
                  {SEQ.frames.map((rel, i) => {
                    const per = Math.max(1, Math.floor(196 / SEQ.frames.length));
                    return (
                      <Sequence key={rel} from={i * per} durationInFrames={per + 4}>
                        <Cut fade={i === 0 ? 0 : 4}>
                          {tabletCut(rel, {
                            width: SEQ.width,
                            height: SEQ.height,
                            viewport: SEQ.viewport,
                          })}
                        </Cut>
                      </Sequence>
                    );
                  })}
                  {TAIL_CUTS.map((c) => {
                    const cap = geo(c.key);
                    if (!cap) return null;
                    return (
                      <Sequence key={c.key} from={c.at} durationInFrames={c.len}>
                        <Cut fade={12}>{tabletCut(SHOT_FILES[c.key], cap)}</Cut>
                      </Sequence>
                    );
                  })}
                </>
              ) : (
                STILL_CUTS.map((c) => {
                  const cap = geo(c.key);
                  if (!cap) return null;
                  return (
                    <Sequence key={c.key} from={c.at} durationInFrames={c.len}>
                      <Cut fade={c.at === 0 ? 0 : 12}>
                        {tabletCut(SHOT_FILES[c.key], cap)}
                      </Cut>
                    </Sequence>
                  );
                })
              )}
              {/* 🔴 캡처 층 **위** — 사진에서 화면 앞에 있던 손끝을 되돌린다 */}
              <Occluder gen="gen-03.png" />
            </Photo>
          </StagePane>
        }
        right={
          <AbsoluteFill
            style={{ padding: 48, alignItems: "center", justifyContent: "center" }}
          >
            {/* 🔴 문서함 상태는 장면을 넘어 **단조 증가**해야 한다(2026-09-21).
                예전 값(every=60)은 이 장면(300프레임) 안에서 세 행을 다 도착시켰고,
                다음 장면 Repeat 이 맨 윗행을 다시 도착시키느라 **컷 직후 윗행이 잠깐 비었다**.
                여기서는 아래 두 행만 도착시키고(105프레임 간격 → 셋째는 305프레임, 장면 밖),
                맨 윗행은 Repeat 이 도착시킨다. 두 장면의 경계에서 행 수가 같다. */}
            <Inbox from={95} every={105} width={764} shot={trimInbox(inboxShot())} />
          </AbsoluteFill>
        }
      />

      {/* 자막 — 사진 위에도 읽히도록 아래쪽에 흰 띠를 깔고 얹는다 */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 54,
          background:
            "linear-gradient(to top, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.93) 16%, rgba(255,255,255,0) 34%)",
        }}
      >
        <Caption lines={S.captions} from={10} size={58} tone="light" />
      </AbsoluteFill>
    </Stage>
  );
};
