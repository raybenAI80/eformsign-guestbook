import React from "react";
import { CandContext, type CandId } from "../cand";
import { Main60 } from "./Main60";

/** 레인 B 판정용 — Main60 그대로에 후보 스위치만 켠다. `npx remotion still CandB --props='{"cand":"hA"}' --frame=734` */
export const CandB: React.FC<{ cand: CandId }> = ({ cand }) => (
  <CandContext.Provider value={cand}>
    <Main60 mute />
  </CandContext.Provider>
);
