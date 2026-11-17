import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { Stage } from "../components/Stage";
import { Photo } from "../components/Photo";
import { BookCamera, CameraScrim } from "../components/BookCamera";
import { paperFirstCutFrames } from "../camera";
import { PaperInk } from "../components/PaperInk";
import { FakeSheet } from "../components/FakeSheet";
import { ScreenComposite, Corners } from "../components/ScreenComposite";
import { Caption } from "../components/Caption";
import { Narration } from "../components/Narration";
import { scene, sec } from "../script";
import { PaperLiftTransition } from "../components/three/Moments3D";
import { PAPER_CAPTION, PAPER_LIFT_FRAMES } from "../components/three/moments-geometry";
import {
  bookInk,
  bookPageLeft,
  bookPageRight,
  bookPageSize,
  bookPenSlot,
  bookRuling,
  bookWriterSide,
} from "../geometry";

/**
 * 3–10초 — 종이 서식의 오늘.
 *   앞 컷: 생성 이미지 ① 행사장 접수대, 종이 방명록에 줄 선 사람들 (슬로우 줌 인)
 *          → 펼친 방명록 지면 위에 앞사람 이름·연락처가 한 줄씩 써진다.
 *            「앞사람 개인정보가 종이에 훤히 보인다」가 이 컷의 전부다.
 *   뒷 컷: 생성 이미지 ② 밤 사무실, 담당자가 종이를 보며 옮겨 적는 모습 (슬로우 패닝)
 *          → 노트북 빈 화면에 스프레드시트가 한 줄씩 늘어난다(= 수작업 이관).
 *
 * 🔴 종이 위·화면 위 글자는 생성 이미지의 글자를 쓰지 않고 Remotion 으로 그린다
 *    (기획서 10절 1-1). 전부 가짜 정보다.
 * 🔴 노트북 화면은 이폼사인 UI 가 아니다 — 그냥 스프레드시트다.
 */
const S = scene("paper");
/** whoosh-in.wav 정점까지 프레임(0.55초, 레인 U 계약) */
const WHOOSH_IN_HIT = 17;

/**
 * 방명록 지면 4점은 **코드에 박지 않는다**.
 *
 * 🔴 생성 이미지는 기획 피드백에 따라 다시 만들어져 덮어써진다(2026-09-18 작업 도중
 *    gen-01.png 이 실제로 교체됐고, 그 순간 코드에 박힌 좌표는 조용히 틀린 값이 됐다).
 *    정본 = public/gen/prompts.json · 재측정 = node tools/measure-book.mjs
 *    좌표계 배정(= 글줄 방향)의 뜻은 src/geometry.ts 주석 참조.
 */
const PAGE_LEFT = bookPageLeft();
const PAGE_RIGHT = bookPageRight();

/**
 * 🔴 「앞사람들이 이미 적어 둔 면」과 「지금 써지는 중인 면」의 배정은 **펜 위치**로 정한다.
 *    화면의 왼쪽/오른쪽으로 박으면 카메라가 반대편으로 넘어갈 때 조용히 틀린다 —
 *    4차 gen-01(카운터 건너편 부감)에서 실제로 펜은 화면 왼쪽 페이지에 왔다.
 *    정본 = prompts.json geometry.writerSide.
 */
const WRITER_SIDE = bookWriterSide();
/** 펜이 놓인 = 지금 써지는 중인 페이지 */
const PAGE_ACTIVE = WRITER_SIDE === "left" ? PAGE_LEFT : PAGE_RIGHT;
/** 앞사람들이 이미 채워 둔 페이지 */
const PAGE_FILLED = WRITER_SIDE === "left" ? PAGE_RIGHT : PAGE_LEFT;

