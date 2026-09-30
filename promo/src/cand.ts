import { createContext, useContext } from "react";

/**
 * 레인 B(2026-09-30) — 3D 확장 **판정용 후보**의 스위치. 본편(Main60)은 Provider 가 없어 언제나 "" = 현행.
 * 🔴 v3.5(2026-09-30 사용자 확정): 손 1B·종이 전환 c4 가 **본편 기본값**이 됐다 — "" = hB 값(HAND3D) + 깊이 종이.
 *   hB·c4 는 이제 "" 와 같다. v3.4.1 대조 still 은 v34(손 HAND3D_V34 + 종전 종이)로 뽑는다.
 * 후보는 컴포지션 `CandB`(props.cand) 에서만 켜진다. 🔴 ThreeCanvas 안(R3F 별도 렌더러)으로는 컨텍스트가
 * 넘어가지 않는다 — 캔버스 **밖**에서 읽어 prop 으로 넘긴다.
 *   hA/hB/hC = 손 존재감 변형 · c2 = 태블릿 층·먼 층 패럴랙스 · c3 = 문서함 행 3D 카드 · c4 = 종이 전환 깊이 강화
 *   hF = 레인 HF 진단용 평면(격자 휨·들림·구름 0 — 렌더 단계 실루엣 기여 대조)
 *   v34 = v3.4.1 본편 재현(판정 좌우 대조용)
 *   c5 = CTA 로고 3D 강화 · c6 = 문서함 캡처 판 3D 기울기(워커 제안)
 */
export type CandId = "" | "hA" | "hB" | "hC" | "hF" | "c2" | "c3" | "c4" | "c5" | "c6" | "v34";
export const CandContext = createContext<CandId>("");
export const useCand = (): CandId => useContext(CandContext);
export const isHandCand = (c: CandId): c is "hA" | "hB" | "hC" | "hF" => c === "hA" || c === "hB" || c === "hC" || c === "hF";

/** 후보 C·2 의 카메라 궤도 — 프레임 결정적. 장면 로컬 프레임 → 도(°) / px */
export const orbitDeg = (f: number) => 6 * Math.sin((2 * Math.PI * f) / 240);
export const farShift = (f: number) => 26 * Math.sin((2 * Math.PI * f) / 240);
