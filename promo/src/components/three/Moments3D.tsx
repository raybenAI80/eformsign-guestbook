import React, { useMemo } from "react";
import * as THREE from "three";
import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, Easing, useCurrentFrame, useVideoConfig } from "remotion";
import { C, EASE } from "../../theme";
import {
  SoftDaylight,
  cameraFor,
  lerp,
  matte,
  pixelDistance,
  px,
  seg,
  useCanvasTexture,
} from "./pixel-space";

/**
 * v3.3 레인 T — three.js 연출 세 곳(YAGNI: 이 세 곳 밖에는 쓰지 않는다).
 *   ① PaperLiftTransition  Paper → Designer 경계 0.6초 — 종이 방명록 한 장이 들려 올라
 *      Designer 카드 자리에 포개지고 사라진다(종이 → 디지털 서식).
 *   ② DocStackDrop          Manage 도입 1초 — 완료 문서 카드 3장이 노트북 화면 자리로 차례로 내려앉는다.
 *                           실캡처(D01)는 그 뒤에 나타난다.
 *   ③ CtaPanel3D            CTA 0.8초 — 살짝 기운 패널이 정면으로 돈다. 로고·주소는 DOM(제공 PNG)이
 *                           같은 원근으로 함께 돈다(`ctaFaceStyle`).
 *
 * 🔴 전부 진행률 0~1 → 프레임 결정적. 자막 층에 넣지 않는다(각 장면이 자막을 이 위에 따로 얹는다).
 */

/* ────────────────────────── 텍스처(선·도형만, 글자 없음) ────────────────────────── */