/**
 * 방명록으로 밀고 들어가는 카메라 — **훅에서 이미 시작된 하나의 움직임**을 이어받는다.
 *
 * v1(배율 1.42→1.58)에서 앞사람 이름 글자가 화면에서 **9~12px** 라 글자로 인식되지
 * 않았다(실측 `python tools/measure-ink-height.py --img out/check/v1-paper-max.png
 * --crop 1230,640,1360,790` → 중앙값 9.5px). 이 컷의 뜻이 「앞사람 연락처가 그대로
 * 보인다」이므로 **읽히지 않으면 컷이 성립하지 않는다**.
 *
 * 🔴 해결은 글자를 키우는 것이 **아니다**. 글자 크기는 괘선 간격에 묶여 있고
 *    (PaperInk 주석) 그것이 「종이에 쓴 글씨」로 보이게 하는 유일한 근거다.
 *    그래서 **카메라 배율**만 올린다 — 기하·좌표·글자 비율은 그대로 둔다.
 *
 * 🔴 배율은 상수가 아니라 **목표 글자 높이에서 역산한 파생값**이다.
 *    정본 = prompts.json ①.geometry.camera, 계산 = geometry.ts bookCamera().
 *
 * 🔴 2026-09-21 레인 J — 시작 배율 1.42 는 이제 **훅이 끝나는 배율**이다. 훅과 Paper 가
 *    같은 사진을 쓰는데 경계에서 1.06 → 1.42 로 튀던 점프컷을 없앴다. 배율·초점·이징은
 *    `src/camera.ts` 한 곳에서 오고(두 벌 하드코딩 금지), Paper 의 이징은 훅 끝 속도를
 *    그대로 이어받아 가속한 뒤 최대 배율에 **기울기 0 으로 안착**한다(그래서 머무는 구간이
 *    정지 컷으로 읽힌다). 푸시인은 앞 컷 전체가 아니라 그 88%(camera.ts PAPER_RAMP_RATIO)
 *    에서 끝나고 나머지는 최대 배율로 머문다 — 나레이션 「…노출되고」가 끝나는 대목을
 *    정지 화면이 덮게 하기 위해서다. 비율이므로 장면 길이가 바뀌어도 따라간다.
 */

/**
 * 가짜 방명록 기재 정보 — 실데이터 금지.
 * 앞사람들이 적어 둔 4줄은 **이미 채워진 면**(PAGE_FILLED = 쓰는 사람의 왼쪽 페이지)에 있고,
 * 마지막 한 줄은 **펜이 놓인 면**(PAGE_ACTIVE) 에서 지금 써지는 중이다.
 * 어느 쪽이 화면 좌/우인지는 geometry.writerSide 가 정한다 — 여기에 박지 않는다.
 */
const FAKE_NAMES = ["김OO", "이OO", "박OO", "최OO", "정OO", "강OO", "조OO", "윤OO", "장OO", "임OO", "한OO", "오OO"];
const fakeRow = (i: number) => ({ name: FAKE_NAMES[i % FAKE_NAMES.length], phone: "010-0000-0000" });

/** 괘선 간격·첫 괘선 위치(측정) 와 손글씨 표현 비율(연출) — 둘 다 prompts.json 이 정본 */
const INK = bookInk();
const [PAGE_W, PAGE_H] = bookPageSize();
const RULE_FILLED = bookRuling(WRITER_SIDE === "left" ? "right" : "left");
const RULE_ACTIVE = bookRuling(WRITER_SIDE);

/**
 * 앞사람들이 이미 채워 둔 면 — 괘선 한 줄에 한 사람.
 * 🔴 낮은 slot 부터 채우지 않는다: slot 0 은 페이지 맨 윗줄 = **화면 아래**라서
 *    화면 아래에 있는 자막과 겹친다. 시작 칸은 prompts.json ink.filledStartSlot 이 정한다.
 */
const FAKE_ROWS_FILLED = Array.from({ length: INK.filledRows }, (_, i) => fakeRow(i));

/**
 * 지금 써지는 줄이 들어갈 칸 번호 = **펜 끝을 역매핑한 칸**.
 *
 * 🔴 코드에 박지 않는다. 펜 끝 화면 좌표(733,817)를 펜 페이지의 페이지 로컬로 되돌리면
 *    (210, 687) 이고, 괘선 pitch 53.67·첫 괘선 31.6 이므로 칸 12 다.
 *    측정·기록 = `node tools/measure-book.mjs --rule-pitch --pen "733,817" --write`
 *    → prompts.json geometry.ruling.penTip.slot. 이미지나 pitch 가 바뀌면 여기가 따라 바뀐다.
 */
