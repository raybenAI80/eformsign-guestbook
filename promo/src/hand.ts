/**
 * 레인 V(2026-09-30) — Fill·Repeat 의 **손 한 개**가 실제로 서식을 채우듯 움직이는 궤적.
 *
 * 🔴 왜: v3.2 까지 Fill·Repeat 은 컷마다 다른 생성 이미지(gen-03·04·05)를 써서
 *    **손이 사진마다 바뀌었다**(사용자 지적 2026-09-30). 이제 바탕은 손 없는 한 장
 *    (`gen-03-plate.png`), 손은 한 장의 컷아웃(`hand-03.png`)이고, 그 손을 여기서 움직인다.
 *
 * 좌표 흐름(하드코딩 없음):
 *   캡처 화소(src/hand-path.json, tools/measure-hand-path.py 가 차분으로 파생)
 *     → screenCrop(캡처, 화면 비율) → 단위 정사각형 → 호모그래피 → 사진 좌표(1920x1080)
 *   손 컷아웃의 손끝·원점·팔꿈치 = public/gen/prompts.json scene3.handLayer.
 *
 * 결정적: 모든 값은 프레임 번호만의 함수다(난수·시간 없음).
 */
import promptsJson from "../public/gen/prompts.json";
import handPath from "./hand-path.json";
import type { Corners } from "./components/ScreenComposite";
import { screenCrop, type Rect } from "./shots-scenes";

export type Pt = [number, number];

export interface HandLayerSpec {
  plate: string;
  file: string;
  origin: Pt;
  size: Pt;
  tip: Pt;
  pivot: Pt;
}

export const handLayerSpec = (): HandLayerSpec | null => {
  const s = (promptsJson as unknown as { scenes: { scene: number; handLayer?: HandLayerSpec }[] }).scenes.find(
    (x) => x.scene === 3,
  );
  return s?.handLayer ?? null;
};

/** 손 없는 공용 바탕(Fill·Repeat 전 컷). 없으면 예전 gen-03 으로 물러선다 */
export const handPlate = (): string => handLayerSpec()?.plate ?? "gen-03.png";

/* ---------- 호모그래피(단위 정사각형 → 네 점) ---------- */

const squareToQuad = (c: Corners) => {
  const [x0, y0] = c.tl, [x1, y1] = c.tr, [x2, y2] = c.br, [x3, y3] = c.bl;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, cc = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return (u: number, v: number): Pt => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + cc) / w, (d * u + e * v + f) / w];
  };
};

type Cap = { width: number; height: number; viewport?: Rect | null };

/** 캡처 화소 → 사진 좌표. QuadShot 과 같은 crop 계산(screenCrop)을 쓴다 */
export const captureToPhoto = (pt: Pt, cap: Cap, quad: Corners, aspect: number): Pt => {
  const crop = screenCrop(cap, aspect);
  const map = squareToQuad(quad);
  return map((pt[0] - crop.x) / crop.w, (pt[1] - crop.y) / crop.h);
};

/**
 * 화면 **정중앙에 뜨는 덮개**(카운트다운)의 채울 영역 — 측정 viewport 크기는 그대로, 세로 중심만
 * 캡처 중심으로(claim `ink-viewport-y0-to-last-ink-pushes-centered-overlays-to-bottom`).
 * Repeat 의 합성과 손 좌표가 **같은 함수**를 써야 버튼 위에 손끝이 온다 — 그래서 여기 둔다.
 */
export const centeredOverlayArea = (vp: Rect | null | undefined, capHeight: number): Rect | null => {
  if (!vp) return null;
  const h = Math.min(vp.h, capHeight);
  const y = Math.round(Math.min(Math.max(0, capHeight / 2 - h / 2), capHeight - h));
  return { x: vp.x, y, w: vp.w, h };
};

/* ---------- 궤적 ---------- */

/** 손 동작 한 토막. t = 장면 프레임(탭은 t 에 떼기 시작 = 화면 변화가 보이는 프레임 직전) */
export type HandKey =
  | { kind: "tap"; t: number; at: Pt }
  | { kind: "sign"; t: number; at: Pt; half: number }
  | { kind: "hover"; t: number; at: Pt }
  | { kind: "away"; t: number; at: Pt };

export interface HandPose {
  tip: Pt;
  /** 0 = 화면에 닿음, 1 = 높이 떠 있음 */
  lift: number;
  visible: boolean;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: Pt, b: Pt, k: number): Pt => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 탭 한 번: 닿아 있는 프레임. 내려가기·올라오기는 이동과 겹친다(사람 손은 떼면서 이미 다음 칸으로 간다) */
