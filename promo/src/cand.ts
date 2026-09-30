import { createContext, useContext } from "react";

/**
 * 레인 B(2026-09-30) — 3D 확장 **판정용 후보**의 스위치. 본편(Main60)은 Provider 가 없어 언제나 "" = 현행.
 * 후보는 컴포지션 `CandB`(props.cand) 에서만 켜진다. 🔴 ThreeCanvas 안(R3F 별도 렌더러)으로는 컨텍스트가
 * 넘어가지 않는다 — 캔버스 **밖**에서 읽어 prop 으로 넘긴다.
 *   hA/hB/hC = 손 존재감 변형 · c2 = 태블릿 층·먼 층 패럴랙스 · c3 = 문서함 행 3D 카드 · c4 = 종이 전환 깊이 강화
 *   c5 = CTA 로고 3D 강화 · c6 = 문서함 캡처 판 3D 기울기(워커 제안)
 */
export type CandId = "" | "hA" | "hB" | "hC" | "c2" | "c3" | "c4" | "c5" | "c6";
export const CandContext = createContext<CandId>("");
export const useCand = (): CandId => useContext(CandContext);
export const isHandCand = (c: CandId): c is "hA" | "hB" | "hC" => c === "hA" || c === "hB" || c === "hC";

/** 후보 C·2 의 카메라 궤도 — 프레임 결정적. 장면 로컬 프레임 → 도(°) / px */
export const orbitDeg = (f: number) => 6 * Math.sin((2 * Math.PI * f) / 240);
export const farShift = (f: number) => 26 * Math.sin((2 * Math.PI * f) / 240);
