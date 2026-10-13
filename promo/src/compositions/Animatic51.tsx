import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { FONT_BODY, FONT_HEAD } from "../theme";
import { V51_SCENES, type V51SceneId } from "../script";
import durations from "../scene-durations-v51.json";
import cuesJson from "../animatic-v51-cues.json";

/**
 * v5.1 애니매틱 — 스틸 + 나레이션 + 자막 + 0.5초 크로스페이드(2026-10-13).
 * 정본 = tools/storyboard-sets/v5.1.json(소재·카피) · src/scene-durations-v51.json(길이) ·
 *        src/animatic-v51-cues.json(2분할 장면 교체 시점).
 * 모션은 느린 켄번스(1.00→1.04)뿐. 오디오 = 나레이션만(BGM·SFX·룸톤 없음).
 *
 * 크로스페이드: 경계 b 에서 다음 장면 층이 [b-7, b+8) 동안 0→1 로 겹쳐 오른다(앞 장면은 b+8 까지 불투명 유지).
 * 총길이는 장면 길이 합 그대로(겹침으로 줄이지 않는다) — 나레이션은 각 장면 시작 + lead 에 재생된다.
 */
const FADE = 15;
const PRE = 7; // 경계 앞쪽으로 당겨 시작하는 프레임
const POST = FADE - PRE; // 경계 뒤로 남는 프레임

type Timeline = { scenes: Record<string, { startFrame: number; frames: number; narrationSec: number }>; totalFrames: number; leadSec: number };
const T = durations as unknown as Timeline;
const CUES = (cuesJson as unknown as { cues: Record<string, number> }).cues;
export const ANIMATIC51_FRAMES = T.totalFrames;

/* ---------- 화면 소재(storyboard-sets/v5.1.json 과 같은 소재·같은 크롭) ---------- */
type Still =
  | { kind: "cover"; src: string }
  | { kind: "tablet"; src: string; y: number } // 1920 폭 원본에서 y 부터 1080 을 보인다(시트와 같은 위쪽 크롭)
  | { kind: "ph"; text: string }
  | { kind: "phlogo"; text: string; small: string; src: string }
  | { kind: "logo"; src: string };

const TAB1: Still = { kind: "tablet", src: "shots/demo/tablet/V3-step1-filled-x25.png", y: 520 };
const TAB2: Still = { kind: "tablet", src: "shots/demo/tablet/V3-step2-filled-x25.png", y: 520 };
const LOGO_SRC = "brand/eformsign-logo-original.png";

/** 장면별 스틸 순서. 2분할 장면은 [왼쪽, 오른쪽] 을 시간 순으로, 교체 시점 = CUES[id] */
const STILLS: Record<V51SceneId, Still[]> = {
  hook: [{ kind: "cover", src: "gen/gen-01.png" }],
  promise: [{ kind: "cover", src: "gen/gen-02.png" }, TAB1],
  bridge: [{ kind: "cover", src: "gen/gen-01.png" }, TAB1],
  visitor: [TAB1, TAB2],
  staff: [{ kind: "cover", src: "gen/gen-06.png" }, { kind: "ph", text: "1장 N명 문서함 PC 재캡처 필요" }],
  expand: [{ kind: "phlogo", text: "이폼사인 실제 서식 목록 화면 재캡처 필요", small: "계약서 · 동의서 · 신청서", src: LOGO_SRC }],
  cta: [{ kind: "logo", src: LOGO_SRC }],
};

/**
 * bridge 는 시트에서 「신규 제작 · 의도 합성(종이 → 태블릿)」 칸이다. 교체 시점 규정이 브리프에 없어
 * 장면 중간에서 교체한다(visitor 와 같은 규칙).
 */
const cueOf = (id: V51SceneId, frames: number) => (id === "bridge" ? Math.round(frames / 2) : CUES[id]);

const KO: React.CSSProperties = { wordBreak: "keep-all", overflowWrap: "break-word", lineBreak: "strict" };