export const TAP_HOLD = 2;
export const TAP_DOWN = 3;
export const TAP_UP = 3;
/** 서명 획 길이(닿아 있는 프레임) */
export const SIGN_LEN = 12;
/** 여유 있을 때의 이동 속도(사진 px/프레임 ≈ 30cm/s). 스틸 간 이동량 표(v33v-motion.json)로 검증한다 */
export const MOVE_PX_PER_FRAME = 16;
/** 머무를 때 떠 있는 높이 */
const REST = 0.5;

/** 각 키의 접촉 구간 [시작, 끝] 과 그 동안의 높이 */
const contact = (k: HandKey): [number, number] =>
  k.kind === "tap" ? [k.t - TAP_HOLD, k.t] : k.kind === "sign" ? [k.t - SIGN_LEN, k.t] : [k.t, k.t];
const liftOf = (k: HandKey) => (k.kind === "away" ? 1 : k.kind === "hover" ? REST : 0);
const startPt = (k: HandKey): Pt => (k.kind === "sign" ? [k.at[0] - k.half, k.at[1]] : k.at);
const endPt = (k: HandKey): Pt => (k.kind === "sign" ? [k.at[0] + k.half, k.at[1]] : k.at);
/** 사인 이징 — 최고 속도가 평균의 π/2 배(3차 이징은 3배라 짧은 이동에서 순간 속도가 튄다) */
const easeSine = (x: number) => (1 - Math.cos(Math.PI * clamp01(x))) / 2;

/**
 * 키 목록 → 프레임별 자세.
 *   간격이 넉넉하면: 떼기(TAP_UP) → 머무름(미세 흔들림) → 이동(도착 직전, 거리 비례) → 내려가기(TAP_DOWN)
 *   간격이 짧으면: 간격 전체를 한 번의 호(弧)로 — 떼면서 옮기고 내려가며 닿는다.
 */
export const poseAt = (keys: HandKey[], frame: number): HandPose => {
  if (!keys.length) return { tip: [0, 0], lift: 1, visible: false };
  let i = 0;
  for (let j = 0; j < keys.length; j++) if (contact(keys[j])[0] <= frame) i = j;
  const k = keys[i];
  const [c0, c1] = contact(k);
  const idle = (p: Pt): Pt => [p[0] + Math.sin(frame * 0.21) * 1.2, p[1] + Math.cos(frame * 0.17) * 0.9];

  if (frame <= c1 && frame >= c0) {
    if (k.kind === "sign") {
      // 서명 = 칸 안에서 좌→우 획 + 아주 약한 위아래 물결
      const u = clamp01((frame - c0) / Math.max(1, c1 - c0));
      return {
        tip: [k.at[0] - k.half + 2 * k.half * easeSine(u), k.at[1] + Math.sin(u * Math.PI * 3) * k.half * 0.14],
        lift: 0,
        visible: true,
      };
    }
    return { tip: k.kind === "tap" ? k.at : idle(k.at), lift: liftOf(k), visible: k.kind !== "away" };
  }
  const A = endPt(k);
  const L0 = liftOf(k);
  const next = keys[i + 1];
  if (!next) return { tip: idle(A), lift: L0 === 0 ? REST : L0, visible: k.kind !== "away" };
  const B = startPt(next);
  const L1 = liftOf(next);
  const [n0] = contact(next);
  const gap = n0 - c1;
  const need = Math.max(4, Math.ceil(dist(A, B) / MOVE_PX_PER_FRAME));
  const vis = !(k.kind === "away" && next.kind === "away");
  const up = L0 === 0 ? TAP_UP : 0;
  const down = L1 === 0 ? TAP_DOWN : 0;
  const mid = Math.max(L0, L1, REST);
  if (gap >= up + need + down) {
    const mv0 = n0 - down - need;
    if (frame < c1 + up) return { tip: A, lift: L0 + (mid - L0) * easeSine((frame - c1) / up), visible: vis };
    if (frame < mv0) return { tip: idle(A), lift: mid, visible: vis };
    if (frame < n0 - down) {
      const u = (frame - mv0) / need;
      return { tip: lerp(A, B, easeSine(u)), lift: mid + Math.sin(Math.PI * u) * 0.25, visible: vis };
    }
    return { tip: B, lift: mid + (L1 - mid) * easeSine((frame - (n0 - down)) / Math.max(1, down)), visible: vis };
  }
  const u = (frame - c1) / Math.max(1, gap);
  const peak = Math.min(mid, 0.2 + 0.4 * (gap / (up + need + down)));
  return {
    tip: lerp(A, B, easeSine(u)),
    lift: Math.min(1, L0 + (L1 - L0) * easeSine(u) + peak * Math.sin(Math.PI * u)),
    visible: vis,
  };
};

