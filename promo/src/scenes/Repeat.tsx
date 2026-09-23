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
  countdownSeq,
  geo,
  quadAspect,
  quadCentroid,
  screenCrop,
  screenQuad,
  shotLayer,
  thanksSeq,
  trimInbox,
  brightFrames,
  type Rect,
} from "../shots-scenes";

/**
 * 27–35초 — 다음 사람이 서면 화면은 매번 새 서식이다. 앞사람 정보는 남지 않는다.
 *
 * 앞 컷(생성 이미지 ④): 앞사람이 끝낸 **감사 화면 → 새 서식**이 실제로 넘어가는
 * 연속 캡처(C/thanks-seq 7장)를 태블릿 화면에 그대로 재생한다.
 * 뒤 컷(생성 이미지 ⑤): 다른 방문자 앞의 화면은 **빈 서식**(C01)이다.
 *
 * 자리 이탈 카운트다운 덮개는 2026-09-18 에 `C/countdown-seq`(32장)로 촬영됐다.
 *
 * 🔴 2026-09-21: 그 32장 중 **앞 11장은 덮개가 뜨기 전**(동의 전 화면이라 제품이 스스로
 *    어둡게 한 상태, 평균 밝기 138)이다. 첫 프레임만 쓰면 「카운트다운 컷」에 카운트다운이
 *    없고 화면만 회색으로 나온다 — 실제로 그랬다. 밝기 측정값으로 덮개가 뜬 프레임만
 *    골라(`brightFrames`) 숫자가 줄어드는 것이 보이게 쓴다.
 */
const S = scene("repeat");
const TOTAL = sceneFrames("repeat");

const LEFT_RATIO = 0.58;
const PANE_W = Math.round(1920 * LEFT_RATIO);
const FADE = 12;

/** 방문자 두 명 = 생성 이미지 ④·⑤. 앞 컷이 조금 더 길다(전환 시퀀스가 들어간다) */
const FIRST_LEN = Math.round(TOTAL * 0.55);
const COUNTDOWN = countdownSeq();

/**
 * 🔴 화면 **정중앙에 뜨는 덮개**(카운트다운)의 채울 영역 — 측정 viewport 를 세로 가운데로 대칭시킨다.
 *
 * 왜(2026-09-23 레인 L2, 사용자 지적 「계속 작성하기 버튼이 화면 하단에 있다」):
 *   measure-scenes 의 viewport 는 「y 는 항상 0(맨 위 막대를 살린다) ~ 마지막 잉크 행」이다.
 *   서식처럼 위에서부터 차는 화면에는 맞지만, 래퍼 덮개(#ovIdle)는 CSS 로 **세로 가운데** 정렬이라
 *   잉크가 가운데(y 1186~1634 / 2700)에만 있다. 그래서 viewport 가 {y 0, h 1654} 로 잡히고,
 *   fitCrop 이 그 중심(y 827)에 맞춰 자르면 덮개 글·버튼이 잘린 화면의 아래 28% 에 몰린다
 *   (버튼 중심 0.96 — 원본 캡처에서는 0.588 로 가운데였다).
 *   원본은 가운데이므로 고칠 층은 래퍼가 아니라 이 합성이다.
 *   고치는 법: viewport 의 **크기는 그대로** 두고 세로 중심만 캡처 중심으로 옮긴다 —
 *   덮개가 가운데 정렬이라는 사실만 쓰고, 숫자를 손으로 박지 않는다(재촬영해도 그대로 맞는다).
 *   🔴 「아래 끝을 중심에 대해 거울상으로 올려 위 끝을 삼기」(내용만 딱 감싸기)는 안 된다 —
 *      영역이 608px 로 줄어 fitCrop 이 가로 기준으로 바뀌고 약 2.2배 확대돼, 제목 한 줄이
 *      태블릿 화면 좌우를 넘쳐 잘렸다(스틸 v3l-fix-repeat 1차에서 확인). 배율은 v3 와 같아야 한다.
 */
