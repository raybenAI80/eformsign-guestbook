/**
 * 자막·나레이션 원고 단일 원천.
 *
 * 이 파일이 세 곳의 입력이다.
 *   1) 장면 컴포넌트의 자막(Caption)
 *   2) tools/tts.mjs 의 edge-tts 음성 생성(→ public/voice/*.mp3 + voice.json)
 *   3) tools/check-script.mjs 쉬운 말 게이트
 *
 * 규칙(기획서 10절):
 *   - 자막 헤드라인에 「태블릿」 「설치」 「무인 키오스크」 금지
 *   - 가격 숫자·「무료」 금지 (리포트는 「유료 옵션」 각주까지만)
 *   - 개발자 용어 금지
 *   - 자막 한 줄 15~25자(디스플레이형), 조사는 앞 어절과 같은 줄
 *
 * caption 과 tts 를 나눈다: caption 은 화면 표기, tts 는 읽기용 발음 표기.
 */

import sceneDurations from "./scene-durations.json";

export const FPS = 30;
/** 기본 화자 — 🔴 2026-09-21 사용자 확정: 인준(속도 0%). 선히 +10% 는 어색하다는 판정 */
export const VOICE = "ko-KR-InJoonNeural";
export const RATE = "+0%";

export type SceneId =
  | "hook"
  | "paper"
  | "designer"
  | "fill"
  | "repeat"
  | "manage"
  | "branch"
  | "cta";

export interface SceneScript {
  /** 장면 식별자 = 컴포넌트 파일명 소문자 */
  id: SceneId;
  /** 작업용 장면 이름(화면에 나오지 않는다) */
  label: string;
  /** 기획서 5절 스토리보드의 시작·끝(초). 음성 길이 확정 뒤 tools/tts.mjs 가 역산값을 알려준다 */
  startSec: number;
  endSec: number;
  /** 화면 자막. 한 줄이 배열 한 칸 */
  captions: string[];
  /** 자막 아래 작은 각주(없으면 생략) */
  footnote?: string;
  /** 나레이션 원고(화면 표기 기준). 빈 문자열이면 음성 없음 */
  narration: string;
  /** 읽기용 발음 표기. 없으면 narration 을 그대로 읽는다 */
  tts?: string;
  /** 연출 메모(화면에 나오지 않는다) */
  note: string;
}

export const SCENES: SceneScript[] = [
  {
    id: "hook",
    label: "훅 — 아직도 수기로 쓰는 방명록",
    startSec: 0,
    endSec: 4,
    captions: ["방명록,", "아직도 수기로 작성하고 직접 관리하시나요?"],
    narration: "방명록, 아직도 수기로 작성하고 직접 관리하시나요?",
    note: "🔴 v3(2026-09-21 사용자 확정): 도입은 시청자의 구체적 문제(방명록·수기·직접 관리)로 연다. v2 의 「사람이 없어도, 문서는 쌓입니다」 = 결과 선언이라 폐기, 문서함 실캡처·도착 행·알림음(ui-tick)도 훅에서 뺐다(문서함 첫 등장은 Fill 의 오른쪽 도착으로 미룬다). 화면 = 생성 이미지 ① 종이 방명록(gen-01.png) 정지 → 4초 동안 1.00→1.06 느린 줌(easeOut). 손글씨 층(PaperInk)은 얹지 않는다 — 글씨 클로즈업은 다음 장면 Paper 의 푸시인 몫이다. 소리는 사무실 룸톤 room-tone.wav(4초·3.7초부터 페이드아웃) 아래 나레이션.",
  },
  {
    id: "paper",
    label: "종이 방명록의 오늘 — 노출과 손 정리",
    startSec: 4,
    endSec: 10,
    captions: ["연락처는 그대로 노출,", "정리는 전부 손으로"],
    narration:
      "앞사람 이름과 연락처는 그대로 노출되고, 그 기록은 결국 누군가 한 줄씩 옮겨 적어야 합니다.",
    note: "생성 이미지 ① 종이 방명록 푸시인(앞사람 이름·연락처가 읽히는 배율까지) → ② 밤 사무실 옮겨 적기. 종이 위 글자는 Remotion 텍스트로 얹는다. 🔴 v3 에서 길이 7→6초 — 앞 컷 비율 55% 라 최대 배율이 3.3초에 오고 나레이션 「…노출되고」가 끝나는 시점(추정 3.25초)과 맞는다.",
  },
  {
    id: "designer",
    label: "서식 만들기",
    startSec: 10,
    endSec: 17,
    captions: ["이폼사인에서", "서식을 만들고"],
    narration: "이폼사인에서 서식을 만드세요. 방명록도 동의서도 항목 그대로.",
    note: "웹폼 디자이너 실캡처. 항목 몇 개를 끌어다 놓고 저장, 외부 작성 주소를 받는다.",
  },
  {
    id: "fill",
    label: "누구나 작성 → 문서함 도착",
    startSec: 17,
    endSec: 27,
    captions: [
      "로그인 없이 누구나 작성",
      "전송하면 이폼사인 문서함에 바로",
    ],
    narration:
      "로그인 없이 누구나 바로 씁니다. 전송하면 그 순간 이폼사인 문서함에 완료 문서로 들어옵니다.",
    note: "생성 이미지 ③ 접수대 + 화면 자리에 외부 작성 실캡처 합성. 오른쪽 분할 화면에 문서함 도착.",
  },
  {
    id: "repeat",
    label: "다음 사람, 새 서식",
    startSec: 27,
    endSec: 35,
    captions: ["앞사람 정보는", "다음 사람에게 보이지 않습니다"],
    narration:
      "앞사람의 정보는 다음 사람에게 남지 않습니다. 이폼사인이 안전하게 보관합니다.",
    note: "생성 이미지 ④·⑤ 다른 방문자 두 명, 화면은 매번 새 서식. 오른쪽 문서함은 계속 쌓인다.",
  },
  {
    id: "manage",
    label: "검색·문서·이력",
    startSec: 35,
    endSec: 46,
    captions: ["검색 · PDF · 이력,", "이폼사인 안에서 끝"],
    narration:
      "옮겨 적는 일이 사라집니다. 검색하고, PDF로 열고, 처리 이력을 확인하는 것까지 이폼사인 안에서 끝납니다.",
    tts: "옮겨 적는 일이 사라집니다. 검색하고, 피디에프로 열고, 처리 이력을 확인하는 것까지 이폼사인 안에서 끝납니다.",
    note: "생성 이미지 ⑥ 담당자 노트북, 화면 자리에 문서함 실캡처 합성. 커서 모션은 Remotion 으로 그린다.",
  },
  {
    id: "branch",
    label: "방명록은 시작일 뿐",
    startSec: 46,
    endSec: 54,
    captions: ["방명록은 시작일 뿐", "계약 · 동의 · 접수, 전부 이폼사인"],
    narration:
      "방명록은 시작일 뿐입니다. 계약서, 동의서, 신청서도 같은 방법으로 이폼사인에서 처리됩니다.",
    note: "서식 한 장이 세 갈래로 갈라지고(방명록·동의서·신청서) 완료 문서가 같은 문서함으로 모인다.",
  },
  {
    id: "cta",
    label: "CTA — 이폼사인",
    startSec: 54,
    endSec: 60,
    captions: ["이폼사인", "지금 시작해 보세요", "eformsign.com"],
    footnote: "활용 사례: 이폼사인 방명록",
    narration: "이폼사인 닷컴, 지금 시작해 보세요",
    tts: "이폼사인 닷컴, 지금 시작해 보세요",
    note: "로고는 제공 PNG 만 쓴다(텍스트 조판 금지). 착지 주소 = www.eformsign.com.",
  },
];

