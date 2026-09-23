import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, EASE, EASE_OUT, FONT_BODY } from "../theme";
import { cornersToMatrix3d, type Corners } from "./ScreenComposite";
import { occluderUrl, type Rect } from "../shots-scenes";

/**
 * 이폼사인 **실캡처를 그대로 보여 주는** 부품들.
 *
 * 원칙(기획서 10절): 이폼사인 화면은 목업으로 그리지 않는다. 그래서 여기 있는 것은
 * 전부 「캡처 화소를 자르고, 옮기고, 그 위에 커서·테두리만 얹는」 도구다.
 * 캡처에 **없는 UI 를 새로 그리는 부품은 하나도 없다.**
 *
 * 좌표계: 모든 rect·점은 **캡처 원본 화소** 기준이다. 화면 px 로 환산하는 것은
 * `CaptureBox` 한 곳에서만 일어나므로 장면 코드에 배율이 흩어지지 않는다.
 */

const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t,
});

/**
 * 캡처의 `crop` 영역을 `width`×`height` 상자에 꽉 채워 보여 준다.
 * children 은 **캡처 화소 좌표**로 배치하면 캡처와 함께 움직인다.
 */
export const CaptureBox: React.FC<{
  src: string;
  capture: { width: number; height: number };
  crop: Rect;
  width: number;
  height: number;
  radius?: number;
  shadow?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ src, capture, crop, width, height, radius = 18, shadow = true, style, children }) => {
  // 가로를 기준으로 맞춘다. crop 비율과 상자 비율이 같도록 장면에서 잡아 두면 정확히 채워진다
  const k = width / crop.w;
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        borderRadius: radius,
        background: "#FFFFFF",
        boxShadow: shadow ? `0 28px 70px ${C.shadow}` : undefined,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -crop.x * k,
          top: -crop.y * k,
          width: capture.width * k,
          height: capture.height * k,
        }}
      >
        <Img
          src={src}
          style={{ width: "100%", height: "100%", display: "block", maxWidth: "none" }}
        />
      </div>
      {/* children 은 캡처 화소 좌표 → 같은 배율·같은 원점 */}
      <div
        style={{
          position: "absolute",
          left: -crop.x * k,
          top: -crop.y * k,
          width: capture.width,
          height: capture.height,
          transform: `scale(${k})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
};

/**
 * 캡처 위 카메라 — `from` 사각형에서 `to` 사각형으로 천천히 밀고 들어간다.
 * 정지 캡처가 소재이므로 이 움직임이 장면의 리듬을 만든다.
 */
export const ShotFocus: React.FC<{
  src: string;
  capture: { width: number; height: number };
  from: Rect;
  to: Rect;
  durationInFrames: number;
  width: number;
  height: number;
  radius?: number;
  shadow?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ src, capture, from, to, durationInFrames, children, ...rest }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  return (
    <CaptureBox src={src} capture={capture} crop={lerpRect(from, to, t)} {...rest}>
      {children}
    </CaptureBox>
  );
};

/**
 * 캡처에 **이미 있는** 요소를 감싸는 강조 테두리.
 * 🔴 없는 UI 를 그리지 않는다 — rect 는 `tools/measure-scenes.mjs` 가 잰 자리다.
 */
export const Highlight: React.FC<{
  rect: Rect;
  from?: number;
  /** 사라지는 프레임(없으면 계속 남는다) */
  until?: number;
  pad?: number;
  color?: string;
  thickness?: number;
}> = ({ rect, from = 0, until, pad = 10, color = C.blue, thickness = 5 }) => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [from, from + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const gone =
    until == null
      ? 1
      : interpolate(frame, [until, until + 8], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const o = appear * gone;
  if (o <= 0.01) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x - pad,
        top: rect.y - pad,
        width: rect.w + pad * 2,
        height: rect.h + pad * 2,
        border: `${thickness}px solid ${color}`,
        borderRadius: 10,
        boxShadow: `0 0 0 ${Math.round(thickness * 2)}px rgba(14,115,195,0.16)`,
        opacity: o,
        transform: `scale(${0.96 + o * 0.04})`,
        transformOrigin: "center",
      }}
    />
  );
};

/** 커서가 지나갈 자리 — 캡처 화소 좌표 */
export interface CursorStop {
  at: number;
  x: number;
  y: number;
  /** 도착하면서 누른다 */
  click?: boolean;
}

/** 캡처 위 커서. 캡처에 있는 요소 사이만 오간다 */
export const Cursor: React.FC<{ stops: CursorStop[]; size?: number }> = ({
  stops,
  size = 54,
}) => {
  const frame = useCurrentFrame();
  if (stops.length === 0) return null;
  const times = stops.map((s) => s.at);
  const x = interpolate(frame, times, stops.map((s) => s.x), {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const y = interpolate(frame, times, stops.map((s) => s.y), {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const appear = interpolate(frame, [stops[0].at - 8, stops[0].at], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const clicks = stops.filter((s) => s.click);

  return (
    <>
      {clicks.map((s) => {
        const p = interpolate(frame, [s.at, s.at + 16], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE_OUT,
        });
        if (p <= 0 || p >= 1) return null;
        return (
          <div
            key={`c${s.at}`}
            style={{
              position: "absolute",
              left: s.x - size * 1.2,
              top: s.y - size * 1.2,
              width: size * 2.4,
              height: size * 2.4,
              borderRadius: 999,
              border: `4px solid ${C.blue}`,
              opacity: 1 - p,
              transform: `scale(${0.4 + p * 0.9})`,
            }}
          />
        );
      })}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        style={{
          position: "absolute",
          left: x,
          top: y,
          opacity: appear,
          filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.45))",
        }}
      >
        <path
          d="M4 2 L4 19 L8.6 14.6 L11.4 21.4 L14.4 20.1 L11.6 13.5 L18 13.2 Z"
          fill="#FFFFFF"
          stroke="#111826"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
};

/**
 * 생성 이미지의 기기 화면 4점에 **잘라 낸 실캡처**를 원근 매핑한다.
 *
 * 🔴 `ScreenComposite` 는 캡처를 `objectFit: cover` 로만 얹는다. 태블릿(세로 0.57)과
 *    외부 작성 캡처(0.75)처럼 비율이 다르면 가운데만 남고 어디가 잘렸는지 통제할 수 없다.
 *    그래서 자르는 곳을 장면이 정하도록 crop 을 받는다.
 */
export const QuadShot: React.FC<{
  src: string;
  capture: { width: number; height: number };
  crop: Rect;
  corners: Corners;
  /**
   * `src` 가 **미리 축소된 사본**일 때 그 축소 배율(0<k≤1). `crop`·`capture`·children 좌표는
   * 언제나 **원본 캡처 화소** 기준으로 넘기고, 이 값만 바꾼다.
   *
   * 🔴 왜(2026-09-21 v3): 1920px 캡처를 matrix3d 로 한 번에 345px 로 줄이면 브라우저가
   *    밉맵 없이 이중선형 표본화만 해서 글자·괘선이 계단·모아레로 깨진다(사용자 지적
   *    「쭈굴쭈굴」). `tools/prescale-shots.mjs` 로 목표 화면 크기의 1.2~1.5배로 미리
   *    lanczos 축소한 사본을 만들고, 그 사본을 이 배율과 함께 넘긴다.
   */
  srcScale?: number;
  opacity?: number;
  glare?: boolean;
  children?: React.ReactNode;
}> = ({ src, capture, crop, corners, srcScale = 1, opacity = 1, glare = true, children }) => {
  /**
   * 층을 둘로 나눈다 — 캡처 층은 **축소 사본 화소 크기**로, 덧그림(커서·강조) 층은
   * **원본 캡처 좌표**로. 같은 네 점에 각각 원근 매핑하면 두 층이 정확히 겹친다
   * (matrix3d 는 「이 크기의 상자를 이 네 점으로」라서 상자 크기가 달라도 결과는 같은 사각형).
   *
   * 🔴 children 을 crop 로컬 좌표에 두면 안 된다(2026-09-21 v3 전까지 그랬다). Manage 의
   *    커서·강조는 캡처 화소 좌표(`d02.search`)로 오는데, crop 이 x=0·y=0 일 때만 우연히
   *    맞았다. viewport 자르기가 들어오면 crop.x 가 0 이 아니게 되어 전부 어긋난다.
   */
  const k = srcScale;
  const imgBox = { w: crop.w * k, h: crop.h * k };
  const imgMatrix = cornersToMatrix3d(corners, imgBox.w, imgBox.h);
  const overMatrix = cornersToMatrix3d(corners, crop.w, crop.h);
  const common: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    transformOrigin: "0 0",
    overflow: "hidden",
    /* 서브픽셀 흔들림·뒷면 렌더 억제 — 정지 캡처가 프레임마다 미세하게 떨리는 것을 막는다 */
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    willChange: "transform",
  };
  return (
    <>
      <div
        style={{
          ...common,
          width: imgBox.w,
          height: imgBox.h,
          transform: imgMatrix,
          background: "#FFFFFF",
          opacity,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -crop.x * k,
            top: -crop.y * k,
            width: capture.width * k,
            height: capture.height * k,
          }}
        >
          <Img
            src={src}
            style={{ width: "100%", height: "100%", display: "block", maxWidth: "none" }}
          />
        </div>
      </div>
      <div
        style={{
          ...common,
          width: crop.w,
          height: crop.h,
          transform: overMatrix,
          opacity,
          pointerEvents: "none",
        }}
      >
        {children ? (
          <div
            style={{
              position: "absolute",
              left: -crop.x,
              top: -crop.y,
              width: capture.width,
              height: capture.height,
            }}
          >
            {children}
          </div>
        ) : null}
        {glare ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(118deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0) 40%, rgba(255,255,255,0) 74%, rgba(255,255,255,0.10) 100%)",
            }}
          />
        ) : null}
      </div>
    </>
  );
};

/**
 * 생성 이미지에서 오려 낸 **가리는 물체**를 캡처 층 위에 한 겹 더 얹는다.
 *
 * 🔴 `Photo` 의 children 안에 두어야 한다 — 배경 사진과 **같은 카메라 변환**을 받아야
 *    손끝이 화면과 함께 움직인다. 배경 Img 와 같은 조판(width/height 100% · cover)이라
 *    화소가 정확히 겹친다. 마스크가 없는 이미지면 아무것도 그리지 않는다.
 */
export const Occluder: React.FC<{ gen: string }> = ({ gen }) => {
  const url = occluderUrl(gen);
  if (!url) return null;
  return (
    <Img
      src={url}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        pointerEvents: "none",
      }}
    />
  );
};

/**
 * 1920×1080 무대를 좁은 칸(분할 화면의 한쪽)에 끼워 넣는다.
 *
 * 왜 필요한가: 생성 이미지의 기기 화면 4점은 **1920×1080 좌표**로 재 뒀다. 사진을
 * 좁은 칸에 그냥 넣으면 사진만 잘리고 4점은 그대로라 합성물이 어긋난다.
 * 무대째로 확대·이동해야 사진과 합성물이 함께 움직인다.
 */
export const StagePane: React.FC<{
  paneWidth: number;
  paneHeight: number;
  /** 화면 가운데에 두고 싶은 지점(1920×1080 좌표) */
  focus: [number, number];
  /** 배율. 칸을 덮는 최소 배율보다 작으면 자동으로 올린다 */
  zoom?: number;
  children: React.ReactNode;
}> = ({ paneWidth, paneHeight, focus, zoom = 1, children }) => {
  const cover = Math.max(paneWidth / 1920, paneHeight / 1080);
  const s = Math.max(zoom, cover);
  // 초점이 칸 가운데 오도록 옮기되, 무대 밖(빈 띠)이 보이지 않게 잘라 맞춘다
  const tx = Math.min(0, Math.max(paneWidth - 1920 * s, paneWidth / 2 - focus[0] * s));
  const ty = Math.min(0, Math.max(paneHeight - 1080 * s, paneHeight / 2 - focus[1] * s));
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          transform: `translate(${tx}px, ${ty}px) scale(${s})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
};

/**
 * 컷 하나. `from` 프레임에 시작해 `fade` 프레임 동안 앞 컷 위로 겹쳐 뜬다.
 * 앞 컷의 Sequence 를 겹치게 잡아 두면 크로스페이드가 된다.
 */
export const Cut: React.FC<{
  fade?: number;
  /** 컷이 끝나며 사라지는 길이(겹치는 다음 컷이 없을 때만 쓴다) */
  out?: { at: number; len?: number };
  children: React.ReactNode;
}> = ({ fade = 10, out, children }) => {
  const frame = useCurrentFrame();
  // 🔴 fade 0 을 그대로 interpolate 에 넣으면 inputRange [0,0] 으로 렌더가 죽는다
  const inP =
    fade <= 0
      ? 1
      : interpolate(frame, [0, fade], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const outP = out
    ? interpolate(frame, [out.at, out.at + (out.len ?? fade)], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: inP * outP }}>{children}</div>
  );
};

/** 소재가 아직 없어 뺀 컷을 알리는 아주 작은 표시(개발 확인용, 기본 꺼짐) */
export const MissingNote: React.FC<{ text: string; show?: boolean }> = ({ text, show }) =>
  show ? (
    <div
      style={{
        position: "absolute",
        left: 24,
        bottom: 24,
        fontFamily: FONT_BODY,
        fontSize: 20,
        color: C.dim,
        background: "rgba(255,255,255,0.8)",
        padding: "6px 12px",
        borderRadius: 8,
        wordBreak: "keep-all",
      }}
    >
      {text}
    </div>
  ) : null;

/** public/shots 아래 파일을 Remotion 주소로 */
export const shotSrc = (rel: string) => staticFile(`shots/${rel}`);