/** 손끝 → 컷아웃 변환(팔꿈치 기준 부분 회전 + 나머지 평행 이동) */
export const handTransform = (spec: HandLayerSpec, pose: HandPose, frame: number) => {
  const [px, py] = spec.pivot;
  const [ax, ay] = spec.tip;
  const [tx, ty] = pose.tip;
  const angA = Math.atan2(ay - py, ax - px);
  const angT = Math.atan2(ty - py, tx - px);
  // 방향 차의 40% 만 회전으로(팔 전체가 휘돌지 않게), ±7° 로 제한
  const rot = Math.max(-0.12, Math.min(0.12, (angT - angA) * 0.4));
  // 떠 있을수록 카메라 쪽 → 아주 조금 커진다
  const s = 1 + 0.035 * pose.lift;
  const vx = ax - px, vy = ay - py;
  const c = Math.cos(rot), sn = Math.sin(rot);
  const rx = px + s * (c * vx - sn * vy);
  const ry = py + s * (sn * vx + c * vy);
  const lift = pose.lift;
  return {
    dx: tx - rx,
    dy: ty - ry,
    rotDeg: (rot * 180) / Math.PI,
    scale: s,
    // 그림자: 창(왼쪽)에서 빛 → 오른쪽 아래로. 떠 있을수록 멀고 흐리고 옅다
    shadow: { x: 3 + 9 * lift, y: 4 + 12 * lift, blur: 3 + 9 * lift, a: 0.34 - 0.14 * lift },
  };
};

/* ---------- 장면별 키 ---------- */

interface FillEvent { at: number; until?: number; kind: string; point: number[]; why?: string }
const HP = handPath as unknown as {
  fill: { frames: number; events: FillEvent[] };
  sendConfirm: { point: number[] } | null;
  thanks: { button: { point: number[] } | null; transitionAt: string | null };
  countdown: { button: { point: number[] } | null };
};

export const thanksTransitionFrame = (): string | null => HP.thanks.transitionAt;

const below = (p: Pt): Pt => [p[0] + 90, p[1] + 560];

/**
 * 🔴 레인 V2(2026-09-30) — Fill 맺음 컷 타이밍 정본(Fill.tsx·check-hand-motion 이 같이 읽는다).
 *   v3.3 V 는 전송 확인 창(B04)이 196~256f 떠 있고 손이 175~243f(2.3초) 멈춰 있었다(사용자 판정 「머묾」).
 *   장면 길이(290f)·다른 장면 시작 프레임은 그대로 두고 **장면 안에서** 재배분한다:
 *     - 서명 창 「확인」(175f) 뒤 손이 곧장 전송 버튼 자리 쪽으로 옮겨 가 떠서 기다리고(hover),
 *     - 전송 확인 창은 1.0초(30f)만 보인 뒤 「전송」 탭 → 완료 화면(B05),
 *     - 줄어든 30f 는 완료 화면 여운으로(34f → 64f).
 *   손 정지(머묾) 최장 ≤ 30f 는 check-hand-motion 이 판정한다.
 */
export const FILL_TIMING = {
  /** fill-seq 가 차지하는 앞 구간(= 전송 확인 창이 뜨는 프레임) */
  seqSpan: 196,
  b04At: 196,
  /** 전송 확인 창이 보이는 길이 — 1.0초 */
  b04Len: 30,
  /** 손이 전송 버튼 근처에 도착해 떠 있기 시작하는 프레임(창이 뜬 직후) */
  hoverAt: 200,
  /** 완료 화면 뒤 손이 아래로 빠지는 시점(완료 화면 시작 기준) */
  awayAfter: 30,
  /** 문서함 첫 행(아래 행 = 앞 방문자 문서) 도착 프레임 */
  inboxFirstAt: 95,
  /**
   * 🔴 레인 R2(2026-09-30): 둘째 행(이번 방문자 문서) 도착 = **전송 탭 뒤** 이 프레임 수(8f ≈ 0.27초).
   * 예전 값(Inbox every=105 → 200f)은 전송 탭(225f)보다 먼저 행이 떠서 「보내기 전에 문서가 도착」했다.
   * 게이트 = tools/check-hand-motion.mjs 「문서함 도착 > 전송 탭」(허용 6~12f).
   */
  inboxAfterSend: 8,
} as const;
export const fillB05At = () => FILL_TIMING.b04At + FILL_TIMING.b04Len;
/** 전송 확인 창의 「전송」 탭 프레임(fillKeys 의 마지막 탭 t = b05At - 1 과 같은 식) */
export const fillSendTapAt = () => fillB05At() - 1;
/**
 * Fill 문서함 Inbox 의 from/every. 아래 두 행만 이 장면에서 도착한다(셋째 = from + 2*every 는 장면 밖,
 * 맨 윗행은 Repeat 이 도착시킨다 — Repeat.tsx Inbox from=-60 every=48 주석). 둘째 행 = 전송 탭 + inboxAfterSend.
 */