const centeredOverlayArea = (vp: Rect | null | undefined, capHeight: number): Rect | null => {
  if (!vp) return null;
  const h = Math.min(vp.h, capHeight);
  const y = Math.round(Math.min(Math.max(0, capHeight / 2 - h / 2), capHeight - h));
  return { x: vp.x, y, w: vp.w, h };
};

const Visitor: React.FC<{
  gen: string;
  sceneNo: number;
  /** 태블릿 화면에 순서대로 얹을 캡처(공용 경로) */
  frames: {
    rel: string;
    cap: { width: number; height: number; viewport?: Rect | null };
    len: number;
  }[];
  zoom?: number;
}> = ({ gen, sceneNo, frames, zoom = 1.55 }) => {
  const quad = screenQuad(sceneNo);
  const focus = quad ? quadCentroid(quad) : ([960, 540] as [number, number]);
  const aspect = quad ? quadAspect(quad) : 1;
  let at = 0;
  return (
    <StagePane paneWidth={PANE_W} paneHeight={1080} focus={focus} zoom={zoom}>
      <Photo src={gen} pan="in" from={1.0} to={1.05} durationInFrames={TOTAL}>
        {quad
          ? frames.map((f, i) => {
              const from = at;
              at += f.len;
              return (
                <Sequence key={`${f.rel}-${i}`} from={from} durationInFrames={f.len + 8}>
                  <Cut fade={i === 0 ? 0 : 8}>
                    <QuadShot
                      {...shotLayer(f.rel)}
                      capture={f.cap}
                      crop={screenCrop(f.cap, aspect)}
                      corners={quad}
                    />
                  </Cut>
                </Sequence>
              );
            })
          : null}
        {/* 🔴 캡처 층 **위** — 사진에서 화면 앞에 있던 손끝을 되돌린다 */}
        <Occluder gen={gen} />
      </Photo>
    </StagePane>
  );
};

