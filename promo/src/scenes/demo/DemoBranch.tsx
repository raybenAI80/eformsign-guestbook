import React from "react";
import { Branch } from "../Branch";
import { DemoNarration, Sfx } from "../../audio-demo";
import { demoScene } from "../../script";

/** 방명록은 시작일 뿐 — 홍보편 Branch 그대로, 자막·나레이션만 demo 세트. 전환음 whoosh-in */
const S = demoScene("branch");

export const DemoBranch: React.FC<{ mute?: boolean }> = ({ mute }) => (
  <>
    <Sfx name="whoosh-in" at={0} mute={mute} volume={0.6} />
    <Branch mute={mute} captions={S.captions} narration={<DemoNarration id="branch" mute={mute} />} />
  </>
);
