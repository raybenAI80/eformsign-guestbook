import React from "react";
import { CTA } from "../CTA";
import { DemoNarration } from "../../audio-demo";
import { demoScene } from "../../script";

/**
 * CTA — 홍보편 CTA 그대로(로고 PNG + 3D 패널 + cta-reveal 은 CTA 안에 있다).
 * 자막 = demo 세트 [「지금 이폼사인을 체험해 보세요」, www.eformsign.com].
 * 🔴 보조 링크 한 줄(방명록 안내 페이지)은 footnote 자리 — **URL 미정**이라 공란(빈 문자열 = 그리지 않음).
 *    URL 이 정해지면 DEMO_GUIDE_URL 에 넣는다(script.ts 카피를 바꾸면 TTS 를 다시 만들어야 하므로 여기 둔다).
 */
const S = demoScene("cta");
export const DEMO_GUIDE_URL = "";

export const DemoCTA: React.FC<{ mute?: boolean }> = ({ mute }) => (
  <CTA
    mute={mute}
    lead={S.captions[0]}
    address={S.captions[1]}
    footnote={DEMO_GUIDE_URL}
    narration={<DemoNarration id="cta" mute={mute} />}
  />
);
