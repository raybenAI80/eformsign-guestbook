import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../components/Stage";
import { Inbox } from "../components/Inbox";
import { CaptionBar } from "../components/Caption";
import { Narration } from "../components/Narration";
import { CaptureBox } from "../components/ShotView";
import { C, EASE } from "../theme";
import { scene, sceneFrames } from "../script";
import { inboxShot } from "../shots";
import {
  SHOT_FILES,
  cropTop,
  screenCrop,
  shotLayer,
  fillSeq,
  geo,
  padRect,
  rectToAspect,
  trimInbox,
} from "../shots-scenes";

/**
 * 46–54초 — 서식 한 장이 세 갈래로 갈라지고, 세 갈래의 완료 문서가 같은 문서함으로 모인다.
 *
 * 왼쪽 = 이폼사인에서 만든 서식(A01 실캡처) · 가운데 = 같은 서식이 열리는 세 가지 자리
 * (세로 화면 · 손안 화면 · 메일) · 오른쪽 = 같은 문서함(D01 실캡처)에 쌓이는 완료 문서.
 *
 * 🔴 가운데 세 자리에 「방명록/동의서/신청서」 같은 **이름표를 붙이지 않는다**.
 *    화면에 얹힌 것은 방문자 기록 서식 실캡처 한 종류뿐이라, 다른 문서 이름을 달면
 *    실캡처가 아닌 것을 실캡처인 척하는 것이 된다. 그 메시지는 자막이 말한다.
 */
const S = scene("branch");
const TOTAL = sceneFrames("branch");

const MID_Y = 400;
/* 🔴 카드 비율은 캡처를 자를 수 있는 범위 안에서 정한다. 서식 칸 영역(865×706)을
   여유 70px 로 감싸면 1005×846 이고, 세로를 캡처 높이(1350) 안에 담으려면
   가로/세로 비가 0.77 보다 크면 안 된다 — 더 갸름하게 잡으면 rectToAspect 가
   세로에서 잘려 편집기 툴바까지 끌고 들어온다(첫 렌더에서 실제로 그랬다). */
const FORM = { x: 90, y: 150, w: 380, h: 490 };
const TABLET = { x: 520, y: MID_Y - 115, w: 170, h: 230 };
const PHONE = { x: 730, y: MID_Y - 120, w: 120, h: 240 };
const MAIL = { x: 890, y: MID_Y - 58, w: 160, h: 116 };
const BOX = { x: 1110, w: 740 };
/** 등장 전 자리표시 불투명도 */
const GHOST = 0.22;
/* 🔴 세 자리가 들어오는 시차는 **0.3초 안에** 끝낸다(30fps 기준 9프레임).
   v1 은 34·46·58프레임(1.1→1.9초)이라 도입 스틸마다 화면이 다르게 비어 보였다. */
const AT_TABLET = 3;
const AT_PHONE = 6;
const AT_MAIL = 9;
const AT_BOX = 12;

/**
 * 🔴 `ghost` = **첫 프레임부터 자리를 잡아 두는 옅은 상태**(2026-09-21).
 *
 * 왜: v1 에서 이 장면은 왼쪽 서식 카드만 먼저 들어오고 오른쪽 문서함이 3초 뒤에 도착해,
 * 도입 0.6초 스틸로 보면 **화면 오른쪽 절반이 통째로 비어** 잘린 것처럼 보였다.
 * 요소를 나중에 「등장」시키되 자리는 처음부터 옅게 차 있게 한다 — 화면 구성은 첫 프레임에
 * 완성돼 있고, 등장은 그 위에 또렷해지는 것으로 읽힌다.
 */
