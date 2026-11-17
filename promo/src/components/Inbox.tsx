import React from "react";
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT_BODY, FONT_HEAD } from "../theme";
import type { InboxShot } from "../shots";
import { useCand } from "../cand";

/**
 * 이폼사인 문서함에 완료 문서가 한 장씩 쌓이는 모션.
 *
 * 두 가지 모드로 돈다(기획서 10절: 이폼사인 화면은 목업으로 그리지 않는다).
 *   ① `shot` 있음 = **정본**. 문서함 실화면 캡처를 깔고, 목록 세 행 자리를
 *      흰색으로 덮어 「빈 목록」에서 출발한 뒤, 그 행들이 아래에서 위로 도착한다.
 *      🔴 도착 행은 **다시 그리지 않는다** — 캡처의 그 행 화소를 그대로 오려 쓴다.
 *      그래서 글꼴·굵기·링크 색·행 높이가 실제 화면과 어긋날 수 없다.
 *      좌표는 `src/shots.ts`(근거: `tools/measure-inbox.mjs` 화소 스캔).
 *   ② `shot` 없음 = 임시. 흰 카드 리스트로 리듬만 확정한다.
 *      캡처가 오기 전까지만 쓰는 폴백이다.
 */
export interface InboxRow {
  title: string;
  who: string;
  at: string;
}

/** 데모용 가짜 데이터. 🔴 실데이터·실회사명 금지 */
export const DEMO_ROWS: InboxRow[] = [
  { title: "방문자 기록부", who: "김OO", at: "방금" },
  { title: "방문자 기록부", who: "이OO", at: "1분 전" },
  { title: "방문자 기록부", who: "박OO", at: "3분 전" },
  { title: "방문자 기록부", who: "최OO", at: "5분 전" },
  { title: "방문자 기록부", who: "정OO", at: "8분 전" },
];

const Row: React.FC<{ row: InboxRow; appearAt: number; width?: number }> = ({
  row,
  appearAt,
  width,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - appearAt,
    fps,
    config: { damping: 200, mass: 0.6 },
  });
  const p = interpolate(s, [0, 1], [0, 1]);

  return (
    <div
      style={{
        width,
        display: "flex",
        alignItems: "center",
        gap: 22,
        background: C.paper,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: "22px 26px",
        boxShadow: `0 14px 34px ${C.shadow}`,
        opacity: p,
        transform: `translateY(${(1 - p) * -26}px) scale(${0.97 + p * 0.03})`,
      }}
    >
      {/* 완료 표시 — 메인 컬러만 쓴다 */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: C.blue,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#FFFFFF",
          fontSize: 24,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        ✓
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: FONT_HEAD,
            fontWeight: 600,
            fontSize: 30,
            color: C.ink,
            wordBreak: "keep-all",
          }}
        >
          {row.title}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 24, color: C.dim, marginTop: 4 }}>
          {row.who} · 완료
        </div>
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 24, color: C.dim, flexShrink: 0 }}>
        {row.at}
      </div>
    </div>
  );
};

/**
 * 캡처의 한 행을 **오려서** 도착시키는 조각.
 * 캡처 전체를 다시 깔고 이 행만 보이게 잘라 낸다 → 화소가 원본과 동일하다.
 */
const ShotRow: React.FC<{
  shot: InboxShot;
  band: { top: number; height: number };
  /** 캡처 화소 → 화면 px 배율 */
  k: number;
  appearAt: number;
}> = ({ shot, band, k, appearAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - appearAt,
    fps,
    config: { damping: 200, mass: 0.7 },
  });

  const cand = useCand();
  const crop = (
    <Img
      src={shot.src}
      style={{
        position: "absolute",
        left: -shot.mask.x * k,
        top: -band.top * k,
        width: shot.capture.width * k,
        height: shot.capture.height * k,
        maxWidth: "none",
      }}
    />
  );
  if (cand === "c3") {
    /* 레인 B 후보 3: 오려 낸 실캡처 행이 **두께 있는 카드**로 앞·위에서 기울어 내려와 제자리에 눕는다(착지 = 캡처 화소 그대로) */
    const l = 1 - s; // 남은 들림 0..1
    const W = shot.mask.w * k, Hh = band.height * k;
    return (
      <div
        style={{
          position: "absolute",
          left: shot.mask.x * k,
          top: band.top * k,
          width: W,
          height: Hh,
          opacity: Math.min(1, s * 2.2),
          transformStyle: "preserve-3d",
          transformOrigin: "50% 100%",
          transform: `perspective(1100px) translateY(${l * -70}px) translateZ(${l * 180}px) rotateX(${l * 34}deg) rotateZ(${l * -2.5}deg)`,
          boxShadow: `0 ${6 + 30 * l}px ${10 + 44 * l}px rgba(12, 32, 64, ${0.12 + 0.3 * l})`,
        }}
      >
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#FFFFFF" }}>{crop}</div>
        {/* 카드 두께 — 아랫면(앞쪽으로 접힌 옆면) */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: Hh,
            width: W,
            height: 10,
            transformOrigin: "50% 0",
            transform: "rotateX(-90deg)",
            background: "linear-gradient(#C5CEDA, #E4E9EF)",
          }}
        />
      </div>
    );
  }
  return (
    <div
      style={{
        position: "absolute",
        left: shot.mask.x * k,
        top: band.top * k,
        width: shot.mask.w * k,
        height: band.height * k,
        overflow: "hidden",
        opacity: s,
        transform: `translateY(${(1 - s) * -18}px)`,
      }}
    >
      <Img
        src={shot.src}
        style={{
          position: "absolute",
          left: -shot.mask.x * k,
          top: -band.top * k,
          width: shot.capture.width * k,
          height: shot.capture.height * k,
          maxWidth: "none",
        }}
      />
    </div>
  );
};

