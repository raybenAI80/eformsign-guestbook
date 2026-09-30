import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Stage } from "../components/Stage";
import { CaptionBar } from "../components/Caption";
import { Narration } from "../components/Narration";
import {
  CaptureBox,
  Cursor,
  Cut,
  Highlight,
  ShotFocus,
  shotSrc,
} from "../components/ShotView";
import { scene, sceneFrames } from "../script";
import {
  SHOT_FILES,
  geo,
  padRect,
  rectCenter,
  rectToAspect,
  type Rect,
} from "../shots-scenes";
import { PaperLiftTransition } from "../components/three/Moments3D";
import { CARD, CARD_RECT, PAPER_LIFT_FRAMES } from "../components/three/moments-geometry";

/**
 * 10–17초 — 이폼사인 웹폼 디자이너에서 방명록 서식을 만든다.
 *
 * 컷 셋(전부 **실캡처**):
 *   ① A01 폼 디자인 화면 — 서식에 놓인 입력 항목을 위에서 아래로 하나씩 짚는다
 *   ② A02 설정 화면 — 「URL로 문서 생성 허용」에 체크가 켜져 있다(로그인 없는 작성의 근거)
 *   ③ A04 저장 확인 — 「배포하기」를 누른다
 *
 * 🔴 커서·강조 테두리는 **캡처에 이미 있는 요소 자리에만** 얹는다. 없는 UI 를 그리지 않는다.
 *    자리는 `tools/measure-scenes.mjs` 가 화소로 재서 `src/scene-geometry.json` 에 넣는다.
 *    캡처가 없으면 그 컷을 통째로 빼고 남은 컷이 길이를 나눠 갖는다.
 */
const S = scene("designer");
const TOTAL = sceneFrames("designer");

/** 카드 = 화면 가운데 큰 판. 자막이 앉을 아래쪽을 비워 둔다 — 정본은 moments-geometry.ts */
export { CARD, CARD_RECT, PAPER_LIFT_FRAMES };

/**
 * v3.3 레인 T ① — Paper → Designer 3D 전환(0.6초 = 18f). 경계 앞 9f 는 Paper, 뒤 9f 는 여기.
 * 🔴 장면 길이 불변 — 두 장면이 각자 **자막 아래** 층에 반씩 넣는다. 착지 자리 = 이 카드.
 */
const CARD_ASPECT = CARD.width / CARD.height;

const CUTS = ["A01", "A02", "A04"] as const;
const available = CUTS.filter((k) => geo(k) !== null);
const FADE = 10;
const span = available.length ? Math.round(TOTAL / available.length) : TOTAL;
const startOf = (key: (typeof CUTS)[number]) => Math.max(0, available.indexOf(key)) * span;

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start" }}>
    <div style={{ marginTop: CARD.top }}>{children}</div>
  </AbsoluteFill>
);

/** 캡처 안 한 구역을 카드 비율로 넓힌 카메라 프레임 */
const frameOn = (r: Rect, pad: number, cap: { width: number; height: number }): Rect =>
  rectToAspect(padRect(r, pad, cap), CARD_ASPECT, cap);

export const Designer: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const a01 = geo("A01");
  const a02 = geo("A02");
  const a04 = geo("A04");
  const a01Fields = a01?.fields ?? [];

  return (
    <Stage variant="light" logo="br">
      <Narration id="designer" mute={mute} />

      {/* ① 서식에 놓인 입력 항목을 하나씩 짚는다 */}
      {a01 && a01Fields.length > 0 ? (
        <Sequence name="A01 폼 디자인" from={startOf("A01")} durationInFrames={span + FADE}>
          <Cut fade={0}>
            <Card>
              <ShotFocus
                src={shotSrc(SHOT_FILES.A01)}
                capture={a01}
                from={frameOn(a01.fieldsArea ?? a01Fields[0], 420, a01)}
                to={frameOn(a01.fieldsArea ?? a01Fields[0], 90, a01)}
                durationInFrames={span}
                width={CARD.width}
                height={CARD.height}
              >
                {a01Fields.map((f, i) => (
                  <Highlight
                    key={`${f.x}-${f.y}`}
                    rect={f}
                    from={8 + i * 11}
                    until={8 + i * 11 + 26}
                    pad={9}
                  />
                ))}
                <Cursor
                  size={44}
                  stops={a01Fields.map((f, i) => {
                    const [cx, cy] = rectCenter(f);
                    return { at: 8 + i * 11, x: cx - f.w * 0.3, y: cy, click: i % 2 === 0 };
                  })}
                />
              </ShotFocus>
            </Card>
          </Cut>
        </Sequence>
      ) : null}

      {/* ② 「URL로 문서 생성 허용」 — 로그인 없이 누구나 쓰게 되는 지점 */}
      {a02 && a02.urlToggle ? (
        <Sequence
          name="A02 URL로 문서 생성 허용"
          from={startOf("A02")}
          durationInFrames={span + FADE}
        >
          <Cut fade={FADE}>
            <Card>
              <ShotFocus
                src={shotSrc(SHOT_FILES.A02)}
                capture={a02}
                from={frameOn(a02.urlToggle, 520, a02)}
                to={frameOn(a02.urlToggle, 280, a02)}
                durationInFrames={span}
                width={CARD.width}
                height={CARD.height}
              >
                <Highlight rect={a02.urlToggle} from={FADE + 6} pad={14} thickness={6} />
                <Cursor
                  size={44}
                  stops={[
                    { at: FADE, x: a02.urlToggle.x - 130, y: a02.urlToggle.y + 110 },
                    {
                      at: FADE + 15,
                      x: a02.urlToggle.x + a02.urlToggle.w * 0.4,
                      y: a02.urlToggle.y + a02.urlToggle.h * 0.5,
                      click: true,
                    },
                  ]}
                />
              </ShotFocus>
            </Card>
          </Cut>
        </Sequence>
      ) : null}

      {/* ③ 저장 → 배포하기 */}
      {a04 && a04.dialog ? (
        <Sequence
          name="A04 저장·배포"
          from={startOf("A04")}
          durationInFrames={TOTAL - startOf("A04")}
        >
          <Cut fade={FADE}>
            <Card>
              <CaptureBox
                src={shotSrc(SHOT_FILES.A04)}
                capture={a04}
                crop={frameOn(a04.dialog, 210, a04)}
                width={CARD.width}
                height={CARD.height}
              >
                {a04.deployButton ? (
                  <>
                    <Highlight rect={a04.deployButton} from={FADE + 10} pad={12} thickness={6} />
                    <Cursor
                      size={44}
                      stops={[
                        { at: FADE, x: a04.dialog.x + 70, y: a04.dialog.y + a04.dialog.h - 30 },
                        {
                          at: FADE + 18,
                          x: a04.deployButton.x + a04.deployButton.w * 0.45,
                          y: a04.deployButton.y + a04.deployButton.h * 0.5,
                          click: true,
                        },
                      ]}
                    />
                  </>
                ) : null}
              </CaptureBox>
            </Card>
          </Cut>
        </Sequence>
      ) : null}

      <Sequence name="3D 전환(뒤 절반)" durationInFrames={PAPER_LIFT_FRAMES / 2}>
        <PaperLiftTransition offset={PAPER_LIFT_FRAMES / 2} />
      </Sequence>

      <CaptionBar lines={S.captions} from={6} tone="light" size={66} />
    </Stage>
  );
};
