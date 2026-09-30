import promptsJson from "../public/gen/prompts.json";
import type { Corners } from "./components/ScreenComposite";

/**
 * 생성 이미지 위에 무언가를 얹기 위한 **기하 정보의 단일 출처**.
 *
 * 🔴 좌표를 장면·컴포넌트에 박지 않는다. 생성 이미지는 기획 피드백에 따라 수시로
 *    다시 만들어져 덮어써지고(2026-09-18 에 gen-01.png 이 작업 도중 교체됐다),
 *    그때마다 코드에 박힌 좌표는 조용히 틀린 값이 된다.
 *    정본은 `public/gen/prompts.json` 이고, 재측정은 `node tools/measure-book.mjs` 다.
 */
type Quad = { tl: number[]; tr: number[]; br: number[]; bl: number[] };
interface RuleSide {
  pitch: number;
  rules: number;
  firstRuleAt: number;
  screenPitchPx?: number;
}
interface RulingBlock {
  pageWidth?: number;
  pageHeight?: number;
  left?: RuleSide;
  right?: RuleSide;
  penTip?: { page?: string; local?: number[]; slot?: number } | null;
}
interface InkBlock {
  glyphOfPitch?: number;
  rulesPerEntry?: number;
  baselineDropOfPitch?: number;
  nameAtX?: number;
  phoneAtX?: number;
  phoneOfName?: number;
  color?: string;
  opacity?: number;
  jitter?: { tiltDeg?: number; baselineOfPitch?: number; seed?: number };
  filledStartSlot?: number;
  filledRows?: number;
  activeLeadRows?: number;
}
interface CameraBlock {
  zoomFrom?: number;
  inkTargetPx?: number;
  glyphScreenOfPitch?: number;
  zoomMax?: number;
  endTarget?: number[];
}
interface GeometryBlock {
  bookQuad?: Quad;
  paperQuad?: Quad;
  pages?: { left: Quad; right: Quad };
  writerSide?: string;
  pageLocalFromScreen?: string;
  ruling?: RulingBlock;
  ink?: InkBlock;
  camera?: CameraBlock;
}
interface SceneBlock {
  scene: number;
  geometry?: GeometryBlock;
}

const scenes = (promptsJson as { scenes: SceneBlock[] }).scenes;

const toCorners = (q: { tl: number[]; tr: number[]; br: number[]; bl: number[] }): Corners => ({
  tl: [q.tl[0], q.tl[1]],
  tr: [q.tr[0], q.tr[1]],
  br: [q.br[0], q.br[1]],
  bl: [q.bl[0], q.bl[1]],
});

/**
 * 🔴 **화면 라벨 → 페이지 로컬 라벨 배정표.**
 *
 * prompts.json `geometry.pages.*` 의 tl/tr/br/bl 은 **화면 기준** 라벨이다(tl = 화면 좌상).
 * 글씨는 그 위에 **페이지 로컬** 좌표계(+x = 글줄 진행, +y = 줄 쌓임)로 얹으므로,
 * 두 라벨 사이의 배정을 이미지마다 다시 도출해야 한다. 정본 = `geometry.pageLocalFromScreen`.
 *
 * 4차 gen-01(카메라가 카운터 건너편, 쓰는 사람 정면) 의 근거:
 *   · 책의 **근(쓰는 사람 배 쪽) 변이 화면 위**, 원 변이 화면 아래다(그 사람 손이 화면 위에 있다).
 *   · 괘선은 화면 가로, 책등은 화면 세로(x≈852).
 *   · 쓰는 사람의 왼→오른 = **화면 오른→왼**, 페이지 위(첫 줄) = **화면 아래**.
 *   ⇒ 로컬 +x 는 화면 −x, 로컬 +y 는 화면 −y = **라벨 180° 회전**.
 *     거울상이 아니다(회전은 shoelace 부호를 보존한다 — check-homography 가 게이트한다).
 *
 * | 페이지 로컬 | 뜻                         | 4차 gen-01 화면 라벨 |
 * |-------------|----------------------------|----------------------|
 * | tl          | 첫 줄이 시작하는 모서리    | **br**               |
 * | tr          | 첫 줄이 끝나는 모서리      | **bl**               |
 * | br          | 마지막 줄이 끝나는 모서리  | **tl**               |
 * | bl          | 마지막 줄이 시작하는 모서리| **tr**               |
 *
 * (`rot0` = 카메라가 쓰는 사람 뒤에 있던 3차 이미지의 배정. 되살릴 일이 있으면
 *  그 이미지의 책등·펜에서 **다시** 도출해 prompts.json 에 적는다.)
 */
