import React from "react";
import { AbsoluteFill, Img, Sequence, staticFile } from "remotion";
import { Hook } from "../scenes/Hook";
import { Fill } from "../scenes/Fill";
import { Stage } from "../components/Stage";
import { Caption } from "../components/Caption";
import { Narration } from "../components/Narration";
import { CUT15, sec } from "../script";
import { LOGO } from "../theme";
import type { PromoProps } from "./Main60";

/**
 * 15초 컷다운 — 가로(16:9)·세로(9:16) 공통 본체.
 *   0–3초  훅(문서함에 문서가 쌓인다)
 *   3–10초 방문자 작성·전송 → 문서함 도착(화면 분할)
 *   10–15초 「방명록은 시작일 뿐」 + 로고 + eformsign.com
 *
 * 세로 판형에서는 SplitScreen 의 vertical 을 켜야 한다 — 소재 도착 뒤 Fill 을
 * 판형 인자로 분기시킨다(지금은 같은 장면을 쓰고 안전 여백만 다르게 준다).
 */
export const Cut15: React.FC<PromoProps & { vertical?: boolean }> = ({
  mute = false,
  vertical = false,
}) => {
  const [c1, c2, c3] = CUT15;

  return (
    <AbsoluteFill style={{ background: "#FFFFFF" }}>
      <Sequence name="훅" from={sec(c1.startSec)} durationInFrames={sec(c1.endSec - c1.startSec)}>
        <Hook mute={mute} />
      </Sequence>

      <Sequence name="작성·도착" from={sec(c2.startSec)} durationInFrames={sec(c2.endSec - c2.startSec)}>
        <Fill mute={mute} />
      </Sequence>

      <Sequence name="CTA" from={sec(c3.startSec)} durationInFrames={sec(c3.endSec - c3.startSec)}>
        <Stage variant="blue" logo="none">
          <Narration id="cut15-cta" mute={mute} />
          <AbsoluteFill
            style={{
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: vertical ? 56 : 44,
              padding: vertical ? "0 90px" : "0 160px",
            }}
          >
            <Img src={staticFile(LOGO.white)} style={{ width: vertical ? 560 : 520 }} />
            <Caption lines={c3.captions} from={6} size={vertical ? 76 : 66} tone="dark" />
          </AbsoluteFill>
        </Stage>
      </Sequence>
    </AbsoluteFill>
  );
};

export const Cut15H: React.FC<PromoProps> = (p) => <Cut15 {...p} vertical={false} />;
export const Cut15V: React.FC<PromoProps> = (p) => <Cut15 {...p} vertical />;
