import { staticFile } from "remotion";
import geometry from "./scene-geometry.json";
import shotScale from "./shot-scale.json";
import occluderData from "./occluders.json";
import promptsJson from "../public/gen/prompts.json";
import type { Corners } from "./components/ScreenComposite";

/**
 * Designer·Fill·Repeat·Manage·Branch 장면의 **소재 배치표**.
 *
 * 🔴 `src/shots.ts`(Hook 의 문서함 배치표)는 다른 레인이 쓰고 있다. 이 파일은 그것을
 *    건드리지 않고 나머지 장면 몫만 담는다. 두 파일 다 원칙은 같다:
 *      · 캡처 파일은 저장소에 커밋하지 않는다(회사 ID·서식 ID 노출 금지)
 *      · 좌표는 코드에 박지 않는다 — `tools/measure-scenes.mjs` 가 재서 `scene-geometry.json` 에 쓴다
 *      · 캡처가 없으면 그 연출을 **빼고** 간다(빈 자리를 목업으로 그리지 않는다)
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface CaptureGeo {
  width: number;
  height: number;
  page?: Rect | null;
  fields?: Rect[];
  fieldsArea?: Rect | null;
  urlToggle?: Rect | null;
  panelX?: number | null;
  dialog?: Rect | null;
  deployButton?: Rect | null;
  search?: Rect | null;
  separators?: number[];
  /**
   * **화면에 보일 영역** — 캡처에서 내용이 실제로 있는 사각형(`tools/measure-scenes.mjs` 측정).
   * 이것이 없으면 캡처 전체가 기기 화면에 들어가 서식이 작아지고 아래가 백지가 된다.
   */
  viewport?: Rect | null;
  /** 캡처 한 장의 평균 밝기(0–255). 200 미만이면 제품이 스스로 어둡게 한 상태다 */
  luma?: number;
}

const CAPTURES = geometry.captures as unknown as Record<string, CaptureGeo>;
/** 선택 소재 한 묶음. 프레임 목록과 **그 프레임의 크기**를 함께 담는다 */
export interface ShotSeq {
  frames: string[];
  width: number;
  height: number;
  /** 프레임별 평균 밝기(0–255) — `tools/measure-scenes.mjs` 가 잰다 */
  luma?: number[];
  /** 화면에 보일 영역(밝은 프레임 여러 장의 합집합) */
  viewport?: Rect | null;
  /** 값이 든 행이 끝나는 높이(리포트). 그 아래는 항목 칸이 빈 옛 문서다 */
  contentBottom?: number;
  /** 채워진 서식 카드용 프레임과 그 지면 사각형(fill-seq) */
  card?: FillCard | null;
}

/** 채워진 서식 한 장 — Branch 장면 왼쪽 카드가 쓴다 */
export interface FillCard {
  frame: string;
  width: number;
  height: number;
  page: Rect;
  luma: number;
}

/** 생성 이미지 배경의 색보정 세기(측정값에서 계산) */
export interface Grade {
  image: string;
  luma: number;
  target: number;
  brightness: number;
  saturate: number;
}
const OPTIONAL = geometry.optional as {
  thanksSeq: ShotSeq;
  fillSeq: ShotSeq;
  countdown: ShotSeq;
};
const EMPTY_SEQ: ShotSeq = { frames: [], width: 0, height: 0 };

const GRADES = ((geometry as unknown as { grade?: Record<string, Grade | null> }).grade ?? {}) as Record<
  string,
  Grade | null
>;

/**
 * 생성 이미지 배경의 색보정 세기. 없으면 null — 장면은 보정 없이 간다.
 *
 * 🔴 세기를 코드에 박지 않는다. `tools/measure-scenes.mjs` 가 그 이미지의 평균 밝기를 재서
 *    목표까지 필요한 배율을 계산해 둔다(이미지를 새로 생성하면 재측정으로 따라온다).
 */
export const grade = (image: string): Grade | null => GRADES[image] ?? null;

/** 캡처 한 장의 배치 정보. 없으면 null — 장면은 그 컷을 빼고 간다 */
export const geo = (key: string): CaptureGeo | null => CAPTURES[key] ?? null;