const PEN_SLOT = bookPenSlot();

/**
 * 펜이 놓인 면에도 **바로 앞 몇 줄은 이미 써져 있다** — 그 사람이 방금 전 줄들을 지나온 것이다.
 * 펜 칸 바로 아래 칸(= 화면에서 한 줄 아래)부터 거꾸로 채운다.
 */
const FAKE_ROWS_ACTIVE_LEAD = Array.from({ length: INK.activeLeadRows }, (_, i) =>
  fakeRow(INK.filledRows + i),
);
const ACTIVE_LEAD_START = Math.max(0, PEN_SLOT - INK.activeLeadRows);
/** 지금 펜 끝에서 써지는 중인 한 줄 */
const FAKE_ROWS_ACTIVE = [fakeRow(INK.filledRows + INK.activeLeadRows)];

/**
 * gen-02.png 노트북 화면(빈 회색)의 네 꼭짓점. 1920×1080 좌표.
 *
 * 측정: 원본 raw RGB 를 훑어 「밝고 채도 낮은 회백색」 화소의 행·열 경계를 뽑아
 * 네 변의 직선을 교차시켰다(2026-09-18).
 * 🔴 확대 이미지 격자 육안 측정은 한 번 크게 틀렸다(우변을 120px 밖에서 읽었다).
 *    이런 사각형은 눈이 아니라 화소로 잰다.
 */
const LAPTOP: Corners = {
  tl: [1221, 533],
  tr: [1509, 556],
  br: [1441, 823],
  bl: [1152, 774],
};

/** 가짜 스프레드시트 — 종이에서 옮겨 적은 것처럼 보이는 줄들 */
const SHEET_ROWS = [
  { name: "김OO", phone: "010-0000-0000", at: "09:12" },
  { name: "이OO", phone: "010-0000-0000", at: "09:20" },
  { name: "박OO", phone: "010-0000-0000", at: "09:31" },
  { name: "최OO", phone: "010-0000-0000", at: "09:44" },
  { name: "정OO", phone: "010-0000-0000", at: "09:52" },
];

/**
 * 앞 컷의 **책 층** = gen-01 사진 + 지면 위 손글씨(PaperInk 3벌). 카메라(BookCamera)는 바깥에서 건다.
 * 🔴 v3.3 레인 T2: 3D 종이 전환의 텍스처(PageTexture 컴포지션)가 **이 층을 그대로** 펴서 쓴다 —
 *    손글씨 구성을 두 곳에 적지 않기 위해 컴포넌트로 뺐다(DOM 구조는 그대로).
 */
export const BookSpread: React.FC<{
  durationInFrames: number;
  /** false = 사진 없이 손글씨만(텍스처 굽기에서 손글씨를 원근 없이 선명하게 그릴 때) */
  photo?: boolean;
  /** false = 손글씨 없이 사진만 */
  ink?: boolean;
  /** 페이지 네 점(페이지 로컬 순서) 대체 — 텍스처 굽기용. 없으면 prompts.json 측정값 */
  pageCorners?: { left: Corners; right: Corners };
}> = ({ durationInFrames, photo = true, ink = true, pageCorners }) => {
  const left = pageCorners?.left ?? PAGE_LEFT;
  const right = pageCorners?.right ?? PAGE_RIGHT;
  const active = WRITER_SIDE === "left" ? left : right;
  const filled = WRITER_SIDE === "left" ? right : left;
  const inks = ink ? (
    <>
          {/* 앞사람들이 이미 적어 둔 면 — 펜이 놓이지 않은 쪽. 괘선 한 줄에 한 사람 */}
          {filled ? (
            <PaperInk
              corners={filled}
              rows={FAKE_ROWS_FILLED}
              pitch={RULE_FILLED.pitch}
              firstRuleAt={RULE_FILLED.firstRuleAt}
              ink={INK}
              pageWidth={PAGE_W}
              pageHeight={PAGE_H}
              startSlot={INK.filledStartSlot}
              scrim={0}
              from={4}
              stagger={9}
              strokeFrames={12}
            />
          ) : null}
          {/* 펜이 놓인 면 — 바로 앞 몇 줄은 이미 써져 있고 */}
          {active ? (
            <PaperInk
              corners={active}
              rows={FAKE_ROWS_ACTIVE_LEAD}
              pitch={RULE_ACTIVE.pitch}
              firstRuleAt={RULE_ACTIVE.firstRuleAt}
              ink={INK}
              pageWidth={PAGE_W}
              pageHeight={PAGE_H}
              startSlot={ACTIVE_LEAD_START}
              scrim={0}
              from={4}
              stagger={9}
              strokeFrames={12}
            />
          ) : null}
          {/* 지금 펜 끝에서 써지는 중인 한 줄 — 칸 번호는 펜 끝 역매핑(PEN_SLOT) */}
          {active ? (
            <PaperInk
              corners={active}
              rows={FAKE_ROWS_ACTIVE}
              pitch={RULE_ACTIVE.pitch}
              firstRuleAt={RULE_ACTIVE.firstRuleAt}
              ink={INK}
              pageWidth={PAGE_W}
              pageHeight={PAGE_H}
              startSlot={PEN_SLOT}
              scrim={0}
              from={62}
              stagger={0}
              strokeFrames={26}
            />
          ) : null}
    </>
  ) : null;
  return photo ? (
    <Photo src="gen-01.png" pan="in" from={1} to={1} durationInFrames={durationInFrames} scrim={0}>
      {inks}
    </Photo>
  ) : (
    <AbsoluteFill>{inks}</AbsoluteFill>
  );
};

