import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Corners, cornersToMatrix3d } from "./ScreenComposite";
import { FONT_HAND } from "../theme";
import { InkStyle } from "../geometry";

/**
 * 종이 지면 위에 손글씨를 **원근 매핑**으로 얹는다.
 *
 * 왜 있나: 생성 이미지의 방명록은 카운터에 눕혀 놓여 있어 지면이 화면 평면과
 * 크게 어긋난다. 화면 좌표에 그냥 텍스트를 놓으면 글씨가 지면이 아니라 공기 위에
 * 떠 버린다. 그래서 ScreenComposite 의 4점 homography 로 지면 사각형에 눕힌다.
 *
 * 🔴 **방향이 이 컴포넌트의 핵심이고, 이미지마다 다시 도출해야 한다.**
 *    규칙은 하나다 — 글줄은 **책등에 수직**, 줄은 **책등과 나란히** 쌓인다.
 *      · 2차 gen-01: 책등이 카운터와 나란히(화면 가로) → 글줄은 화면 깊이 방향이었다.
 *      · 3차 gen-01: 책등이 카운터 앞모서리에 수직, 카메라가 쓰는 사람 뒤 → 글줄은 화면 가로
 *        왼→오른, 줄은 화면 위→아래.
 *      · 4차 gen-01(현재): 카메라가 **카운터 건너편**으로 넘어가 쓰는 사람을 정면으로 본다.
 *        괘선은 여전히 화면 가로지만 **좌우·상하가 함께 뒤집힌다** — 쓰는 사람의 왼→오른이
 *        화면 오른→왼, 페이지 위쪽(첫 줄)이 화면 아래다. 그래서 카메라에서 글씨는
 *        **180° 뒤집혀** 보이는 것이 물리적으로 맞다(거울상이 아니다).
 *
 *    이 컴포넌트는 방향을 **모른다** — corners 를 언제나 **페이지 로컬 순서**로 받는다
 *    (tl = 첫 줄이 시작하는 모서리, +x = 글줄 진행, +y = 줄 쌓임).
 *    화면 라벨 → 페이지 로컬 배정은 `src/geometry.ts` 의 배정표가,
 *    그 근거값은 `public/gen/prompts.json` 의 `pageLocalFromScreen` 이 갖는다.
 *
 * 🔴 **크기는 px 가 아니라 괘선 간격(pitch)의 배수다.** 사람이 종이에 쓸 때 글자 높이는
 *    괘선에 종속된다(0.7~0.8배). px 로 잡으면 글자가 괘선 두세 줄을 덮어
 *    「지면 위에 오려 붙인 자막」으로 읽힌다 — 2026-09-18 판이 실제로 pitch 의 2.6배였다.
 *    pitch·첫 괘선 위치는 이미지에서 잰 값(prompts.json geometry.ruling)이고
 *    표현 비율은 geometry.ink 다. **이 파일에 수치를 박지 않는다.**
 *
 * 🔴 **한 사람 = 괘선 한 줄.** 이름과 연락처는 위아래가 아니라 **같은 줄에 나란히** 쓴다
 *    (방명록 서식이 그렇게 생겼다).
 *
 * 🔴 생성 이미지 안의 글자는 쓰지 않는다 — 글자는 전부 Remotion 으로 그린다
 *    (기획서 10절 1-1). 이름·번호는 전부 가짜다.
 *
 * 원근: 로컬 좌표를 homography 로 보내므로 **가까운 쪽 글자가 저절로 크고 먼 쪽이
 * 작다**. 별도 스케일 보정을 하지 않는다.
 */
export interface InkRow {
  /** 이름 칸 (가짜) */
  name: string;
  /** 연락처 칸 (가짜) */
  phone: string;
}

/** 시드 고정 난수 — 같은 프레임은 언제 렌더해도 같은 흔들림이어야 한다(재현성) */
const rand = (seed: number) => {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) % 10000) / 10000;
};

/**
 * 글자마다 미세하게 흔들리는 손글씨 한 덩이.
 * 🔴 과장 금지 — 기울기 ±tilt, 기준선 ±jitter 를 넘기면 글씨가 아니라 장난으로 보인다.
 */
const HandText: React.FC<{
  text: string;
  size: number;
  jitter: number;
  tilt: number;
  seed: number;
  color: string;
  opacity: number;
}> = ({ text, size, jitter, tilt, seed, color, opacity }) => (
  <span
    style={{
      fontFamily: FONT_HAND,
      fontSize: size,
      lineHeight: 1,
      color,
      opacity,
      whiteSpace: "nowrap",
      wordBreak: "keep-all",
    }}
  >
    {Array.from(text).map((ch, i) => {
      const r1 = rand(seed + i * 31);
      const r2 = rand(seed + i * 71 + 7);
      return (
        <span
          key={`${ch}-${i}`}
          style={{
            display: "inline-block",
            transform: `translateY(${(r1 - 0.5) * 2 * jitter}px) rotate(${(r2 - 0.5) * 2 * tilt}deg)`,
          }}
        >
          {ch === " " ? " " : ch}
        </span>
      );
    })}
  </span>
);