const rot180 = (c: Corners): Corners => ({ tl: c.br, tr: c.bl, br: c.tl, bl: c.tr });

const toPageLocal = (q: Quad): Corners => {
  const g = scenes.find((s) => s.scene === 1)?.geometry;
  const screen = toCorners(q);
  return g?.pageLocalFromScreen === "rot180" ? rot180(screen) : screen;
};

/** 화면 왼쪽 페이지 — **페이지 로컬 순서**로 돌려준다(위 배정표) */
export const bookPageLeft = (): Corners | null => {
  const g = scenes.find((s) => s.scene === 1)?.geometry;
  return g?.pages?.left ? toPageLocal(g.pages.left) : null;
};

/** 화면 오른쪽 페이지 — **페이지 로컬 순서**로 돌려준다(위 배정표) */
export const bookPageRight = (): Corners | null => {
  const g = scenes.find((s) => s.scene === 1)?.geometry;
  return g?.pages?.right ? toPageLocal(g.pages.right) : null;
};

/**
 * 지면 **괘선 간격**(페이지 로컬 px)과 첫 괘선 위치. 손글씨 크기·줄 위치는 전부 이 값의 배수다.
 *
 * 🔴 앞선 판(2026-09-18)의 "한 쪽 17줄" 은 페이지 로컬 프로파일의 FFT 최댓값이었는데,
 *    그 프로파일에는 괘선 신호가 **아예 없었다**(진폭 2~4 짜리 괘선이 지면 전폭 평균에서
 *    상쇄된다). 지금 값은 화면 세로 열 스캔으로 괘선 골을 직접 찾아 역매핑한 것이다.
 *    재측정 = `node tools/measure-book.mjs --rule-pitch --pen "x,y" --write`.
 */
const RULING_FALLBACK: RuleSide = { pitch: 54, rules: 16.3, firstRuleAt: 32 };
export const bookRuling = (side: "left" | "right"): RuleSide => {
  const g = scenes.find((s) => s.scene === 1)?.geometry;
  return g?.ruling?.[side] ?? RULING_FALLBACK;
};

/**
 * 지금 한 줄이 써지는 칸 번호(페이지 로컬 slot).
 * 🔴 눈대중이 아니라 **펜 끝 화면 좌표를 역매핑**해서 나온 값이다(measure-book --pen).
 *    괘선 pitch 가 바뀌면 칸 번호도 통째로 바뀌므로 코드에 박지 않는다.
 */
export const bookPenSlot = (): number => {
  const g = scenes.find((s) => s.scene === 1)?.geometry;
  const s = g?.ruling?.penTip?.slot;
  return typeof s === "number" ? s : 12;
};

/**
 * 손글씨 **표현값**(측정이 아니라 연출 결정). 전부 괘선 pitch 에 대한 비율이라
 * 이미지가 바뀌어 pitch 가 달라져도 글씨가 저절로 따라간다. 정본 = prompts.json geometry.ink
 */
export interface InkStyle {
  glyphOfPitch: number;
  rulesPerEntry: number;
  baselineDropOfPitch: number;
  nameAtX: number;
  phoneAtX: number;
  phoneOfName: number;
  color: string;
  opacity: number;
  tiltDeg: number;
  jitterOfPitch: number;
  seed: number;
  filledStartSlot: number;
  filledRows: number;
  activeLeadRows: number;
}
export const bookInk = (): InkStyle => {
  const k = scenes.find((s) => s.scene === 1)?.geometry?.ink ?? {};
  return {
    glyphOfPitch: k.glyphOfPitch ?? 0.76,
    rulesPerEntry: k.rulesPerEntry ?? 1,
    baselineDropOfPitch: k.baselineDropOfPitch ?? 0.86,
    nameAtX: k.nameAtX ?? 0.1,
    phoneAtX: k.phoneAtX ?? 0.46,
    phoneOfName: k.phoneOfName ?? 0.66,
    color: k.color ?? "#1B2A49",
    opacity: k.opacity ?? 0.85,
    tiltDeg: k.jitter?.tiltDeg ?? 1.5,
    jitterOfPitch: k.jitter?.baselineOfPitch ?? 0.06,
    seed: k.jitter?.seed ?? 20260921,
    filledStartSlot: k.filledStartSlot ?? 4,
    filledRows: k.filledRows ?? 9,
    activeLeadRows: k.activeLeadRows ?? 3,
  };
};