export const Paper: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const { fps } = useVideoConfig();
  const total = sec(S.endSec - S.startSec);
  /** 앞 컷(종이) 길이 — 비율의 정본은 camera.ts(훅이 램프 길이를 알아야 속도를 맞춘다) */
  const firstCut = paperFirstCutFrames(total);

  return (
    <Stage variant="photo" logo="none">
      <Narration id="paper" mute={mute} />

      {/* 앞 컷 — 종이 방명록에 줄 선 사람들 + 지면 위에 써지는 앞사람 정보 */}
      <Sequence durationInFrames={firstCut}>
        <BookCamera phase="paper">
          <BookSpread durationInFrames={firstCut} />
        </BookCamera>
        <CameraScrim strength={0.5} />
      </Sequence>

      {/* 뒷 컷 — 밤 사무실, 노트북 스프레드시트로 옮겨 적기 */}
      <Sequence from={firstCut} durationInFrames={total - firstCut}>
        <Photo
          src="gen-02.png"
          pan="left"
          from={1.12}
          to={1.04}
          durationInFrames={total - firstCut}
          scrim={0.66}
        >
          <ScreenComposite corners={LAPTOP} shotWidth={1280} shotHeight={800} glare>
            <FakeSheet rows={SHEET_ROWS} from={4} stagger={12} />
          </ScreenComposite>
        </Photo>
      </Sequence>

      {/* v3.3 레인 T ① — Designer 로 넘어가는 3D 전환의 앞 절반(자막 아래 층) */}
      <Sequence
        name="3D 전환(앞 절반)"
        from={total - PAPER_LIFT_FRAMES / 2}
        durationInFrames={PAPER_LIFT_FRAMES / 2}
      >
        <PaperLiftTransition />
      </Sequence>

      {/* v3.3 레인 T2 — 효과음 whoosh-in: 정점(0.55s = 17f)을 **전환 첫 프레임**에 맞춘다(레인 U 계약표) */}
      {mute ? null : (
        <Sequence
          name="효과음 whoosh-in"
          from={total - PAPER_LIFT_FRAMES / 2 - WHOOSH_IN_HIT}
          durationInFrames={Math.round(0.8 * fps)}
        >
          <Audio src={staticFile("sfx/whoosh-in.wav")} />
        </Sequence>
      )}

      {/* 자막은 두 컷에 걸쳐 계속 떠 있다 */}
      <AbsoluteFill
        style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: PAPER_CAPTION.bottom }}
      >
        <Caption lines={S.captions} from={Math.round(fps * 0.3)} size={PAPER_CAPTION.size} tone="dark" />
      </AbsoluteFill>
    </Stage>
  );
};