/** public/shots 기준 상대경로 → Remotion 주소 */
export const shotUrl = (rel: string) => staticFile(`shots/${rel}`);

const SCALE = (shotScale as { files?: Record<string, { k: number }> }).files ?? {};

/**
 * 캡처 한 장을 **화면에 얹을 형태**로 — 미리 축소한 사본이 있으면 그것과 배율을 함께 준다.
 *
 * 🔴 왜(2026-09-21 v3): 1920px 캡처를 matrix3d 로 한 번에 345px 로 줄이면 브라우저가
 *    밉맵 없이 이중선형 표본화만 해 글자·괘선이 계단·모아레로 깨진다(「쭈굴쭈굴」).
 *    `tools/prescale-shots.mjs` 가 lanczos 로 미리 줄인 사본을 `public/shots/_scaled/` 에 둔다.
 * 🔴 좌표(crop·커서·강조)는 **언제나 원본 캡처 화소** 그대로다 — 배율은 그리는 층에서만 쓴다.
 *    사본이 없으면 배율 1 로 원본을 쓴다(캡처를 새로 찍고 prescale 을 아직 안 돌린 상태).
 */
export const shotLayer = (rel: string): { src: string; srcScale: number } =>
  SCALE[rel]
    ? { src: staticFile(`shots/_scaled/${rel}`), srcScale: SCALE[rel].k }
    : { src: staticFile(`shots/${rel}`), srcScale: 1 };

/** 캡처 파일 경로표. 측정값이 있는 키만 실제로 존재한다고 본다 */
export const SHOT_FILES = {
  A01: "A/A01-designer-form.png",
  A02: "A/A02-url-create-on.png",
  A04: "A/A04-template-saved.png",
  B02: "B/B02-empty-form.png",
  B03: "B/B03-filled-form.png",
  B04: "B/B04-send-dialog.png",
  B05: "B/B05-complete.png",
  C01: "C/C01-kiosk-blank.png",
  /** 「입력 시작」 직후의 **밝은** 빈 서식. C01 은 동의 전이라 제품이 지면을 어둡게 한다 */
  C01b: "C/C01b-kiosk-blank-active.png",
  C02: "C/C02-kiosk-filled.png",
  C04: "C/C04-thanks.png",
  D01: "D/D01-document-list.png",
  D02: "D/D02-search.png",
  D03: "D/D03-pdf-preview.png",
  /** OZR 참석자 명단 보고서(이폼사인 문서) 미리보기 — 각주 「보고서 서식은 맞춤 제작」 */
  D04: "D/D04-ozr-report-preview.png",
  /** 커넥트 → 구글 시트에 자동으로 쌓인 행 */
  K02: "K/K02-sheet-rows.png",
} as const;
export type ShotKey = keyof typeof SHOT_FILES;

/** 측정값이 있는 캡처만 쓴다(= 파일이 실제로 있었다는 증거) */
export const hasShot = (key: ShotKey) => geo(key) !== null;

/* ---------- 선택 소재(존재 분기) ---------- */

/**
 * 🔴 기획서가 「시퀀스가 생기면 그것을 우선 사용」이라고 적은 소재들.
 * 존재 판단을 렌더 시점에 할 수 없으므로(브라우저는 파일 목록을 못 읽는다)
 * `tools/measure-scenes.mjs` 가 파일 목록을 데이터로 옮겨 둔다.
 */
export const thanksSeq = (): ShotSeq => OPTIONAL.thanksSeq ?? EMPTY_SEQ;
/**
 * 외부 작성이 「채워지는 과정」 연속 캡처. 없으면 정지 캡처 크로스페이드로 간다.
 * 🔴 프레임 크기가 같은 폴더의 정지 캡처와 다르다(2700 vs 2550) — 크기도 같이 받는다.
 */