export const Repeat: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const c01 = geo("C01");
  /* 🔴 빈 서식 컷은 C01 이 아니라 **C01b**(「입력 시작」 직후)를 쓴다.
     C01 은 동의 화면 상태라 이폼사인이 지면을 비활성 처리해 어둡다(실측 luma 136.6 대 245.9).
     C01b 캡처가 없으면 C01 로 물러선다 — 그때는 이 컷이 다시 어두워진다. */
  const c01b = geo("C01b");
  const blankSrc = c01b ? SHOT_FILES.C01b : SHOT_FILES.C01;
  const c04 = geo("C04");
  const seq = thanksSeq();
  const capPortrait = c01b ?? c01 ?? c04 ?? { width: 1920, height: 2550 };
  const blankCap = c01b ?? capPortrait;
  /* 시퀀스 프레임은 정지 캡처와 크기가 다를 수 있다 — 측정값을 그대로 쓴다 */
  const seqCap = seq.frames.length
    ? { width: seq.width, height: seq.height, viewport: seq.viewport }
    : capPortrait;
  const cdCap = COUNTDOWN.frames.length
    ? {
        width: COUNTDOWN.width,
        height: COUNTDOWN.height,
        viewport: centeredOverlayArea(COUNTDOWN.viewport, COUNTDOWN.height),
      }
    : capPortrait;

  /* 앞 컷: 감사 화면 → 새 서식 전환(있으면 연속 캡처, 없으면 감사 화면 한 장) */
  /* 🔴 어두운 프레임은 **앞머리뿐 아니라 시퀀스 중간에도** 있다(2026-09-21 v3).
     thanks-seq 16장의 순서는 「전송 팝업(어두움) → 감사 화면(밝음) → 새 서식(동의 전이라
     어두움)」이라, 앞머리만 버리는 `dropLeadingDark` 로는 뒤쪽 어두운 프레임이 그대로 남아
     장면 한가운데에서 화면이 통째로 회색이 됐다(스틸 f900 에서 확인).
     밝은 프레임만 쓰고(`brightFrames`), 「새 서식」은 바로 뒤에 오는 **밝은 빈 서식**(C01b)이
     맡는다 — 「감사 → 새 서식」이라는 이야기는 그대로다. */
  const seqUse = brightFrames(seq);
  const perSeq = seqUse.length
    ? Math.max(1, Math.floor((FIRST_LEN * 0.8) / seqUse.length))
    : 0;
  const firstFrames = seqUse.length
    ? [
        ...seqUse.map((rel) => ({ rel, cap: seqCap, len: perSeq })),
        {
          rel: blankSrc,
          cap: blankCap,
          len: Math.max(20, FIRST_LEN - perSeq * seqUse.length),
        },
      ]
    : [{ rel: blankSrc, cap: blankCap, len: FIRST_LEN }];

  /* 뒤 컷: 자리 이탈 카운트다운 덮개(숫자가 줄어든다) → 다음 사람 앞의 빈 서식.
     덮개가 실제로 떠 있는 프레임만 골라 6장으로 솎고, 한 장에 CD_PER 프레임씩 준다. */
  const secondLen = TOTAL - FIRST_LEN + FADE;
  const cdBright = brightFrames(COUNTDOWN);
  const CD_PICK = 8;
  const CD_PER = 10;
  const cdPicked = cdBright.length
    ? Array.from({ length: Math.min(CD_PICK, cdBright.length) }, (_, i) =>
        cdBright[Math.round((i * (cdBright.length - 1)) / Math.max(1, Math.min(CD_PICK, cdBright.length) - 1))],
      )
    : [];
  const cdLen = cdPicked.length * CD_PER;
  const secondFrames = cdPicked.length
    ? [
        ...cdPicked.map((rel) => ({ rel, cap: cdCap, len: CD_PER })),
        { rel: blankSrc, cap: blankCap, len: Math.max(20, secondLen - cdLen) },
      ]
    : [{ rel: blankSrc, cap: blankCap, len: secondLen }];

  return (
    <Stage variant="light" logo="none">
      <Narration id="repeat" mute={mute} />
      <SplitScreen
        ratio={LEFT_RATIO}
        /* 🔴 음수 시작 = 오른쪽 문서함 칸이 **처음부터 다 들어와 있다**(2026-09-21).
           앞 장면 Fill 이 문서함을 이미 띄워 놓고 끝나는데 여기서 다시 밀어 넣으면
           컷 직후 문서함이 통째로 사라졌다 나타난다 — 실제로 그렇게 보였다. */
        from={-18}
        left={
          <AbsoluteFill>
            <Sequence from={0} durationInFrames={FIRST_LEN + FADE}>
              <Cut fade={0}>
                <Visitor gen="gen-04.png" sceneNo={4} frames={firstFrames} />
              </Cut>
            </Sequence>
            <Sequence from={FIRST_LEN} durationInFrames={TOTAL - FIRST_LEN}>
              <Cut fade={FADE}>
                <Visitor gen="gen-05.png" sceneNo={5} frames={secondFrames} />
              </Cut>
            </Sequence>
          </AbsoluteFill>
        }
        right={
          <AbsoluteFill style={{ padding: 48, alignItems: "center", justifyContent: "center" }}>
            {/* 앞 장면에서 이미 쌓인 문서가 있는 자리다 — 음수 시작이면 두 건은 처음부터 떠 있고
                마지막 한 건만 이 장면에서 도착한다(문서함이 계속 차오르는 연속성).
                🔴 이 전제를 Fill 이 지켜야 한다: Fill 은 아래 두 행까지만 도착시킨다
                (Fill.tsx 의 `every={105}` 주석 참조). 둘 중 하나만 고치면 경계에서 행이 깜빡인다. */}
            <Inbox from={-60} every={48} width={764} shot={trimInbox(inboxShot())} />
          </AbsoluteFill>
        }
      />
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 54,
          background:
            "linear-gradient(to top, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.93) 16%, rgba(255,255,255,0) 34%)",
        }}
      >
        <Caption lines={S.captions} from={8} size={56} tone="light" />
      </AbsoluteFill>
    </Stage>
  );
};
