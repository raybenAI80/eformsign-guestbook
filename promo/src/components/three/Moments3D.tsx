import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { ThreeCanvas } from "@remotion/three";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
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
import {
  SHEET,
  TEXTURE_FILE,
  docCardPose,
  docCardSize,
  liftCamera,
  paperLiftState,
  type Rect,
} from "./moments-geometry";

/**
 * v3.3 레인 T — three.js 연출 세 곳(YAGNI: 이 세 곳 밖에는 쓰지 않는다).
 *   ① PaperLiftTransition  Paper → Designer 경계 0.6초 — Paper 앞 컷 끝에서 보였던 **실제 gen-01 방명록 지면**
 *      (손글씨 층 합성, public/three/guestbook-page.png)이 누운 채 나타나 들려 서며 Designer 카드 자리로
 *      줄어 포개지고 사라진다. 🔴 v3.3 레인 T2(2026-09-30): 1차의 선·지그재그 가짜 지면이 화면을 덮어
 *      자막을 가려 불통과 → 자리·크기는 moments-geometry.ts 가 측정값에서 풀고 게이트가 자막 겹침 0 을 잰다.
 *      🔴 레인 T3: 종이 = 읽는 쪽 **한 페이지**(guestbook-page.png, 손글씨 정방향 · 손/펜 제거), 높이 ≤ 화면 40%,
 *      착지 = Designer 카드 안 서식 페이지(세로 종이) 위.
 *   ② DocStackDrop          Manage 도입 1초 — 완료 문서 카드 3장(높이 = D01 화면 사각형의 25%)이 노트북 화면
 *                           안으로 차례로 내려앉아 살짝 겹쳐 놓인다. 실캡처(D01)는 그 뒤에 나타난다.
 *   ③ CtaPanel3D            CTA 0.8초 — 살짝 기운 패널이 정면으로 돈다. 로고·주소는 DOM(제공 PNG)이
 *                           같은 원근으로 함께 돈다(`ctaFaceStyle`).
 *
 * 🔴 전부 진행률 0~1 → 프레임 결정적. 자막 층에 넣지 않는다(각 장면이 자막을 이 위에 따로 얹는다).
 */

/* ────────────────────────── 텍스처(선·도형만, 글자 없음) ────────────────────────── */

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

/* ────────────────────────── ① Paper → Designer ────────────────────────── */

/**
 * 실제 gen-01 읽는 쪽 한 페이지 텍스처(손글씨 층 합성, 정사영, 페이지 로컬 = 정방향). 🔴 가짜 선·표 그림 금지(레인 T 1차 불통과).
 * 만드는 법 = `node tools/make-page-texture.mjs` (PageTexture 컴포지션 스틸).
 */
const useSpreadTexture = () => {
  const [handle] = useState(() => delayRender("guestbook-page texture"));
  const tex = useMemo(() => {
    const t = new THREE.TextureLoader().load(
      staticFile(TEXTURE_FILE),
      () => continueRender(handle),
      undefined,
      () => continueRender(handle),
    );
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [handle]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
};

/**
 * Paper 앞 컷 끝에서 보였던 **방명록 읽는 쪽 한 페이지**가 누운 채 나타나 들려 서며 Designer 서식 페이지 자리로
 * 줄어 포개지고 사라진다. 자리·크기·기울기는 전부 `moments-geometry.ts paperLiftState()` 가 푼다
 * (시작 = camera.ts 끝 배율에서의 지면 사각형, 끝 = 카드, 전 프레임 자막 띠 위 — 게이트
 * `tools/check-three-moments.mjs`). 여기서는 그 자세를 그리기만 한다.
 */
export const PaperLiftTransition: React.FC<{
  /**
   * 이 조각이 전체 전환의 몇 번째 프레임부터인가. 전환은 두 장면에 반씩 나눠 넣는다
   * (각 장면의 **자막 아래** 층) — Paper 쪽 0, Designer 쪽 절반.
   */
  offset?: number;
}> = ({ offset = 0 }) => {
  const f = useCurrentFrame() + offset;
  const { width, height } = useVideoConfig();
  const { pose, opacity } = paperLiftState(f);

  const tex = useSpreadTexture();
  /* 흰 무광 얇은 종이 — 앞면만 지면 사진, 옆·뒤는 흰 종이 */
  const face = useMemo(() => matte("#FFFFFF", { map: tex, transparent: true, roughness: 0.96 }), [tex]);
  const edge = useMemo(() => matte("#F5F3EE", { transparent: true, roughness: 0.96 }), []);
  face.opacity = opacity;
  edge.opacity = opacity;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: opacity <= 0.001 ? 0 : 1 }}>
      <ThreeCanvas width={width} height={height} camera={liftCamera()} flat>
        <SoftDaylight />
        <Slab
          w={SHEET.w * pose.k}
          h={SHEET.h * pose.k}
          depth={2}
          face={face}
          edge={edge}
          position={[pose.x, pose.y, pose.z]}
          rotation={[-pose.tilt, 0, 0]}
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
  box: Rect;
  land: [number, number];
}> = ({ progress, box, land }) => {
  const tex = useCanvasTexture(600, 800, drawDoneDoc, []);
  const face = useMemo(() => matte("#FFFFFF", { map: tex }), [tex]);
  const edge = useMemo(() => matte("#E6EAF0"), []);
  const shadowMat = useMemo(() => new THREE.ShadowMaterial({ opacity: 0.22, transparent: true }), []);
  /* 크기 = D01 화면 사각형 높이의 25%(moments-geometry docCardSize — 코드에 박지 않는다) */
  const { w: cardW, h: cardH } = docCardSize();
  const [lx, ly] = px(land[0] - box.x, land[1] - box.y, box.w, box.h);

  const cards = [0, 1, 2].map((i) => {
    const p = EASE(seg(progress, i * 0.22, i * 0.22 + 0.5));
    return { key: i, visible: progress >= i * 0.22, ...docCardPose(i, p, land, box) };
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