export const fillSeq = (): ShotSeq => OPTIONAL.fillSeq ?? EMPTY_SEQ;
/** 자리 이탈 카운트다운 덮개. 없으면 그 컷을 넣지 않는다 */
export const countdownSeq = (): ShotSeq => OPTIONAL.countdown ?? EMPTY_SEQ;
/*
 * 🔴 리포트(report.html, E 계열) 소재는 **영상에서 뺐다**(2026-09-21 사용자 지시) —
 *    방명록 상품에 따로 구현한 화면이라 이폼사인 홍보 영상에 넣지 않는다.
 *    캡처 파일 자체는 public/shots/E/ 에 남아 있으나 측정·장면 어디서도 쓰지 않는다.
 */

/**
 * 시퀀스에서 **밝은 프레임만** 골라낸다.
 *
 * 🔴 왜 있나(2026-09-21): 이폼사인 작성 화면은 ① 동의 전(=「입력 시작」 누르기 전)
 * ② 모달(전송 팝업) 뒤에서 **제품이 스스로 지면을 어둡게** 한다. 이 상태의 프레임을
 * 태블릿 화면에 얹으면 Fill(밝음)과 Repeat/Branch(어두움)가 한 영상 안에서 따로 놀아
 * 「합성이 잘못됐다」로 읽힌다. 실측 평균 밝기: 밝은 화면 246~254 · 어두운 화면 132~138.
 * 어느 프레임이 밝은지는 눈대중이 아니라 측정값(`luma`)으로 가른다.
 */
export const brightFrames = (seq: ShotSeq, min = 200): string[] => {
  if (!seq.luma || seq.luma.length !== seq.frames.length) return seq.frames;
  const picked = seq.frames.filter((_, i) => (seq.luma as number[])[i] >= min);
  return picked.length ? picked : seq.frames;
};

/**
 * 시퀀스 **앞머리의 어두운 프레임을 버린다**(밝은 프레임에서 시작하게).
 *
 * 🔴 왜(2026-09-21): `C/thanks-seq` 는 「전송 팝업(모달 뒤 어두움) → 감사 화면(밝음) →
 * 새 서식(동의 전이라 어두움)」 순이다. 전송 팝업은 **앞 장면 Fill 이 이미 보여 준 화면**이라
 * Repeat 이 그것으로 시작할 이유가 없는데, 그 때문에 장면 도입부가 통째로 회색이었다.
 */
export const dropLeadingDark = (seq: ShotSeq, min = 200): string[] => {
  if (!seq.luma || seq.luma.length !== seq.frames.length) return seq.frames;
  const first = seq.luma.findIndex((l) => l >= min);
  return first > 0 ? seq.frames.slice(first) : seq.frames;
};

/* ---------- 가림(occlusion) ---------- */

const OCCLUDERS = (occluderData as { images?: Record<string, { mask?: string | null }> })
  .images ?? {};

/**
 * 생성 이미지에서 **화면을 가리는 물체**(손끝·펜)를 오려 낸 층. 없으면 null.
 *
 * 🔴 왜(2026-09-21 v3): 합성은 「사진 위에 캡처」 순서라, 사진에서 화면 앞에 있던 손끝이
 *    캡처 층에 덮여 화면 뒤로 들어간다(사용자 지적 「손가락보다 화면이 위에 있고」).
 *    `tools/make-occlusion-mask.mjs` 가 만든 컷아웃을 캡처 층 **위**에 한 겹 더 얹어 되돌린다.
 *    어느 이미지에 가릴 것이 있는지는 측정값이다 — 태블릿 셋은 손끝 300여 화소,
 *    노트북(gen-06)은 없다(머리·손이 화면 사각형과 겹치지 않는다).
 */
export const occluderUrl = (gen: string): string | null => {
  const m = OCCLUDERS[gen]?.mask;
  return m ? staticFile(`gen/${m}`) : null;
};

/* ---------- 기기 화면 4점(생성 이미지) ---------- */

interface QuadBlock {
  scene: number;
  screenQuad?: { points: number[][]; order?: string };
}
const genScenes = (promptsJson as { scenes: QuadBlock[] }).scenes;

/**
 * 생성 이미지의 기기 화면 4점. 정본은 `public/gen/prompts.json` 이다
 * (생성 이미지는 같은 파일명으로 재생성되므로 좌표를 코드에 두면 조용히 틀려진다).
 */