export const fillInboxTiming = (secondOverride?: number) => {
  const from = FILL_TIMING.inboxFirstAt;
  const second = secondOverride ?? fillSendTapAt() + FILL_TIMING.inboxAfterSend;
  return { from, every: second - from, second, third: from + 2 * (second - from) };
};

/** Fill: fill-seq 한 장 = per 프레임. 각 이벤트 = 그 캡처가 보이기 직전에 닿았다 뗀다 */
export const fillKeys = (o: {
  per: number;
  seqCap: Cap;
  b04Cap: Cap | null;
  b05At: number;
  total: number;
  quad: Corners;
  aspect: number;
  /** 전송 버튼 근처 대기 시작(없으면 v3.3 V 동작 = 확인 뒤 제자리 머묾) */
  hoverAt?: number;
  awayAfter?: number;
}): HandKey[] => {
  const m = (p: number[], cap: Cap) => captureToPhoto([p[0], p[1]], cap, o.quad, o.aspect);
  const keys: HandKey[] = [];
  const ev = HP.fill.events;
  if (ev.length) keys.push({ kind: "hover", t: 0, at: m(ev[0].point, o.seqCap) });
  let last = -99;
  for (const e of ev) {
    // 앞 탭과 너무 붙으면(8f 미만) 뒤로 민다 — 사람 손이 두 칸을 4f(0.13초)에 오갈 수 없다
    const t = Math.max(e.at * o.per - 1, last + 8);
    if (e.kind === "sign") {
      const a = m([e.point[0] - 80, e.point[1]], o.seqCap);
      const b = m([e.point[0] + 80, e.point[1]], o.seqCap);
      keys.push({ kind: "sign", t, at: lerp(a, b, 0.5), half: dist(a, b) / 2 });
    } else {
      keys.push({ kind: "tap", t, at: m(e.point, o.seqCap) });
    }
    last = t;
  }
  if (HP.sendConfirm && o.b04Cap) {
    const send = m(HP.sendConfirm.point, o.b04Cap);
    // 레인 V2: 창이 뜨는 사이 전송 버튼 오른쪽 아래에 떠서 기다린다(머묾 단축) — 버튼을 가리지 않게 비켜 선다
    if (o.hoverAt != null && o.hoverAt < o.b05At - 8) keys.push({ kind: "hover", t: o.hoverAt, at: [send[0] + 14, send[1] + 22] });
    // 전송 확인 창의 「전송」 — 완료 화면(B05)이 뜨기 직전에 뗀다
    keys.push({ kind: "tap", t: o.b05At - 1, at: send });
  }
  const lastAt = keys[keys.length - 1]?.at ?? ([700, 500] as Pt);
  keys.push({ kind: "away", t: Math.min(o.total - 1, o.b05At + (o.awayAfter ?? 30)), at: below(lastAt) });
  return keys;
};

/**
 * Repeat 앞 컷: 감사 화면 「지금 다음 작성 시작」을 누른다(전환 프레임 직전) → 아래로 퇴장.
 * 뒤 컷: 카운트다운 덮개에 손이 돌아와 「계속 작성하기」를 누른다 → 빈 서식 첫 칸 위에 머문다.
 */
export const repeatKeys = (o: {
  quad: Corners;
  aspect: number;
  thanksCap: Cap;
  thanksTapAt: number | null;
  cdCap: Cap;
  cdTapAt: number | null;
  blankCap: Cap;
}): HandKey[] => {
  const m = (p: number[], cap: Cap) => captureToPhoto([p[0], p[1]], cap, o.quad, o.aspect);
  const keys: HandKey[] = [];
  const tb = HP.thanks.button;
  if (tb && o.thanksTapAt != null) {
    const p = m(tb.point, o.thanksCap);
    keys.push({ kind: "away", t: 0, at: below(p) });
    keys.push({ kind: "tap", t: o.thanksTapAt, at: p });
    keys.push({ kind: "away", t: o.thanksTapAt + 30, at: below(p) });
  }
  const cb = HP.countdown.button;
  if (cb && o.cdTapAt != null) {
    const p = m(cb.point, o.cdCap);
    keys.push({ kind: "away", t: o.cdTapAt - 40, at: below(p) });
    keys.push({ kind: "tap", t: o.cdTapAt, at: p });
    const first = HP.fill.events[0];
    if (first) keys.push({ kind: "hover", t: o.cdTapAt + 22, at: m(first.point, o.blankCap) });
  }
  return keys;
};
