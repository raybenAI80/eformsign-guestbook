import React from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { Stage } from "../components/Stage";
import { Photo } from "../components/Photo";
import { BookCamera, CameraScrim } from "../components/BookCamera";
import { Caption } from "../components/Caption";
import { Narration } from "../components/Narration";
import { scene } from "../script";

/**
 * 0–4초 훅 — 「방명록, 아직도 수기로 작성하고 직접 관리하시나요?」
 *
 * 🔴 v3(2026-09-21 사용자 확정) 재구성. v2 는 이폼사인 문서함 실캡처에 완료 문서가
 *    톡톡 쌓이는 화면이었고 자막이 「사람이 없어도, 문서는 쌓입니다」였다. 사용자 지적 —
 *    도입이 **결과 선언**이라 시청자 자신의 문제(방명록을 손으로 쓰고 직접 관리한다)가
 *    보이지 않는다. 그래서 훅에서 다음을 **뺐다**:
 *      · 문서함 실캡처(src/shots.ts 의 INBOX_SHOT)와 도착 행 모션(Inbox/ShotRow)
 *      · 행 도착 알림음 ui-tick.wav
 *    문서함의 첫 등장은 Fill(17~27초) 오른쪽 도착 분할 화면으로 미뤄진다 — 그쪽이
 *    「전송하면 이폼사인 문서함에 바로」라는 뜻을 처음 말하는 자리다.
 *
 * 화면 = 생성 이미지 ① 종이 방명록(gen-01.png) 한 장. 정지에서 출발해 장면 내내
 * 민다.
 *
 * 🔴 2026-09-21 레인 J — **다음 장면과 하나의 카메라 움직임으로 잇는다.**
 *    이전에는 훅이 1.00 → 1.06 으로 끝나는데 Paper 가 **같은 사진**을 1.42 에서
 *    시작해 경계에서 배율이 튀었다(점프컷). 이제 훅은 1.00 에서 Paper 의 시작 배율
 *    까지 밀고, 초점(transform-origin)도 Paper 와 **같은 값**을 쓴다. 배율 1.00 에서는
 *    원점이 무엇이든 화면이 움직이지 않으므로 시작 구도는 원본 그대로다.
 *    값·곡선의 정본 = `src/camera.ts`, 얹는 곳 = `src/components/BookCamera.tsx`.
 *    이징은 ease-in(u²) — 정지에서 출발해 가속하고, 그 끝 속도를 Paper 가 이어받는다.
 *
 * 🔴 자막은 카메라 래퍼 **밖**에 있다. 안에 넣으면 줌을 따라 커지며 흔들린다.
 *
 * 🔴 손글씨 층(PaperInk)은 훅에 얹지 않는다. 앞사람 이름·연락처가 읽히는 클로즈업은
 *    다음 장면 Paper(4~10초)의 푸시인이 하는 일이고, 훅에서 미리 보여 주면 그 컷의
 *    뜻이 약해진다. 훅은 「이게 지금 당신이 하는 방식」만 보여 준다.
 */
const S = scene("hook");

/**
 * 훅의 소리 — 사무실/행사장 룸톤 한 겹(피크 -26 dBFS).
 *
 * v2 에서는 훅에 나레이션이 없어 룸톤 + 알림음이 소리의 전부였다. v3 은 훅에도
 * 나레이션이 있으므로 룸톤은 **그 아래 깔리는 공기**다. 길이·페이드는
 * `node tools/make-sfx.mjs` 가 굽는다(ROOM_D 4.0초 · 3.7초부터 페이드아웃) —
 * 장면 길이를 바꾸면 그 두 상수를 같이 고쳐야 한다.
 */
const HookAir: React.FC = () => (
  <Audio src={staticFile("sfx/room-tone.wav")} volume={0.7} />
);

export const Hook: React.FC<{ mute?: boolean }> = ({ mute }) => (
  <Stage variant="photo" logo="none">
    <Narration id="hook" mute={mute} />
    {mute ? null : <HookAir />}

    {/* 종이 방명록 — 정지에서 출발해 Paper 시작 배율까지. 초점은 Paper 와 공유 */}
    <BookCamera phase="hook">
      <Photo src="gen-01.png" pan="in" from={1} to={1} scrim={0} />
    </BookCamera>
    <CameraScrim strength={0.5} />

    {/* 자막 — 무음 시청 대비. 훅 타이틀 스타일(84px) 유지 */}
    <AbsoluteFill
      style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 120 }}
    >
      <Caption lines={S.captions} from={10} size={84} tone="dark" />
    </AbsoluteFill>
  </Stage>
);