const Appear: React.FC<{
  at: number;
  from?: [number, number];
  ghost?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ at, from = [-70, 0], ghost = 0, children, style }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  return (
    <div
      style={{
        position: "absolute",
        opacity: ghost + (1 - ghost) * p,
        transform: `translate(${(1 - p) * from[0] * (1 - ghost)}px, ${(1 - p) * from[1] * (1 - ghost)}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** 기기 테두리 — 화면 안에 들어가는 것은 전부 실캡처다 */
const Device: React.FC<{
  box: { x: number; y: number; w: number; h: number };
  radius: number;
  at: number;
  children: React.ReactNode;
}> = ({ box, radius, at, children }) => (
  <Appear at={at} from={[-40, 0]} ghost={GHOST} style={{ left: box.x, top: box.y }}>
    <div
      style={{
        width: box.w,
        height: box.h,
        borderRadius: radius,
        background: "#1B2430",
        padding: 9,
        boxShadow: `0 22px 48px ${C.shadow}`,
      }}
    >
      {children}
    </div>
  </Appear>
);

export const Branch: React.FC<{ mute?: boolean }> = ({ mute }) => {
  const frame = useCurrentFrame();
  const a01 = geo("A01");
  /* 🔴 태블릿 화면은 C01(빈 화면)이 아니라 **C02(채워진 화면)** 을 쓴다.
     C01 은 「입력 시작」 전 상태라 제품이 스스로 지면을 어둡게 한다(평균 밝기 138 대 246).
     그대로 얹으면 옆의 폰(B03·밝음)과 밝기가 따로 놀아 합성이 잘못된 것처럼 보였다
     (2026-09-18 오케스트레이터 지적 → 2026-09-21 원인이 캡처 상태임을 밝기 실측으로 확인).
     C02 가 없으면 C01b(「입력 시작」 직후의 밝은 빈 서식) → C01 순으로 물러선다.
     C01 까지 내려가면 다시 어두워진다. */
  const c02 = geo("C02");
  const c01b = geo("C01b");
  const c01 = geo("C01");
  const tablet = c02 ?? c01b ?? c01;
  const tabletSrc = c02 ? SHOT_FILES.C02 : c01b ? SHOT_FILES.C01b : SHOT_FILES.C01;
  const b03 = geo("B03");

  const fillCard = fillSeq().card ?? null;

  const lineP = interpolate(frame, [14, 58], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const joinP = interpolate(frame, [76, 122], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

  const targets = [TABLET, PHONE, MAIL];

  return (
    <Stage variant="light" logo="br">
      <Narration id="branch" mute={mute} />

      {/* 갈라지고 다시 모이는 선 */}
      <AbsoluteFill>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {targets.map((t, i) => {
            const y = t.y + t.h / 2;
            return (
              <path
                key={`out${i}`}
                d={`M ${FORM.x + FORM.w} ${MID_Y} C ${FORM.x + FORM.w + 60} ${MID_Y}, ${t.x - 60} ${y}, ${t.x - 10} ${y}`}
                stroke={C.blue}
                strokeWidth={3}
                fill="none"
                opacity={0.45 * lineP}
                strokeDasharray={260}
                strokeDashoffset={260 * (1 - lineP)}
              />
            );
          })}
          {targets.map((t, i) => {
            const y = t.y + t.h / 2;
            return (
              <path
                key={`in${i}`}
                d={`M ${t.x + t.w + 10} ${y} C ${t.x + t.w + 60} ${y}, ${BOX.x - 60} ${MID_Y}, ${BOX.x - 8} ${MID_Y}`}
                stroke={C.blue}
                strokeWidth={3}
                fill="none"
                opacity={0.45 * joinP}
                strokeDasharray={260}
                strokeDashoffset={260 * (1 - joinP)}
              />
            );
          })}
        </svg>
      </AbsoluteFill>

      {/* 이폼사인에서 만든 서식 한 장 — 🔴 **값이 든 실캡처**를 쓴다.
          디자이너 화면(A01)은 입력값이 전부 「[텍스트]」 플레이스홀더라
          「이 서식이 세 자리에서 쓰인다」는 이 장면에서 설득력이 없었다(2026-09-21).
          fill-seq 의 밝은 마지막 프레임(실제로 채워진 외부 작성 화면)으로 바꾸고,
          그 캡처가 없을 때만 A01 로 물러선다. 목업은 그리지 않는다. */}
      {fillCard ? (
        <Appear at={0} from={[0, 40]} ghost={GHOST} style={{ left: FORM.x, top: FORM.y }}>
          <CaptureBox
            src={shotLayer(fillCard.frame).src}
            capture={fillCard}
            crop={cropTop(fillCard.page, FORM.w / FORM.h, fillCard)}
            width={FORM.w}
            height={FORM.h}
            radius={14}
          />
        </Appear>
      ) : a01 && a01.fieldsArea ? (
        <Appear at={0} from={[0, 40]} ghost={GHOST} style={{ left: FORM.x, top: FORM.y }}>
          <CaptureBox
            src={shotLayer(SHOT_FILES.A01).src}
            capture={a01}
            crop={rectToAspect(padRect(a01.fieldsArea, 70, a01), FORM.w / FORM.h, a01)}
            width={FORM.w}
            height={FORM.h}
            radius={14}
          />
        </Appear>
      ) : null}

      {/* 같은 서식이 열리는 세 자리 */}
      {tablet ? (
        <Device box={TABLET} radius={20} at={AT_TABLET}>
          <CaptureBox
            src={shotLayer(tabletSrc).src}
            capture={tablet}
            crop={screenCrop(tablet, (TABLET.w - 18) / (TABLET.h - 18))}
            width={TABLET.w - 18}
            height={TABLET.h - 18}
            radius={10}
            shadow={false}
          />
        </Device>
      ) : null}
      {b03 ? (
        <Device box={PHONE} radius={24} at={AT_PHONE}>
          <CaptureBox
            src={shotLayer(SHOT_FILES.B03).src}
            capture={b03}
            crop={screenCrop(b03, (PHONE.w - 18) / (PHONE.h - 18))}
            width={PHONE.w - 18}
            height={PHONE.h - 18}
            radius={14}
            shadow={false}
          />
        </Device>
      ) : null}
      <Appear at={AT_MAIL} from={[-40, 0]} ghost={GHOST} style={{ left: MAIL.x, top: MAIL.y }}>
        <svg width={MAIL.w} height={MAIL.h} viewBox="0 0 160 116">
          <rect x={2} y={2} width={156} height={112} rx={12} fill="#FFFFFF" stroke={C.border} strokeWidth={3} />
          <path d="M8 16 L80 68 L152 16" fill="none" stroke={C.blue} strokeWidth={5} strokeLinejoin="round" />
        </svg>
      </Appear>

      {/* 같은 문서함으로 */}
      <Appear at={AT_BOX} from={[40, 0]} ghost={GHOST} style={{ left: BOX.x, top: MID_Y - 164 }}>
        <Inbox from={92} every={26} width={BOX.w} shot={trimInbox(inboxShot())} />
      </Appear>

      <CaptionBar lines={S.captions} from={8} tone="light" size={56} />
    </Stage>
  );
};