const StillView: React.FC<{ s: Still }> = ({ s }) => {
  switch (s.kind) {
    case "cover":
      return <Img src={staticFile(s.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
    case "tablet":
      return (
        <AbsoluteFill style={{ overflow: "hidden", background: "#dfe4ec" }}>
          <Img src={staticFile(s.src)} style={{ width: 1920, marginTop: -s.y, display: "block" }} />
        </AbsoluteFill>
      );
    case "ph":
      return (
        <AbsoluteFill style={{ background: "#c9ced6", alignItems: "center", justifyContent: "center", padding: "0 160px" }}>
          <div style={{ ...KO, fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 64, color: "#4a5260", textAlign: "center", lineHeight: 1.35 }}>{s.text}</div>
        </AbsoluteFill>
      );
    case "phlogo":
      return (
        <AbsoluteFill style={{ background: "#c9ced6", alignItems: "center", justifyContent: "center", gap: 36, padding: "0 160px", flexDirection: "column" }}>
          <div style={{ ...KO, fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 60, color: "#4a5260", textAlign: "center", lineHeight: 1.35 }}>{s.text}</div>
          <div style={{ ...KO, fontFamily: FONT_BODY, fontSize: 40, color: "#3a4250" }}>{s.small}</div>
          <div style={{ background: "#fff", borderRadius: 16, padding: "18px 36px", display: "flex" }}>
            <Img src={staticFile(s.src)} style={{ width: 360, height: "auto", display: "block" }} />
          </div>
        </AbsoluteFill>
      );
    case "logo":
      return (
        <AbsoluteFill style={{ background: "#fff", alignItems: "center", justifyContent: "center" }}>
          <Img src={staticFile(s.src)} style={{ width: "46%", height: "auto" }} />
        </AbsoluteFill>
      );
  }
};

/** 로마자·숫자 덩어리(eformsign.com 등)는 갈라지지 않게 */
const nb = (line: string) =>
  line.split(/([A-Za-z0-9][A-Za-z0-9.\-]*)/).map((part, i) =>
    /^[A-Za-z0-9]/.test(part) ? <span key={i} style={{ whiteSpace: "nowrap" }}>{part}</span> : <React.Fragment key={i}>{part}</React.Fragment>,
  );

const CaptionBlock: React.FC<{ lines: string[]; opacity: number }> = ({ lines, opacity }) => (
  <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 72, opacity }}>
    <div
      style={{
        maxWidth: 1600,
        background: "rgba(10,20,36,0.72)",
        borderRadius: 18,
        padding: "22px 48px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      {lines.map((l) => (
        <div
          key={l}
          style={{
            ...KO,
            textWrap: "balance" as React.CSSProperties["textWrap"],
            fontFamily: FONT_HEAD,
            fontWeight: 800,
            fontSize: 58,
            lineHeight: 1.28,
            letterSpacing: -0.5,
            color: "#fff",
            textAlign: "center",
          }}
        >
          {nb(l)}
        </div>
      ))}
    </div>
  </AbsoluteFill>
);

/** 한 장면 층 — 로컬 프레임 0 = 장면 시작보다 pre 프레임 앞 */
const SceneLayer: React.FC<{ id: V51SceneId; frames: number; pre: number; post: number; lines: string[] }> = ({ id, frames, pre, post, lines }) => {
  const f = useCurrentFrame();
  const local = f - pre; // 장면 시작 기준
  const span = pre + frames + post;
  const layerOpacity = pre > 0 ? interpolate(f, [0, FADE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const scale = interpolate(f, [0, span], [1.0, 1.04], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const stills = STILLS[id];
  const cue = stills.length > 1 ? cueOf(id, frames) : Infinity;
  // 2분할 장면: 교체 시점 cue 를 가운데 두고 0.5초 크로스페이드
  const second = stills.length > 1 ? interpolate(local, [cue - PRE, cue + POST], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;

  // 자막: 장면 경계 기준 순차 — 앞 자막은 [끝-7, 끝) 에 사라지고 다음 자막은 [시작, 시작+8) 에 나타난다
  const capIn = pre > 0 ? interpolate(local, [0, POST], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const capOut = post > 0 ? interpolate(local, [frames - PRE, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;

  return (
    <AbsoluteFill style={{ opacity: layerOpacity, background: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <StillView s={stills[0]} />
        {stills.length > 1 && (
          <AbsoluteFill style={{ opacity: second }}>
            <StillView s={stills[1]} />
          </AbsoluteFill>
        )}
      </AbsoluteFill>
      <CaptionBlock lines={lines} opacity={Math.min(capIn, capOut)} />
    </AbsoluteFill>
  );
};

export const Animatic51: React.FC = () => {
  const n = V51_SCENES.length;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {V51_SCENES.map((s, i) => {
        const t = T.scenes[s.id];
        const pre = i > 0 ? PRE : 0;
        const post = i < n - 1 ? POST : 0;
        return (
          <Sequence key={s.id} from={t.startFrame - pre} durationInFrames={pre + t.frames + post} name={`v51-${s.id}`}>
            <SceneLayer id={s.id} frames={t.frames} pre={pre} post={post} lines={s.captions} />
          </Sequence>
        );
      })}
      {V51_SCENES.map((s) => {
        const t = T.scenes[s.id];
        if (!(t.narrationSec > 0)) return null;
        return (
          <Sequence key={`a-${s.id}`} from={t.startFrame + Math.round(T.leadSec * 30)} durationInFrames={t.frames} name={`voice-${s.id}`}>
            <Audio src={staticFile(`voice/v51-${s.id}.mp3`)} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

