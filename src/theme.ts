import { staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";
import { Easing } from "remotion";

/* 브랜드 폰트 — 이폼사인 디자인 퀵가이드: Headline = Paperlogy, Body = Pretendard */
loadFont({
  family: "Paperlogy",
  url: staticFile("fonts/Paperlogy-8ExtraBold.ttf"),
  weight: "800",
});
loadFont({
  family: "Paperlogy",
  url: staticFile("fonts/Paperlogy-6SemiBold.ttf"),
  weight: "600",
});
loadFont({
  family: "Pretendard",
  url: staticFile("fonts/Pretendard-Regular.ttf"),
  weight: "400",
});

/**
 * 손글씨(방명록 지면 위 글씨) 전용 글꼴 — 나눔손글씨 펜(OFL, NHN Corporation).
 *
 * 🔴 브랜드 글꼴이 아니다. **종이 위에 사람이 쓴 글씨**에만 쓴다(자막·UI 에는 금지).
 * 🔴 `loadFont` 는 내부에서 delayRender/continueRender 를 걸어 폰트가 붙을 때까지 렌더를
 *    붙잡는다 — 그래서 첫 프레임이 대체 글꼴(고딕)로 찍히지 않는다. 직접 `@font-face` 를
 *    쓰면 그 보장이 사라진다.
 * 라이선스 원문 = public/fonts/NanumPenScript-OFL.txt (SIL Open Font License 1.1)
 */
loadFont({
  family: "NanumPenScript",
  url: staticFile("fonts/NanumPenScript-Regular.ttf"),
  weight: "400",
});

export const FONT_HEAD = "Paperlogy";
export const FONT_BODY = "Pretendard";
export const FONT_HAND = "NanumPenScript";

/**
 * 브랜드 게이트: 메인 #0E73C3 이 유일한 메인 컬러다.
 * 서브 컬러는 전체 화면의 20% 미만으로만 쓴다.
 * 로고·슬로건은 제공 PNG 만 쓴다 — 텍스트로 조판하지 않는다.
 */
export const C = {
  blue: "#0E73C3",
  blueDeep: "#0A5A99",
  sky: "#53BEF4",
  lightBlue: "#F2F9FF",
  lightGray: "#F4F4F4",
  ink: "#111826",
  dim: "rgba(17,24,38,0.62)",
  paper: "#FFFFFF",
  border: "#DDE4EE",
  shadow: "rgba(16,42,84,0.18)",
} as const;

export const LOGO = {
  blue: "brand/eformsign-logo-blue.png",
  white: "brand/eformsign-logo-white.png",
  sloganBlue: "brand/slogan-h.png",
  sloganWhite: "brand/slogan-h-white.png",
} as const;

export const EASE = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_OUT = Easing.out(Easing.cubic);