/** 지면 로컬 좌표계 크기 — 측정 블록과 같은 값을 써야 pitch 가 맞는다 */
export const bookPageSize = (): [number, number] => {
  const r = scenes.find((s) => s.scene === 1)?.geometry?.ruling;
  return [r?.pageWidth ?? 620, r?.pageHeight ?? 880];
};

/**
 * 펜이 놓인 쪽 = **지금 한 줄이 써지는 중인 페이지**. 화면 기준 "left" | "right".
 *
 * 🔴 이 값은 이미지마다 바뀐다. 카메라가 쓰는 사람 뒤에 있으면(3차 gen-01) 그 사람의
 *    오른손이 화면에서도 오른쪽이라 펜이 오른쪽 페이지에 있었다. 4차 gen-01 은 카메라가
 *    카운터 건너편으로 넘어가 좌우가 뒤집혀 **펜이 화면 왼쪽 페이지**에 온다.
 *    여기를 따라가지 않으면 「지금 써지는 줄」이 펜과 반대쪽 페이지에 찍힌다.
 *    정본 = prompts.json scenes[0].geometry.writerSide (node tools/measure-book.mjs --writer …)
 */
export const bookWriterSide = (): "left" | "right" => {
  const g = scenes.find((s) => s.scene === 1)?.geometry;
  return g?.writerSide === "left" ? "left" : "right";
};

/**
 * 페이지 네 점을 **화면 라벨 그대로**(tl = 화면 좌상) 돌려준다 — 페이지 로컬 배정(rot180)을 하지 않는다.
 * 지면을 「보이는 그대로」 잘라 쓰는 곳(v3.3 레인 T2 Paper→Designer 3D 종이 텍스처)용.
 */
export const bookPageScreen = (side: "left" | "right"): Corners | null => {
  const g = scenes.find((s) => s.scene === 1)?.geometry;
  const q = g?.pages?.[side];
  return q ? toCorners(q) : null;
};

/** 화면 라벨 → 페이지 로컬 라벨 배정(위 배정표) — "rot180" | "rot0" */
export const bookPageLocalFromScreen = (): string => {
  const g = scenes.find((s) => s.scene === 1)?.geometry;
  return g?.pageLocalFromScreen === "rot180" ? "rot180" : "rot0";
};

/** 펼친 지면 전체(양쪽 페이지). 카메라 프레이밍 계산용 */
export const bookSpread = (): Corners | null => {
  const g = scenes.find((s) => s.scene === 1)?.geometry;
  return g?.paperQuad ? toCorners(g.paperQuad) : null;
};

/** 네 꼭짓점의 무게중심 */
export const quadCenter = (c: Corners): [number, number] => [
  (c.tl[0] + c.tr[0] + c.br[0] + c.bl[0]) / 4,
  (c.tl[1] + c.tr[1] + c.br[1] + c.bl[1]) / 4,
];

/**
 * Paper 앞컷의 **푸시인 카메라** — 배율·원점을 측정값에서 역산한다.
 *
 * 🔴 배율을 눈대중으로 정하지 않는다. 이 컷에서 읽혀야 하는 것은 **손글씨**이고,
 *    손글씨 크기는 괘선 pitch 에 묶여 있으므로(PaperInk 주석) 화면 글자 높이는
 *    `배율 × screenPitchPx × glyphScreenOfPitch` 로 결정된다. 그래서 거꾸로
 *    **목표 글자 높이(camera.inkTargetPx)에서 필요한 배율을 푼다**.
 *      zoomTo = inkTargetPx / (screenPitchPx × glyphScreenOfPitch)
 *    · screenPitchPx = **글씨를 읽어야 하는 쪽**(= 앞사람들이 채워 둔 페이지)의 측정 pitch
 *    · glyphScreenOfPitch = 실측 보정계수(prompts.json camera.$calibration)
 *
 * 🔴 상한 zoomMax 는 **원본 해상도**가 정한다. gen-01.png 은 1920×1080 이라 배율을
 *    무한정 올리면 사진이 뭉개진다(손글씨 layer 는 벡터라 그대로 선명하다).
 *
 * 원점은 **끝 배율에서** 채워진 쪽 지면 중심이 camera.endTarget 에 오도록 역산한다.
 * 원점이 고정이므로 시작 배율에서의 위치는 그 직선 위에서 자동으로 정해진다 —
 * 시작 구도(사람·대기 줄이 보이는 그림)는 zoomFrom 이 지킨다.
 */
