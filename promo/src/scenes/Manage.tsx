import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Stage } from "../components/Stage";
import { Photo } from "../components/Photo";
import { CaptionBar } from "../components/Caption";
import { Narration } from "../components/Narration";
import { Cursor, Cut, Highlight, QuadShot } from "../components/ShotView";
import { scene, sceneFrames } from "../script";
import { originFor } from "../geometry";
import {
  SHOT_FILES,
  geo,
  grade,
  quadAspect,
  quadCentroid,
  screenCrop,
  screenQuad,
  shotLayer,
  type Rect,
} from "../shots-scenes";

/**
 * 35–46초 — 행사가 끝나면 옮겨 적을 게 없다. 목록에서 찾고, 완료 문서를 바로 연다.
 *
 * 생성 이미지 ⑥(담당자 노트북, 화면은 비워 생성)의 화면 자리에 **문서함 실캡처**를
 * 원근 매핑하고, 카메라가 화면 쪽으로 밀고 들어간다(끝에는 글자가 읽힌다).
 * 컷: D01 목록(우측 문서 상태·이력) → D02 「방문자」 검색 결과 → D03 완료 문서 미리보기.
 *
 * 🔴 리포트 화면(report.html, E 계열)은 **이 영상에 넣지 않는다**(2026-09-21 사용자 지시).
 *    리포트는 방명록 상품에 따로 구현한 화면이고 이폼사인 제품 화면이 아니다 —
 *    이 장면은 이폼사인 안에서 끝나는 것만 보여 준다. 컷이 빠진 만큼 D01·D02·D03 이
 *    길이를 나눠 갖는다. 각주(`script.ts` footnote)도 같이 없어졌다.
 */
const S = scene("manage");
const TOTAL = sceneFrames("manage");

const QUAD = screenQuad(6);
const ZOOM_TO = 2.0;

/**
 * 🔴 배경 색보정(2026-09-21). v1 에서 이 장면은 초당 평균 밝기 117~146 으로 영상에서 가장
 * 어두웠다(직전 Repeat ≈215). 어두운 책상 실사 위에 ① Photo 의 scrim ② 자막용 짙은 띠가
 * 겹친 탓이다. 고친 방법 세 가지:
 *   ① 배경 이미지에만 밝기 보정을 건다(`backdrop-filter`) — 세기는 측정값에서 계산한 데이터
 *      (`scene-geometry.json` 의 `grade`)를 그대로 쓴다. 코드에 숫자를 박지 않는다.
 *   ② Photo 의 scrim 을 0.5 → 0.10 으로 낮춘다(자막 가독은 아래 띠가 담당한다).
 *   ③ 자막 띠를 프레임 아래쪽으로 낮게 깐다(높이 38% → 26%).
 * 🔴 보정은 **캡처 층 아래**에만 깐다 — 문서함 캡처 색이 바뀌면 Fill→Repeat 연속성이 깨진다.
 */
const SCRIM = 0.10;