/** 펼친 방명록 지면 — 가운데 접힘 그늘 + 괘선 + 손글씨 흉내(결정적 곡선) */
const drawGuestbookSpread = (g: CanvasRenderingContext2D, w: number, h: number) => {
  g.fillStyle = "#FBFAF5";
  g.fillRect(0, 0, w, h);
  const fold = g.createLinearGradient(w / 2 - 60, 0, w / 2 + 60, 0);
  fold.addColorStop(0, "rgba(90,80,60,0)");
  fold.addColorStop(0.5, "rgba(90,80,60,0.16)");
  fold.addColorStop(1, "rgba(90,80,60,0)");
  g.fillStyle = fold;
  g.fillRect(w / 2 - 60, 0, 120, h);
  const margin = w * 0.05;
  const pitch = h / 13;
  for (const side of [0, 1]) {
    const x0 = side === 0 ? margin : w / 2 + margin;
    const x1 = side === 0 ? w / 2 - margin : w - margin;
    g.fillStyle = "rgba(14,115,195,0.10)";
    g.fillRect(x0, pitch * 0.9, x1 - x0, pitch * 0.8);
    g.strokeStyle = "rgba(60,90,130,0.28)";
    g.lineWidth = 2;
    for (let r = 2; r < 13; r++) {
      g.beginPath();
      g.moveTo(x0, r * pitch);
      g.lineTo(x1, r * pitch);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(x0 + (x1 - x0) * 0.38, pitch * 0.9);
    g.lineTo(x0 + (x1 - x0) * 0.38, 12 * pitch);
    g.stroke();
    const rows = side === 0 ? 10 : 4;
    g.strokeStyle = "rgba(20,30,60,0.72)";
    g.lineWidth = 3;
    for (let r = 0; r < rows; r++) {
      const y = (r + 2) * pitch + pitch * 0.62;
      for (const [a, b] of [
        [0.04, 0.3],
        [0.44, 0.9],
      ]) {
        g.beginPath();
        const xa = x0 + (x1 - x0) * a;
        const xb = x0 + (x1 - x0) * (b - ((r * 7) % 5) * 0.03);
        for (let k = 0; k <= 40; k++) {
          const x = lerp(xa, xb, k / 40);
          const yy = y - Math.abs(Math.sin(k * 1.7 + r * 0.9)) * pitch * 0.32;
          if (k === 0) g.moveTo(x, yy);
          else g.lineTo(x, yy);
        }
        g.stroke();
      }
    }
  }
};

/** 완료 문서 한 장 — 파란 머리띠 + 회색 줄 + 오른쪽 아래 완료 체크(메인 컬러만) */
const drawDoneDoc = (g: CanvasRenderingContext2D, w: number, h: number) => {
  g.fillStyle = "#FFFFFF";
  g.fillRect(0, 0, w, h);
  g.fillStyle = C.blue;
  g.fillRect(0, 0, w, h * 0.11);
  g.fillStyle = "#D9E0EA";
  for (let r = 0; r < 7; r++) {
    const y = h * (0.2 + r * 0.085);
    g.fillRect(w * 0.1, y, w * (r % 3 === 2 ? 0.5 : 0.8), h * 0.022);
  }
  g.strokeStyle = "#C3CCD8";
  g.lineWidth = w * 0.01;
  g.strokeRect(w * 0.1, h * 0.8, w * 0.42, h * 0.11);
  const cx = w * 0.76;
  const cy = h * 0.855;
  const r = w * 0.11;
  g.fillStyle = C.blue;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#FFFFFF";
  g.lineWidth = r * 0.28;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(cx - r * 0.45, cy + r * 0.02);
  g.lineTo(cx - r * 0.1, cy + r * 0.36);
  g.lineTo(cx + r * 0.5, cy - r * 0.32);
  g.stroke();
};

/* ────────────────────────── 공통: 얇은 판(Box) ────────────────────────── */

/** 앞면(+z)에만 텍스처. BoxGeometry 재질 순서 = +x,-x,+y,-y,+z,-z */
const Slab: React.FC<{
  w: number;
  h: number;
  depth: number;
  face: THREE.Material;
  edge: THREE.Material;
  back?: THREE.Material;
  position: [number, number, number];
  rotation: [number, number, number];
  castShadow?: boolean;
}> = ({ w, h, depth, face, edge, back, position, rotation, castShadow }) => {
  const mats = useMemo(() => [edge, edge, edge, edge, face, back ?? edge], [edge, face, back]);
  return (
    <mesh position={position} rotation={rotation} material={mats} castShadow={castShadow}>
      <boxGeometry args={[w, h, depth]} />
    </mesh>
  );
};

/** 들어올리기는 천천히 떼어 천천히 내려놓는다(EASE 는 첫 프레임에 튀어 나간다) */
const LIFT_EASE = Easing.inOut(Easing.cubic);

/* ────────────────────────── ① Paper → Designer ────────────────────────── */

/**
 * 진행률 0 ~ 0.55 들어올리기(탁자 위에 누운 지면 → 곧게 세워 Designer 카드 자리) · 0.6 ~ 1 사라지기.
 * 장면 경계(하드컷)는 진행률 0.5 — 그때 지면이 카드 자리를 거의 덮는다.
 */
export const PaperLiftTransition: React.FC<{
  durationInFrames: number;
  /**
   * 이 조각이 전체 전환의 몇 번째 프레임부터인가. 전환은 두 장면에 반씩 나눠 넣는다
   * (각 장면의 **자막 아래** 층에 두어야 지면이 자막을 가리지 않는다) — Paper 쪽 0, Designer 쪽 절반.
   */
  offset?: number;
  /** 착지 자리(Designer 카드, 1920×1080 px) */
  target: { x: number; y: number; w: number; h: number };
}> = ({ durationInFrames, offset = 0, target }) => {
  const frame = useCurrentFrame() + offset;
  const { width, height } = useVideoConfig();
  const t = Math.min(1, Math.max(0, frame / Math.max(1, durationInFrames - 1)));
  const a = LIFT_EASE(seg(t, 0, 0.55));
  const opacity = seg(t, 0, 0.2) * (1 - seg(t, 0.6, 1));

  const tex = useCanvasTexture(2048, 950, drawGuestbookSpread, []);
  const face = useMemo(() => matte("#FFFFFF", { map: tex, transparent: true }), [tex]);
  const edge = useMemo(() => matte("#EDE8DC", { transparent: true }), []);
  face.opacity = opacity;
  edge.opacity = opacity;

  const aspect = target.w / target.h;
  const w = lerp(700, target.w, a);
  const h = w / aspect;
  const [sx, sy] = px(960, 600, width, height);
  const [ex, ey] = px(target.x + target.w / 2, target.y + target.h / 2, width, height);
  // 들어 올리는 호 — 앞으로 살짝 나왔다가 z=0 으로
  const z = Math.sin(a * Math.PI) * 120;

  if (opacity <= 0.001) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <ThreeCanvas width={width} height={height} camera={cameraFor(height)} flat>
        <SoftDaylight />
        <Slab
          w={w}
          h={h}
          depth={5}
          face={face}
          edge={edge}
          position={[lerp(sx, ex, a), lerp(sy, ey, a), z]}
          rotation={[lerp(-1.12, 0, a), lerp(0.2, 0, a), lerp(-0.06, 0, a)]}
        />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};

/* ────────────────────────── ② Manage 도입 ────────────────────────── */

/**
 * 이미지 좌표계(1920×1080) 사각형 `box` 에 캔버스를 깐다 — Photo children 으로 넣으면
 * 카메라 줌을 사진과 같이 받는다. 카드는 `land`(이미지 px) 로 차례로 내려앉는다.
 * 진행률 0~1 = 카드 3장 낙하(각 0.5, 0.22 간격) → 끝에 전부 착지.
 * 사라지기는 부모가 opacity 로 제어한다(실캡처와 녹이는 지점은 장면 쪽 결정).
 */
export const DocStackDrop: React.FC<{
  progress: number;
  box: { x: number; y: number; w: number; h: number };
  land: [number, number];
  cardW?: number;
}> = ({ progress, box, land, cardW = 150 }) => {
  const tex = useCanvasTexture(600, 800, drawDoneDoc, []);
  const face = useMemo(() => matte("#FFFFFF", { map: tex }), [tex]);
  const edge = useMemo(() => matte("#E6EAF0"), []);
  const shadowMat = useMemo(() => new THREE.ShadowMaterial({ opacity: 0.22, transparent: true }), []);
  const cardH = cardW * (4 / 3);
  const [lx, ly] = px(land[0] - box.x, land[1] - box.y, box.w, box.h);

  const cards = [0, 1, 2].map((i) => {
    const p = EASE(seg(progress, i * 0.22, i * 0.22 + 0.5));
    return {
      key: i,
      visible: progress >= i * 0.22,
      position: [
        lx + (i - 1) * 10 + (1 - p) * (i - 1) * 40,
        ly + i * 7 + (1 - p) * (box.h * 0.62),
        6 + i * 4 + (1 - p) * 90,
      ] as [number, number, number],
      rotation: [
        (1 - p) * 0.55,
        (1 - p) * (i - 1) * 0.25,
        [-0.07, 0.05, -0.015][i] + (1 - p) * (0.25 - i * 0.2),
      ] as [number, number, number],
    };
  });

  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        pointerEvents: "none",
      }}
    >
      <ThreeCanvas width={box.w} height={box.h} camera={cameraFor(box.h)} flat shadows="variance">
        <SoftDaylight shadows shadowSize={Math.max(box.w, box.h)} />
        {/* 그림자 받이 — 보이지 않는 판에 그림자만 */}
        <mesh position={[lx, ly, 0]} receiveShadow material={shadowMat}>
          <planeGeometry args={[box.w * 1.4, box.h * 1.4]} />
        </mesh>
        {cards.map((c) =>
          c.visible ? (
            <Slab
              key={c.key}
              w={cardW}
              h={cardH}
              depth={3}
              face={face}
              edge={edge}
              position={c.position}
              rotation={c.rotation}
              castShadow
            />
          ) : null,
        )}
      </ThreeCanvas>
    </div>
  );
};

