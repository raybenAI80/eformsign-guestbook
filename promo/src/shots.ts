import { staticFile } from "remotion";

/**
 * 이폼사인 실화면 캡처 배치표.
 *
 * 기획서 10절: 이폼사인 화면은 **목업으로 그리지 않는다**. 실캡처가 정본이고,
 * 캡처가 아직 없을 때만 임시 카드 렌더로 버틴다.
 *
 * 캡처가 `public/shots/…` 에 도착하면 아래 상수에 파일 경로(=public 기준 상대경로)를
 * 적는 것만으로 Hook·Fill·Repeat 세 장면에 붙는다. 장면 코드는 고치지 않는다.
 *
 * 🔴 캡처 파일은 이 저장소에 커밋하지 않는다(회사 ID·서식 ID·실데이터 노출 금지).
 *    파일이 없으면 각 컴포넌트가 임시 카드 렌더로 폴백한다.
 *    좌표만 여기 남긴다 — 좌표 자체에는 식별자가 없다.
 */

/** 캡처 화소 기준 사각형 */
export interface ShotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InboxShot {
  /** Remotion 이 읽는 주소 */
  src: string;
  /** 캡처 원본 크기 */
  capture: { width: number; height: number };
  /** 화면에 쓸 부분(캡처 화소) */
  crop: ShotRect;
  /** 도착 전 「빈 목록」을 만들려고 흰색으로 덮는 영역 — 목록 세 행이 통째로 들어간다 */
  mask: ShotRect;
  /**
   * 도착하는 행의 자리(캡처 화소). 위→아래 순서로 적는다.
   * 이 자리의 화소는 **캡처 원본에서 그대로 오려 쓴다** — 행을 다시 그리지 않는다.
   * 그래서 글꼴·굵기·링크 색·행 높이가 실제 이폼사인 화면과 1:1 로 같다.
   */
  bands: { top: number; height: number }[];
}

/**
 * 문서함(문서 관리 — 완료 문서 3건) 캡처.
 *
 * 좌표 근거: `node tools/measure-inbox.mjs` (화소 스캔).
 *   우측 「문서 상태·이력」 패널 구분선 x=1835 · 1행 선택 하이라이트 y 266–384 ·
 *   행 구분선 y=506, 626 · 목록 좌우 x 45–1834.
 *   2026-09-18 D01 재촬영(제목이 「방문자 기록 - 박민수/김영희/홍길동」 인 새 캡처)
 *   뒤 같은 스크립트로 재측정했고 값이 **한 화소도 바뀌지 않았다** — 표 레이아웃이 동일하다.
 * crop 은 「문서 처리 경과일수」 열 앞(x=1470)에서 끊는다 — 그래야 1080 프레임에서
 * 행 세 줄이 세로 40% 이상을 차지한다(1470 → 1920 = 1.306배).
 */
const INBOX_SHOT: InboxShot | null = {
  src: "shots/D/D01-document-list.png",
  capture: { width: 2400, height: 1350 },
  crop: { x: 0, y: 0, w: 1470, h: 827 },
  mask: { x: 40, y: 264, w: 1795, h: 364 },
  bands: [
    { top: 264, height: 122 },
    { top: 386, height: 121 },
    { top: 507, height: 120 },
  ],
};

/** 캡처가 있으면 배치표, 없으면 undefined(= 임시 카드 렌더) */
export const inboxShot = (): InboxShot | undefined =>
  INBOX_SHOT ? { ...INBOX_SHOT, src: staticFile(INBOX_SHOT.src) } : undefined;