export const Manage: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const d01 = geo("D01") ?? { width: 2400, height: 1350 };
  const d02 = geo("D02");
  const d03 = geo("D03");
  const bg = grade("gen-06.png");

  /** 🔴 노트북 화면(1.58)과 문서함 캡처(1.78)는 비가 다르다 — 왼쪽(상태·제목·단계)을 살린다 */
  const aspect = QUAD ? quadAspect(QUAD) : 1.58;

  const center = QUAD ? quadCentroid(QUAD) : ([960, 540] as [number, number]);
  const [ox, oy] = originFor(center, [960, 500], ZOOM_TO);

  /*
   * 컷 배분 — 있는 컷만 가중치대로 길이를 나눠 갖는다.
   * 🔴 「없으면 빈 자리」가 아니라 「없으면 그 컷이 사라지고 나머지가 늘어난다」.
   */
  const plan: {
    key: string;
    rel: string;
    cap: { width: number; height: number; viewport?: Rect | null };
    weight: number;
    align?: "center" | "left" | "top";
    /** 자르기를 직접 지정한다(생략하면 비율에서 계산) */
    crop?: { x: number; y: number; w: number; h: number };
    overlay?: React.ReactNode;
  }[] = [
    { key: "list", rel: SHOT_FILES.D01, cap: d01, weight: 1, align: "left" },
    ...(d02
      ? [
          {
            key: "search",
            rel: SHOT_FILES.D02,
            cap: d02,
            weight: 1.1,
            align: "left" as const,
            overlay: d02.search ? (
              <>
                <Highlight rect={d02.search} from={16} pad={12} thickness={8} />
                <Cursor
                  size={90}
                  stops={[
                    { at: 2, x: d02.search.x - 280, y: d02.search.y + 220 },
                    {
                      at: 18,
                      x: d02.search.x + d02.search.w * 0.5,
                      y: d02.search.y + d02.search.h * 0.5,
                      click: true,
                    },
                  ]}
                />
              </>
            ) : null,
          },
        ]
      : []),
    ...(d03
      ? [
          {
            key: "pdf",
            rel: SHOT_FILES.D03,
            cap: d03,
            weight: 1.1,
            align: "left" as const,
          },
        ]
      : []),
  ];

  const sumW = plan.reduce((a, c) => a + c.weight, 0);
  let cursorAt = 0;
  const scheduled = plan.map((c, i) => {
    const from = cursorAt;
    const len = i === plan.length - 1 ? TOTAL - from : Math.round((TOTAL * c.weight) / sumW);
    cursorAt = from + len;
    return { ...c, from, len };
  });

  return (
    <Stage variant="photo" logo="none">
      <Narration id="manage" mute={mute} />

      <Photo
        src="gen-06.png"
        pan="in"
        from={1.02}
        to={ZOOM_TO}
        durationInFrames={TOTAL}
        originX={ox}
        originY={oy}
        scrim={SCRIM}
      >
        {/* 배경만 밝힌다 — 아래 캡처 층(QuadShot)은 이 보정 위에 놓여 색이 바뀌지 않는다 */}
        {bg ? (
          <AbsoluteFill
            style={{
              backdropFilter: `brightness(${bg.brightness}) saturate(${bg.saturate})`,
              WebkitBackdropFilter: `brightness(${bg.brightness}) saturate(${bg.saturate})`,
            }}
          />
        ) : null}
        {scheduled.map((c, i) => (
          <Sequence
            key={c.key}
            from={c.from}
            durationInFrames={i === scheduled.length - 1 ? c.len : c.len + 12}
          >
            <Cut fade={i === 0 ? 0 : 12}>
              {QUAD ? (
                <QuadShot
                  {...shotLayer(c.rel)}
                  capture={c.cap}
                  crop={c.crop ?? screenCrop(c.cap, aspect, c.align ?? "left")}
                  corners={QUAD}
                >
                  {c.overlay}
                </QuadShot>
              ) : null}
            </Cut>
          </Sequence>
        ))}
      </Photo>

      {/* 자막 띠.
          🔴 v1 은 **짙은 남색 띠 + 흰 글자**였다. 그 띠가 프레임 아래 38% 를 덮어 이 장면의
             평균 밝기를 혼자 30 이상 끌어내렸다(배경을 밝혀도 총평균이 안 올라간 이유).
             배경을 밝힌 지금은 반대로 **밝은 띠 + 짙은 글자**가 맞다 — Designer·Branch 와도
             같은 조판이 되고, 자막 대비는 오히려 는다(흰 글자가 밝은 화면에 묻히던 문제 해소). */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(248,250,252,0.94) 0%, rgba(248,250,252,0.82) 13%, rgba(248,250,252,0) 30%)",
        }}
      />
      <CaptionBar lines={S.captions} from={6} tone="light" footnote={S.footnote} size={62} />
    </Stage>
  );
};
