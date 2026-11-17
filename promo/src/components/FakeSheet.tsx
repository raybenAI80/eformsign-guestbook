import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { FONT_BODY } from "../theme";

/**
 * 노트북 화면에 얹는 **가짜 스프레드시트**.
 *
 * 왜 있나: 밤 사무실 컷에서 노트북 화면이 빈 회색이라 「종이를 보고 옮겨 적는다」가
 * 읽히지 않았다. 표에 줄이 하나씩 늘어나면 「옮겨 적는 중」이 한눈에 읽힌다.
 *
 * 🔴 이폼사인 UI 를 그리지 않는다. 이건 그냥 스프레드시트다 — 브랜드 색(#0E73C3)도
 *    쓰지 않는다. 여기 보이는 것이 곧 「지금의 수작업」이기 때문이다.
 * 🔴 데이터는 전부 가짜다.
 */
export interface SheetRow {
  name: string;
  phone: string;
  at: string;
}

export const FakeSheet: React.FC<{
  rows: SheetRow[];
  /** 한 줄이 늘어나는 간격(프레임) */
  stagger?: number;
  from?: number;
  width?: number;
  height?: number;
}> = ({ rows, stagger = 12, from = 4, width = 1280, height = 800 }) => {
  const frame = useCurrentFrame();

  const headH = 64;
  const colH = 52;
  const rowH = 62;
  const cols = [
    { label: "A", title: "이름", w: 300 },
    { label: "B", title: "연락처", w: 460 },
    { label: "C", title: "방문 시각", w: 400 },
  ];
  const gridLeft = 120;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        width,
        height,
        background: "#FBFCFD",
        fontFamily: FONT_BODY,
        overflow: "hidden",
      }}
    >
      {/* 상단 도구 막대 — 색 없이 회색 톤만. 스프레드시트라는 것만 읽히면 된다 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          height: headH,
          background: "#E8EBEF",
          borderBottom: "3px solid #CFD5DD",
          display: "flex",
          alignItems: "center",
          gap: 22,
          paddingLeft: 28,
        }}
      >
        {[96, 72, 72, 130, 90].map((w, i) => (
          <div key={i} style={{ width: w, height: 18, borderRadius: 4, background: "#BFC7D1" }} />
        ))}
      </div>

      {/* 열 머리 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: headH,
          right: 0,
          height: colH,
          background: "#DFE4EA",
          borderBottom: "3px solid #C3CAD4",
        }}
      >
        {cols.reduce<{ x: number; nodes: React.ReactNode[] }>(
          (acc, c) => {
            acc.nodes.push(
              <div
                key={c.label}
                style={{
                  position: "absolute",
                  left: acc.x,
                  top: 0,
                  width: c.w,
                  height: colH,
                  borderRight: "2px solid #C3CAD4",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 30,
                  color: "#5A6473",
                  wordBreak: "keep-all",
                }}
              >
                {c.title}
              </div>,
            );
            acc.x += c.w;
            return acc;
          },
          { x: gridLeft, nodes: [] },
        ).nodes}
      </div>

      {/* 아직 채우지 않은 빈 행 — 화면 아래가 하얗게 비면 「종이 한 장」처럼 보인다 */}
      {Array.from({ length: Math.max(0, Math.ceil((height - headH - colH) / rowH)) }).map(
        (_, i) => {
          const top = headH + colH + i * rowH;
          return (
            <div
              key={`empty-${i}`}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top,
                height: rowH,
                borderBottom: "2px solid #E9ECF1",
                background: i % 2 ? "#F7F9FB" : "#FFFFFF",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: gridLeft,
                  height: rowH,
                  background: "#EDF0F4",
                  borderRight: "2px solid #C3CAD4",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 28,
                  color: "#A8B0BB",
                }}
              >
                {i + 1}
              </div>
              {cols.reduce<{ x: number; nodes: React.ReactNode[] }>(
                (acc, c) => {
                  acc.nodes.push(
                    <div
                      key={c.label}
                      style={{
                        position: "absolute",
                        left: acc.x,
                        top: 0,
                        width: c.w,
                        height: rowH,
                        borderRight: "2px solid #E9ECF1",
                      }}
                    />,
                  );
                  acc.x += c.w;
                  return acc;
                },
                { x: gridLeft, nodes: [] },
              ).nodes}
            </div>
          );
        },
      )}

      {/* 채워진 행 */}
      {rows.map((row, i) => {
        const start = from + i * stagger;
        const p = interpolate(frame, [start, start + 6], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const top = headH + colH + i * rowH;
        const cells = [row.name, row.phone, row.at];
        return (
          <div
            key={row.name + row.at + i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top,
              height: rowH,
              opacity: p,
              borderBottom: "2px solid #E3E7ED",
              background: i % 2 ? "#F4F6F9" : "#FFFFFF",
            }}
          >
            {/* 행 번호 칸 */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: gridLeft,
                height: rowH,
                background: "#EDF0F4",
                borderRight: "2px solid #C3CAD4",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                color: "#8A93A0",
              }}
            >
              {i + 1}
            </div>
            {cols.reduce<{ x: number; nodes: React.ReactNode[] }>(
              (acc, c, ci) => {
                acc.nodes.push(
                  <div
                    key={c.label}
                    style={{
                      position: "absolute",
                      left: acc.x,
                      top: 0,
                      width: c.w,
                      height: rowH,
                      borderRight: "2px solid #E3E7ED",
                      display: "flex",
                      alignItems: "center",
                      paddingLeft: 22,
                      fontSize: 32,
                      color: "#2E3542",
                      whiteSpace: "nowrap",
                      wordBreak: "keep-all",
                    }}
                  >
                    {cells[ci]}
                  </div>,
                );
                acc.x += c.w;
                return acc;
              },
              { x: gridLeft, nodes: [] },
            ).nodes}
          </div>
        );
      })}

      {/* 지금 입력 중인 칸 — 채워진 줄 바로 아래에서 깜빡인다. 「옮겨 적는 중」이라는 신호 */}
      <div
        style={{
          position: "absolute",
          left: gridLeft,
          top:
            headH +
            colH +
            Math.min(
              rows.length,
              Math.max(0, Math.ceil((frame - from) / stagger)),
            ) *
              rowH,
          width: cols[0].w,
          height: rowH,
          border: "4px solid #6F7A8A",
          background: "#FFFFFF",
          opacity: frame % 24 < 14 ? 1 : 0.45,
        }}
      />

      {/* 밤 사무실 스탠드 불빛에 섞이도록 따뜻한 기운을 살짝 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(255,206,142,0.13)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
};