export const screenQuad = (sceneNo: number): Corners | null => {
  const q = genScenes.find((s) => s.scene === sceneNo)?.screenQuad;
  if (!q || q.points.length !== 4) return null;
  const [tl, tr, br, bl] = q.points;
  return { tl: [tl[0], tl[1]], tr: [tr[0], tr[1]], br: [br[0], br[1]], bl: [bl[0], bl[1]] };
};

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 네 점이 만드는 사각형의 가로/세로 비 — 캡처를 이 비율로 잘라야 늘어나지 않는다 */
export const quadAspect = (c: Corners): number => {
  const w = (dist(c.tl, c.tr) + dist(c.bl, c.br)) / 2;
  const h = (dist(c.tl, c.bl) + dist(c.tr, c.br)) / 2;
  return w / h;
};

/** 네 점의 무게중심(컴포지션 좌표) */
export const quadCentroid = (c: Corners): [number, number] => [
  (c.tl[0] + c.tr[0] + c.br[0] + c.bl[0]) / 4,
  (c.tl[1] + c.tr[1] + c.br[1] + c.bl[1]) / 4,
];

/* ---------- 자르기 ---------- */

/**
 * 캡처를 목표 비율에 맞춰 **최대 넓이로** 자른다.
 *
 * 🔴 기기 화면(태블릿 0.57 : 캡처 0.75 · 노트북 1.53 : 캡처 1.78)은 비율이 다르다.
 *    그대로 얹으면 글자가 눌린다. 숫자를 손으로 적는 대신 비율에서 계산한다.
 *    `align` 은 「어느 쪽을 살릴 것인가」라는 연출 판단이다 —
 *    문서함은 왼쪽(상태·제목·단계 열)을 살리고 오른쪽 이력 패널을 버린다.
 */
export const cropToAspect = (
  cap: { width: number; height: number },
  aspect: number,
  align: "center" | "left" | "top" = "center",
): Rect => {
  const capAspect = cap.width / cap.height;
  if (capAspect > aspect) {
    const w = Math.round(cap.height * aspect);
    const x = align === "left" ? 0 : Math.round((cap.width - w) / 2);
    return { x, y: 0, w, h: cap.height };
  }
  const h = Math.round(cap.width / aspect);
  const y = align === "top" ? 0 : Math.round((cap.height - h) / 2);
  return { x: 0, y, w: cap.width, h };
};

/**
 * 목표 비율 `aspect` 를 **정확히** 지키면서 `area` 를 최대한 담는 사각형.
 *
 * 🔴 `rectToAspect` 와 다르다: 그쪽은 캡처 경계에 부딪히면 비율을 포기한다(w·h 를 각각
 *    클램프한다) — 그 사각형을 기기 화면에 얹으면 글자가 눌린다. 여기서는 경계에 부딪히면
 *    **비율을 지키고 크기를 줄인다**.
 *
 * 🔴 왜 필요한가(2026-09-21 v3): 태블릿 화면의 비(0.58)는 캡처(1920x2700 = 0.711)보다
 *    좁고 길다. 캡처 **전체**를 그 비로 자르면 세로가 하나도 안 잘려 서식 아래 백지 650px 와
 *    하단바가 그대로 들어온다(사용자 지적 「쭈굴쭈굴하고 눌린 화면」). 내용이 있는 곳만
 *    (=`viewport`) 담으면 같은 화면 사각형에 서식이 더 크게 들어간다.
 */