/* ---------- 타임라인 = 나레이션 실측에서 파생 (2026-09-21 레인 I) ---------- */
/**
 * 🔴 위 리터럴의 startSec/endSec 는 **스토리보드 초안**일 뿐이다. 실제 타임라인은
 * `tools/scene-durations.mjs` 가 `public/voice/voice.json`(음성 실측)과 장면별 시각 최소
 * 길이로 계산해 `src/scene-durations.json` 에 적고, 아래에서 그 값으로 덮어쓴다.
 * 화자·속도·원고가 바뀌면 `node tools/voice-build.mjs …` → `node tools/scene-durations.mjs`
 * 두 명령으로 전부 따라온다 — 손으로 고칠 표가 없다.
 *
 * 🔴 왜 리터럴을 남기고 뒤에서 덮어쓰는가
 *   `tools/tts.mjs` 와 `tools/scene-durations.mjs` 는 TypeScript 없이 이 파일의 SCENES
 *   **배열 리터럴만 잘라 eval** 한다. 리터럴 안에서 JSON 을 참조하면 그 도구들이 깨진다.
 */
const TIMELINE = sceneDurations as unknown as {
  fps: number;
  totalFrames: number;
  scenes: Record<string, { startFrame: number; frames: number }>;
};

for (const s of SCENES) {
  const t = TIMELINE.scenes[s.id];
  if (!t) continue; // 산출 전이면 스토리보드 값을 그대로 쓴다
  s.startSec = t.startFrame / TIMELINE.fps;
  s.endSec = (t.startFrame + t.frames) / TIMELINE.fps;
}

/** 15초 컷다운 자막 3장 (세로 9:16 · 가로 16:9 공통) */
export interface CutCard {
  id: string;
  startSec: number;
  endSec: number;
  captions: string[];
  /** 컷다운이 빌려 쓰는 본편 장면 */
  from: SceneId;
}

export const CUT15: CutCard[] = [
  {
    id: "c1",
    startSec: 0,
    endSec: 3,
    captions: ["방명록,", "아직도 수기로 작성하고 직접 관리하시나요?"],
    from: "hook",
  },
  {
    id: "c2",
    startSec: 3,
    endSec: 10,
    captions: ["로그인 없이 누구나 작성", "전송하면 이폼사인 문서함에 바로"],
    from: "fill",
  },
  {
    id: "c3",
    startSec: 10,
    endSec: 15,
    captions: ["방명록은 시작일 뿐", "지금 시작해 보세요", "eformsign.com"],
    from: "cta",
  },
];

/* ---------- 파생 유틸 ---------- */

export const sec = (s: number) => Math.round(s * FPS);

export const scene = (id: SceneId): SceneScript => {
  const found = SCENES.find((s) => s.id === id);
  if (!found) throw new Error(`알 수 없는 장면: ${id}`);
  return found;
};

/** 스토리보드 기준 장면 길이(프레임). 음성 길이 역산은 tools/tts.mjs 참고 */
export const sceneFrames = (id: SceneId) => {
  const s = scene(id);
  return sec(s.endSec - s.startSec);
};

/** 본편 총길이 = 장면 프레임 합(나레이션 실측 파생). 스토리보드 60초는 더 이상 상수가 아니다 */
export const MAIN60_FRAMES = TIMELINE.totalFrames;
export const CUT15_FRAMES = sec(15);
export const LOOP30_FRAMES = sec(30);
export const GIF3_FRAMES = sec(3);
/**
 * Hook + Paper 스타일 확정용 시안. 길이는 두 장면 합에서 파생된다
 * (장면 길이를 재배분해도 Paper 나레이션이 잘리지 않는다 — 2026-09-18 기준 10초).
 */
export const PREVIEW9_FRAMES = sceneFrames("hook") + sceneFrames("paper");
