import React from "react";
import { Img, staticFile } from "remotion";
import { C, FONT_BODY } from "../theme";

/**
 * 생성 이미지의 "기기 화면 자리"에 이폼사인 실캡처를 얹는다.
 *
 * 생성 이미지는 화면을 빈 밝은 회색으로 만들어 받는다(기획서 6절 소재 ②).
 * 그 사각형의 네 꼭짓점을 화면 좌표(px)로 재서 corners 에 넣으면
 * CSS matrix3d 로 실캡처를 그 사각형에 정확히 맞춘다.
 *
 * 🔴 실캡처가 도착하기 전에는 shot 을 비워 두면 회색 플레이스홀더가 그려진다.
 *    실캡처 PNG 는 public/shots/ 에 두고 파일명만 넘긴다(저장소에 커밋하지 않는다).
 */
export type Corner = [number, number];
export interface Corners {
  tl: Corner;
  tr: Corner;
  br: Corner;
  bl: Corner;
}

/**
 * 단위 사각형(0,0)-(1,0)-(1,1)-(0,1) 을 네 꼭짓점으로 보내는 homography 를 구해
 * CSS matrix3d 문자열로 만든다. 기준 크기 w×h 의 요소에 적용한다.
 */
export function cornersToMatrix3d(c: Corners, w: number, h: number): string {
  const src: Corner[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const dst: Corner[] = [c.tl, c.tr, c.br, c.bl];

  // 8x8 선형계 풀이 (가우스 소거)
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    const tmp = M[col];
    M[col] = M[piv];
    M[piv] = tmp;
    const d = M[col][col] || 1e-9;
    for (let k = col; k <= n; k++) M[col][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (!f) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const h0 = M.map((r) => r[n]);
  const [a, bb, cc, d, e, f, g, i] = h0;
  /**
   * h0 는 u = (a·x + bb·y + cc)/w, v = (d·x + e·y + f)/w, w = g·x + i·y + 1 이다.
   * CSS matrix3d 는 **열 우선**이라 열 순서가 (m11,m12,m13,m14)(m21,…)(m31,…)(m41,…) 이고,
   *   X = m11·x + m21·y + m41,  Y = m12·x + m22·y + m42,  W = m14·x + m24·y + m44
   * 이므로 Y 행 계수는 (d, e, f) 다.
   * 🔴 2026-09-18 결함: 여기에 (e, f, d) 를 넣어 두었다 — 네 꼭짓점 중 tl 만 맞고
   *    나머지는 수십만 px 로 발산해 지면 위 덧글씨가 화면 전체를 덮었다.
   *    회귀 게이트 = tools/check-homography.mjs
   */
  return `matrix3d(${a}, ${d}, 0, ${g}, ${bb}, ${e}, 0, ${i}, 0, 0, 1, 0, ${cc}, ${f}, 0, 1)`;
}

export const ScreenComposite: React.FC<{
  /** public/shots/ 아래 실캡처 파일명. 비우면 회색 플레이스홀더 */
  shot?: string;
  /** 기기 화면 사각형의 네 꼭짓점(생성 이미지 좌표계 = 컴포지션 좌표계) */
  corners: Corners;
  /** 실캡처 원본 크기(픽셀). 비율이 어긋나면 이 값을 실제 캡처 크기로 맞춘다 */
  shotWidth?: number;
  shotHeight?: number;
  /** 화면 반사광 — 실사 합성 이질감을 줄인다 */
  glare?: boolean;
  children?: React.ReactNode;
}> = ({ shot, corners, shotWidth = 1280, shotHeight = 800, glare = true, children }) => {
  const matrix = cornersToMatrix3d(corners, shotWidth, shotHeight);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: shotWidth,
        height: shotHeight,
        transform: matrix,
        transformOrigin: "0 0",
        overflow: "hidden",
        background: "#E9EDF2",
      }}
    >
      {shot ? (
        <Img
          src={staticFile(`shots/${shot}`)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : children ? null : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              "repeating-linear-gradient(45deg, #E4E9EF 0 24px, #DCE2EA 24px 48px)",
            color: C.dim,
            fontFamily: FONT_BODY,
            fontSize: Math.round(shotHeight * 0.05),
            wordBreak: "keep-all",
          }}
        >
          실화면 캡처 자리
        </div>
      )}
      {children}
      {glare ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(118deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 72%, rgba(255,255,255,0.10) 100%)",
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
};