export interface BookCamera {
  zoomFrom: number;
  zoomTo: number;
  origin: [number, number];
  /** 끝 배율에서 기대되는 화면 글자 높이(px) — 검증용. tools/measure-ink-height.py 와 대조한다 */
  inkPxAtEnd: number;
  /** zoomMax 에 걸려 목표 높이를 못 채웠는지 */
  capped: boolean;
}
export const bookCamera = (): BookCamera => {
  const g = scenes.find((s) => s.scene === 1)?.geometry;
  const c = g?.camera ?? {};
  const zoomFrom = c.zoomFrom ?? 1.42;
  const zoomMax = c.zoomMax ?? 3.8;
  const targetPx = c.inkTargetPx ?? 22;
  const ratio = c.glyphScreenOfPitch ?? 0.63;
  /** 읽어야 하는 쪽 = 펜이 놓이지 **않은** 쪽(앞사람들이 이미 채워 둔 면) */
  const readSide = bookWriterSide() === "left" ? "right" : "left";
  const pitchPx = bookRuling(readSide).screenPitchPx ?? 9.5;
  const want = targetPx / Math.max(pitchPx * ratio, 1e-6);
  const zoomTo = Math.min(Math.max(want, zoomFrom), zoomMax);
  /** 라벨 순서는 무게중심에 영향이 없으므로 페이지 로컬 순서 그대로 써도 된다 */
  const page = readSide === "left" ? bookPageLeft() : bookPageRight();
  const target: [number, number] = [c.endTarget?.[0] ?? 980, c.endTarget?.[1] ?? 470];
  const origin = page ? originFor(quadCenter(page), target, zoomTo) : ([960, 1080] as [number, number]);
  return {
    zoomFrom,
    zoomTo,
    origin,
    inkPxAtEnd: zoomTo * pitchPx * ratio,
    capped: want > zoomMax + 1e-9,
  };
};

/**
 * 배율 s 로 확대하면서 **화면의 특정 지점 target 에 point 가 오도록** 하는
 * transform-origin 을 구한다. (origin + s·(point−origin) = target)
 *
 * 왜 필요한가: 방명록이 프레임 구석에 있으면 가운데 기준 줌은 그것을 화면 밖으로 밀어낸다.
 * 피사체를 붙잡고 미는 카메라를 만들려면 원점을 피사체 반대편으로 옮겨야 한다.
 *
 * 🔴 원점은 **프레임 안**이어야 한다. s>1 일 때 화면을 다 덮을 조건이
 *    0 ≤ originX ≤ 폭, 0 ≤ originY ≤ 높이 로 딱 떨어진다 — 프레임 밖 원점을 쓰면
 *    확대했는데도 가장자리에 빈 띠가 생긴다(2026-09-18 Preview9 렌더에서 실제로 났다).
 *    그래서 target 은 **희망 위치**일 뿐이고, 못 맞추면 가장자리로 잘라 맞춘다.
 *    더 당겨오고 싶으면 target 이 아니라 **배율**을 올려야 한다.
 */
export const originFor = (
  point: [number, number],
  target: [number, number],
  scale: number,
  frame: [number, number] = [1920, 1080],
): [number, number] => {
  const k = 1 - scale;
  if (Math.abs(k) < 1e-6) return point;
  const raw: [number, number] = [(target[0] - scale * point[0]) / k, (target[1] - scale * point[1]) / k];
  return [
    Math.min(Math.max(raw[0], 0), frame[0]),
    Math.min(Math.max(raw[1], 0), frame[1]),
  ];
};