/* ────────────────────────── ③ CTA 패널 ────────────────────────── */

/** CTA 회전량 — 진행률 0~1 (0 = 기운 상태, 1 = 정면) */
export const ctaTilt = (p: number) => {
  const e = EASE(Math.min(1, Math.max(0, p)));
  return { rx: lerp(0.16, 0, e), ry: lerp(-0.42, 0, e) };
};

/**
 * three 패널과 **같은 원근**으로 DOM 을 돌리는 CSS. 부모 = 1920×1080 전체, 회전 중심 = 화면 가운데.
 * 🔴 CSS 는 y 축이 아래라 X 회전 부호가 반대다(three rotX(a) ≡ CSS rotateX(-a)). Y 는 같다.
 *    순서도 같아야 한다: three Euler 'XYZ' 행렬 = Rx·Ry, CSS `rotateX() rotateY()` = Rx·Ry.
 */
export const ctaFaceStyle = (p: number, height: number): React.CSSProperties => {
  const { rx, ry } = ctaTilt(p);
  return {
    position: "absolute",
    inset: 0,
    transform: `perspective(${pixelDistance(height)}px) rotateX(${-rx}rad) rotateY(${ry}rad)`,
    transformOrigin: "50% 50%",
  };
};

export const CtaPanel3D: React.FC<{
  progress: number;
  /** 패널 크기(px) — 화면 가운데 */
  w: number;
  h: number;
  opacity: number;
}> = ({ progress, w, h, opacity }) => {
  const { width, height } = useVideoConfig();
  const { rx, ry } = ctaTilt(progress);
  const depth = 18;
  const face = useMemo(() => matte("#0B5E9F", { transparent: true }), []);
  const edge = useMemo(() => matte("#3C8FD0", { transparent: true }), []);
  const shadowMat = useMemo(() => new THREE.ShadowMaterial({ opacity: 0.28, transparent: true }), []);
  face.opacity = opacity;
  edge.opacity = opacity;
  shadowMat.opacity = 0.28 * opacity;
  if (opacity <= 0.001) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <ThreeCanvas width={width} height={height} camera={cameraFor(height)} flat shadows="variance">
        <SoftDaylight shadows shadowSize={1100} />
        <mesh position={[0, 0, -depth - 60]} receiveShadow material={shadowMat}>
          <planeGeometry args={[width * 1.6, height * 1.6]} />
        </mesh>
        {/* 앞면이 z=0 에 오도록 판 중심을 -depth/2 에 둔다 → 정면일 때 DOM 크기가 v3.2 와 같다 */}
        <group rotation={[rx, ry, 0]}>
          <Slab
            w={w}
            h={h}
            depth={depth}
            face={face}
            edge={edge}
            position={[0, 0, -depth / 2]}
            rotation={[0, 0, 0]}
            castShadow
          />
        </group>
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
