import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { ThreeCanvas } from "@remotion/three";
import { continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { handLayerSpec, type HandKey, type HandLayerSpec } from "../hand";
import { CANVAS_H, CANVAS_W, HAND3D, HAND3D_V34, SHADOW_PAD, HAND3D_VARIANTS, hand3dPose, shadowPoint, texelWorld, type Hand3DParams } from "../hand3d";
import { isHandCand, orbitDeg, useCand } from "../cand";
import { cameraFor } from "./three/pixel-space";

/**
 * 손 층 — 레인 H3D(2026-09-30): 실사 손 컷아웃 한 장을 three.js **휘는 격자**로 3D 렌더한다.
 * (레인 V 의 CSS 2D 컷아웃 + drop-shadow 를 대체. 자세·높이·그림자 식 = src/hand3d.ts, 게이트와 공용)
 *
 * 🔴 `Photo` 의 children 안, **캡처 층들 뒤(=위)** 에 둔다 — 캔버스(1920x1080 사진 좌표, z=0 = 사진 평면)가
 *    사진과 같은 CSS 카메라 변환을 받고, 손이 언제나 화면 캡처 위에 온다.
 * 🔴 손 층은 자르지 않는다(레인 H) — 캔버스는 사진 전체 크기이고 클립·마스크가 없다.
 * 🔴 소재 = hand-03.png 알파 그대로(`python tools/make-hand-layer.py --check` 통과본). 새 알파를 만들지 않는다.
 * 색: 셰이더가 PNG 화소를 **변환 없이** 그대로 내보낸다(premultiplied 업로드 + ONE/ONE_MINUS_SRC_ALPHA).
 */

const VERT_HAND = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FRAG_HAND = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(map, vUv); }
`;
/* 그림자: 같은 실루엣을 빛 방향으로 z=0 에 투영한 격자. 높이(aH)에 비례해 흐리고 옅게(손끝은 또렷) */
const VERT_SHADOW = /* glsl */ `
attribute float aH;
varying vec2 vUv;
varying float vH;
void main() { vUv = uv; vH = aH; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FRAG_SHADOW = /* glsl */ `
uniform sampler2D map;
uniform vec2 texSize;
uniform float blur0;
uniform float blurPerZ;
uniform float opNear;
uniform float opFar;
uniform float zFar;
uniform vec3 color;
varying vec2 vUv;
varying float vH;
/* 레인 HS: 텍스처 밖(그림자 격자 여백) 표본 = 0 — ClampToEdge 가장자리 화소 번짐 금지 */
float sa(vec2 p) { return (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) ? 0.0 : texture2D(map, p).a; }
void main() {
  float r = blur0 + blurPerZ * vH;
  float acc = 0.0;
  for (int i = 0; i < 32; i++) {
    float fi = float(i);
    float rr = sqrt((fi + 0.5) / 32.0);
    float th = fi * 2.39996323;
    acc += sa(vUv + vec2(cos(th), sin(th)) * rr * r / texSize);
  }
  acc /= 32.0;
  float a = acc * mix(opNear, opFar, clamp(vH / zFar, 0.0, 1.0));
  gl_FragColor = vec4(color * a, a);
}
`;

const premulBlend = (m: THREE.ShaderMaterial) => {
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = false;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return m;
};

/**
 * 🔴 텍스처는 캔버스 **밖에서** 먼저 읽고, 다 읽은 뒤에 캔버스를 띄운다 — 캔버스 안에서 읽으면 R3F 가 첫 프레임을
 *    텍스처 없이 그리고(frameloop=never) 다시 그리지 않아 손이 빈다(레인 H3D 첫 스틸 실측).
 *    delayRender 는 캔버스가 마운트된 뒤(effect)에 푼다 — ThreeCanvas 의 자체 delayRender 가 먼저 걸리게.
 */
const useHandTexture = (file: string) => {
  const [handle] = useState(() => delayRender(`hand texture ${file}`));
  const [ready, setReady] = useState(false);
  const tex = useMemo(() => {
    const t = new THREE.TextureLoader().load(
      staticFile(`gen/${file}`),
      () => setReady(true),
      undefined,
      () => { setReady(true); },
    );
    // 🔴 색 변환 없이(NoColorSpace) · premultiplied 업로드(가장자리 필터링에 배경색이 새지 않게)
    t.colorSpace = THREE.NoColorSpace;
    t.premultiplyAlpha = true;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }, [file]);
  useEffect(() => { if (ready) continueRender(handle); }, [ready, handle]);
  useEffect(() => () => tex.dispose(), [tex]);
  return ready ? tex : null;
};

/** 컷아웃 격자(텍셀 좌표 u,v 와 uv, 삼각형 색인). 위치는 프레임마다 채운다.
 *  pad > 0 = 사방으로 넓힌 격자(그림자 전용, uv 가 [0,1] 밖으로 나간다 — 레인 HS) */
const buildGrid = (w: number, h: number, step: number, pad = 0) => {
  const nu = Math.ceil((w + 2 * pad) / step) + 1, nv = Math.ceil((h + 2 * pad) / step) + 1;
  const tex = new Float32Array(nu * nv * 2);
  const uv = new Float32Array(nu * nv * 2);
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const u = Math.min(w + pad, i * step - pad), v = Math.min(h + pad, j * step - pad);
      const k = j * nu + i;
      tex[k * 2] = u; tex[k * 2 + 1] = v;
      uv[k * 2] = u / w; uv[k * 2 + 1] = 1 - v / h;
    }
  const idx: number[] = [];
  for (let j = 0; j < nv - 1; j++)
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  return { tex, uv, idx, n: nu * nv };
};