export const fitCrop = (
  area: Rect,
  aspect: number,
  cap: { width: number; height: number },
  align: "center" | "left" | "top" = "center",
): Rect => {
  let w = Math.max(area.w, area.h * aspect);
  let h = w / aspect;
  if (w > cap.width) {
    w = cap.width;
    h = w / aspect;
  }
  if (h > cap.height) {
    h = cap.height;
    w = h * aspect;
  }
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const clamp = (v: number, max: number) => Math.min(Math.max(0, v), Math.max(0, max));
  const x = align === "left" ? clamp(area.x, cap.width - w) : clamp(cx - w / 2, cap.width - w);
  const y = align === "top" ? clamp(area.y, cap.height - h) : clamp(cy - h / 2, cap.height - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
};

/**
 * 기기 화면에 얹을 **자르기 한 곳**. 장면은 이것만 부른다(배율·좌표가 흩어지지 않게).
 *
 * `viewport` 측정값이 있으면 그것을, 없으면 캡처 전체를 담는다. 측정값이 없어도
 * v2 와 같은 결과가 나오므로 재측정 전에도 안전하다.
 */
export const screenCrop = (
  cap: { width: number; height: number; viewport?: Rect | null },
  aspect: number,
  align: "center" | "left" | "top" = "center",
): Rect =>
  fitCrop(
    cap.viewport ?? { x: 0, y: 0, w: cap.width, h: cap.height },
    aspect,
    cap,
    align,
  );

/** 사각형을 사방으로 넓힌다(캡처 경계 안으로 잘라 맞춘다) */
export const padRect = (
  r: Rect,
  pad: number,
  cap: { width: number; height: number },
): Rect => {
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  return {
    x,
    y,
    w: Math.min(cap.width - x, r.w + pad * 2),
    h: Math.min(cap.height - y, r.h + pad * 2),
  };
};

/** 사각형을 목표 비율로 키운다(중심 유지, 캡처 안으로 클램프) — 카메라 프레이밍용 */
export const rectToAspect = (
  r: Rect,
  aspect: number,
  cap: { width: number; height: number },
): Rect => {
  let w = r.w;
  let h = r.h;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  w = Math.min(w, cap.width);
  h = Math.min(h, cap.height);
  const x = Math.min(Math.max(0, cx - w / 2), cap.width - w);
  const y = Math.min(Math.max(0, cy - h / 2), cap.height - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
};

export const rectCenter = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/**
 * 사각형의 **위쪽만** 목표 비율로 잘라낸다(아래를 버린다).
 *
 * 왜: ① 채워진 서식 카드는 지면 위쪽(제목·입력값)이 보이면 된다 ② 리포트 표는 값이 든 행까지만
 * 보여야 한다(아래 옛 문서 3행은 항목 칸이 비어 있다). 두 경우 다 「어디까지 살릴지」가
 * 측정값으로 오고, 비율에 맞추는 계산만 여기서 한다.
 */
export const cropTop = (
  area: Rect,
  aspect: number,
  cap: { width: number; height: number },
): Rect => {
  let w = area.w;
  let h = Math.round(w / aspect);
  if (h > area.h) {
    h = area.h;
    w = Math.round(h * aspect);
  }
  w = Math.min(w, cap.width);
  h = Math.min(h, cap.height);
  const x = Math.min(Math.max(0, area.x), cap.width - w);
  const y = Math.min(Math.max(0, area.y), cap.height - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
};

/* ---------- 문서함 캡처 다듬기 ---------- */

/**
 * 문서함 배치표(`src/shots.ts`)를 **행이 끝나는 곳에서 잘라** 돌려준다.
 *
 * 왜: 분할 화면의 좁은 칸에서는 목록 아래 빈 여백이 카드 높이의 절반을 먹는다.
 * 첫 문서가 아래 칸부터 도착하는 연출(Hook 레인이 정한 규칙)이라 그 여백이
 * 「왜 저기 한 줄만 떠 있지」로 보인다. 행 아래를 잘라내면 그 위화감이 사라진다.
 * 🔴 `src/shots.ts` 는 고치지 않는다(다른 레인 소유) — 복사본만 다듬는다.
 */
export const trimInbox = <T extends { crop: Rect; bands: { top: number; height: number }[] }>(
  shot: T | undefined,
  margin = 24,
): T | undefined => {
  if (!shot || shot.bands.length === 0) return shot;
  const last = shot.bands[shot.bands.length - 1];
  const bottom = Math.min(shot.crop.y + shot.crop.h, last.top + last.height + margin);
  return { ...shot, crop: { ...shot.crop, h: Math.max(1, bottom - shot.crop.y) } };
};