export const Inbox: React.FC<{
  rows?: InboxRow[];
  /** 첫 문서가 도착하는 프레임 */
  from?: number;
  /** 문서 사이 간격(프레임) */
  every?: number;
  width?: number;
  /** 문서함 머리말 표시 (배경 캡처가 있으면 캡처의 머리말을 쓰므로 무시한다) */
  header?: boolean;
  /**
   * 🔴 이폼사인 문서함 **실화면 캡처** 배치표(`src/shots.ts`).
   * 주면 이 캡처가 화면이 되고, 목록 행이 캡처 화소 그대로 도착한다.
   * 없으면 임시 카드 렌더.
   */
  shot?: InboxShot;
}> = ({ rows = DEMO_ROWS, from = 6, every = 14, width = 760, header = true, shot }) => {
  const cand = useCand();
  if (shot) {
    // 캡처 화소 → 화면 px. 크롭 폭이 주어진 폭에 딱 맞도록 잡는다
    const k = width / shot.crop.w;
    // 아래 행(= 먼저 접수된 문서)부터 도착해 위로 쌓인다
    const last = shot.bands.length - 1;

    return (
      <div
        style={{
          width,
          height: shot.crop.h * k,
          position: "relative",
          overflow: "hidden",
          borderRadius: 18,
          border: `1px solid ${C.border}`,
          boxShadow: `0 24px 60px ${C.shadow}`,
          ...(cand === "c6"
            ? {
                /* 레인 B 후보 6: 실캡처 문서함 판 전체를 공간에 비스듬히 세운 판으로(오른쪽이 멀어짐) + 깊은 그림자 */
                transform: "perspective(1500px) rotateY(-14deg) rotateX(5deg) translateZ(-20px)",
                transformOrigin: "40% 50%",
                boxShadow: "-34px 40px 70px rgba(12, 32, 64, 0.34), -6px 8px 0 #C9D2DD",
              }
            : null),
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -shot.crop.x * k,
            top: -shot.crop.y * k,
            width: shot.capture.width * k,
            height: shot.capture.height * k,
          }}
        >
          <Img
            src={shot.src}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              maxWidth: "none",
            }}
          />
          {/* 도착 전 = 빈 목록. 캡처의 세 행을 목록 배경색으로 덮는다 */}
          <div
            style={{
              position: "absolute",
              left: shot.mask.x * k,
              top: shot.mask.y * k,
              width: shot.mask.w * k,
              height: shot.mask.h * k,
              background: "#FFFFFF",
            }}
          />
          {shot.bands.map((band, i) => (
            <ShotRow
              key={band.top}
              shot={shot}
              band={band}
              k={k}
              appearAt={from + (last - i) * every}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {header ? (
      <div
        style={{
          width,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 6px 6px",
        }}
      >
        <div
          style={{
            fontFamily: FONT_HEAD,
            fontWeight: 600,
            fontSize: 30,
            color: C.blue,
            wordBreak: "keep-all",
          }}
        >
          문서함 · 완료
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 24, color: C.dim }}>최신순</div>
      </div>
    ) : null}
      {rows.map((r, i) => (
        <Row key={`${r.who}-${i}`} row={r} appearAt={from + i * every} width={width} />
      ))}
    </div>
  );
};