const HandMeshes: React.FC<{
  spec: HandLayerSpec;
  keys: HandKey[];
  from: number;
  map: THREE.Texture;
  /** 레인 B 후보용(본편 = HAND3D·궤도 없음) */
  P?: Hand3DParams;
  orbit?: boolean;
}> = ({ spec, keys, from, map, P = HAND3D, orbit = false }) => {
  const frame = useCurrentFrame() - from;
  const [w, h] = spec.size;
  const grid = useMemo(() => buildGrid(w, h, P.step), [w, h, P.step]);
  const sgrid = useMemo(() => buildGrid(w, h, P.step, SHADOW_PAD), [w, h, P.step]);
  const { handGeo, shadowGeo } = useMemo(() => {
    const mk = (gr: typeof grid) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(gr.n * 3), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(gr.uv, 2));
      g.setIndex(gr.idx);
      return g;
    };
    const hg = mk(grid);
    const sg = mk(sgrid);
    sg.setAttribute("aH", new THREE.BufferAttribute(new Float32Array(sgrid.n), 1));
    return { handGeo: hg, shadowGeo: sg };
  }, [grid, sgrid]);
  const { handMat, shadowMat } = useMemo(() => {
    const hm = premulBlend(new THREE.ShaderMaterial({ uniforms: { map: { value: map } }, vertexShader: VERT_HAND, fragmentShader: FRAG_HAND }));
    const sm = premulBlend(
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: map },
          texSize: { value: new THREE.Vector2(w, h) },
          blur0: { value: P.blur0 },
          blurPerZ: { value: P.blurPerZ },
          opNear: { value: P.shadowNear },
          opFar: { value: P.shadowFar },
          zFar: { value: P.kneeBase + P.kneeLift + P.armMax },
          color: { value: new THREE.Vector3(20 / 255, 24 / 255, 30 / 255) },
        },
        vertexShader: VERT_SHADOW,
        fragmentShader: FRAG_SHADOW,
      }),
    );
    return { handMat: hm, shadowMat: sm };
  }, [map, w, h, P]);
  useEffect(() => () => { handGeo.dispose(); shadowGeo.dispose(); handMat.dispose(); shadowMat.dispose(); }, [handGeo, shadowGeo, handMat, shadowMat]);

  const pose = hand3dPose(spec, keys, frame, P);
  /* 후보 C: 사진 판이 CSS rotateY(θ) 로 돌 때, 떠 있는 점만 높이 × sinθ 만큼 더 옆으로(1차 근사 패럴랙스). 접촉점(z=0)은 불변 */
  const orbitS = orbit ? Math.sin((orbitDeg(frame) * Math.PI) / 180) : 0;
  if (pose.visible) {
    // 🔴 렌더 본문에서 동기 갱신 — R3F 가 이 프레임을 그리기 전에 격자가 채워져 있어야 한다(결정적)
    const hp = handGeo.getAttribute("position") as THREE.BufferAttribute;
    const sp = shadowGeo.getAttribute("position") as THREE.BufferAttribute;
    const sh = shadowGeo.getAttribute("aH") as THREE.BufferAttribute;
    for (let k = 0; k < grid.n; k++) {
      const [x, y, z] = texelWorld(spec, pose, grid.tex[k * 2], grid.tex[k * 2 + 1], P);
      hp.setXYZ(k, x + z * orbitS - CANVAS_W / 2, CANVAS_H / 2 - y, z);
    }
    for (let k = 0; k < sgrid.n; k++) {
      const [x, y, z] = texelWorld(spec, pose, sgrid.tex[k * 2], sgrid.tex[k * 2 + 1], P);
      const zc = Math.max(0, z);
      const [sx, sy] = shadowPoint(x, y, zc, P);
      sp.setXYZ(k, sx - CANVAS_W / 2, CANVAS_H / 2 - sy, 0.2);
      sh.setX(k, zc);
    }
    hp.needsUpdate = sp.needsUpdate = sh.needsUpdate = true;
    handGeo.computeBoundingSphere();
    shadowGeo.computeBoundingSphere();
  }
  return (
    <>
      <mesh geometry={shadowGeo} material={shadowMat} renderOrder={1} visible={pose.visible} frustumCulled={false} />
      <mesh geometry={handGeo} material={handMat} renderOrder={2} visible={pose.visible} frustumCulled={false} />
    </>
  );
};

export const HandLayer: React.FC<{ keys: HandKey[]; from?: number }> = ({ keys, from = 0 }) => {
  const spec = handLayerSpec();
  const cand = useCand();
  const P = isHandCand(cand) ? HAND3D_VARIANTS[cand] : cand === "v34" ? HAND3D_V34 : HAND3D;
  const map = useHandTexture(spec?.file ?? "hand-03.png");
  if (!spec || !keys.length || !map) return null;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, pointerEvents: "none" }}>
      {/* dpr 2: 사진 카메라(≤1.08)×StagePane(1.55) 확대 뒤에도 손 화소가 컷아웃 원본 해상도 이상 */}
      <ThreeCanvas
        width={CANVAS_W}
        height={CANVAS_H}
        dpr={2}
        camera={cameraFor(CANVAS_H)}
        flat
        linear
        gl={{ alpha: true, premultipliedAlpha: true, antialias: false }}
      >
        <HandMeshes spec={spec} keys={keys} from={from} map={map} P={P} orbit={cand === "hC"} />
      </ThreeCanvas>
    </div>
  );
};