export const PaperInk: React.FC<{
  /** 지면(펼친 한 쪽)의 네 꼭짓점 — **페이지 로컬 순서**, 컴포지션 좌표계 px */
  corners: Corners;
  rows: InkRow[];
  /** 괘선 간격과 첫 괘선 위치(페이지 로컬 px) — 이미지에서 잰 값 */
  pitch: number;
  firstRuleAt: number;
  /** 표현 비율 묶음 — prompts.json geometry.ink */
  ink: InkStyle;
  /** 지면 로컬 좌표계 크기. 측정 블록(ruling.pageWidth/Height)과 같은 값이어야 한다 */
  pageWidth?: number;
  pageHeight?: number;
  /** 첫 줄이 써지기 시작하는 프레임 */
  from?: number;
  /** 줄 사이 간격(프레임) */
  stagger?: number;
  /** 한 줄이 다 써지는 데 걸리는 프레임 */
  strokeFrames?: number;
  /**
   * 종이색 스크림 세기 (0 = 끄기, 기본값).
   * 🔴 기본을 0 으로 둔다 — Photo 의 어두운 스크림 위에 지면만 밝히면 **지면 사각형이
   *    도드라져 종이가 아니라 화면 위에 붙인 판때기로 보인다**(2026-09-18 4차 렌더에서
   *    책 밖 카운터까지 밝은 네모가 떠 보였다).
   */
  scrim?: number;
  /** 첫 row 가 들어갈 칸 번호(0-base, 기본 = 괘선 한 줄이 한 칸) */
  startSlot?: number;
}> = ({
  corners,
  rows,
  pitch,
  firstRuleAt,
  ink,
  pageWidth = 620,
  pageHeight = 880,
  from = 6,
  stagger = 18,
  strokeFrames = 16,
  scrim = 0,
  startSlot = 0,
}) => {
  const frame = useCurrentFrame();
  const matrix = cornersToMatrix3d(corners, pageWidth, pageHeight);

  /** 전부 괘선 간격의 배수 — px 상수 없음 */
  const step = pitch * Math.max(ink.rulesPerEntry, 1);
  const nameSize = pitch * ink.glyphOfPitch;
  const phoneSize = nameSize * ink.phoneOfName;
  const jitter = pitch * ink.jitterOfPitch;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: pageWidth,
        height: pageHeight,
        transform: matrix,
        transformOrigin: "0 0",
        overflow: "hidden",
      }}
    >
      {/* 종이색 스크림 — 지면 안쪽에만. 어두운 자막 스크림에 눌린 지면을 되살린다 */}
      {scrim > 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(118% 135% at 46% 52%, rgba(253,251,245,${scrim}) 0%, rgba(250,246,238,${scrim * 0.86}) 58%, rgba(250,246,238,0) 100%)`,
          }}
        />
      ) : null}

      {rows.map((row, i) => {
        const start = from + i * stagger;
        /** 글줄이 나아가는 방향(로컬 +x)으로 걷어낸다 = 왼→오른으로 써 나가는 느낌 */
        const wipe = interpolate(frame, [start, start + strokeFrames], [100, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const appear = interpolate(frame, [start, start + 3], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const slot = startSlot + i;
        /** 괘선 y → 글자 상자는 그 괘선 **바로 위**에 앉는다 */
        const ruleY = firstRuleAt + slot * step;
        const top = ruleY - pitch * ink.baselineDropOfPitch;
        const seed = ink.seed + slot * 977;
        /** 줄마다 조금씩 어긋난 기울기 — 사람이 쓰면 줄이 완전히 수평일 수 없다 */
        const tilt = (rand(seed) - 0.5) * 2 * ink.tiltDeg;
        const dx = (rand(seed + 3) - 0.5) * 2 * jitter;

        return (
          <div
            key={row.name + row.phone + slot}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top,
              height: step,
              transform: `rotate(${tilt}deg)`,
              transformOrigin: "0 50%",
              clipPath: `inset(0 ${wipe}% 0 0)`,
              opacity: appear,
            }}
          >
            {/* 🔴 괘선은 그리지 않는다 — 캡처 지면에 인쇄 괘선이 이미 있다.
                글자 크기·줄 위치를 그 괘선에 맞추는 것이 「괘선 위에 쓴 글씨」를 만든다. */}
            <div style={{ position: "absolute", left: pageWidth * ink.nameAtX + dx, top: 0 }}>
              <HandText
                text={row.name}
                size={nameSize}
                jitter={jitter}
                tilt={ink.tiltDeg}
                seed={seed + 11}
                color={ink.color}
                opacity={ink.opacity}
              />
            </div>
            <div
              style={{
                position: "absolute",
                left: pageWidth * ink.phoneAtX + dx,
                top: (nameSize - phoneSize) * 0.55,
              }}
            >
              <HandText
                text={row.phone}
                size={phoneSize}
                jitter={jitter * 0.8}
                tilt={ink.tiltDeg}
                seed={seed + 53}
                color={ink.color}
                opacity={ink.opacity * 0.94}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
