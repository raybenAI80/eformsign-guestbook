import manifest from "./demo-shots.json";
import type { Rect } from "./shots-scenes";

/**
 * 실제 화면 편(Demo53) 캡처 매니페스트 읽기 — 정본 = `src/demo-shots.json`.
 *
 * 🔴 소재가 없으면 **그리지 않고 멈춘다.** 홍보편 장면은 캡처가 없을 때 그 컷을 빼고 갔지만,
 *    실제 화면 편은 「이게 실제 화면입니다」가 약속이라 빈 자리를 조용히 넘기면 안 된다.
 *    장면 컴포넌트가 `requireDemoShots(scene, need)` 를 부르면, 요구한 소재·표식 중 하나라도
 *    빠졌을 때 **빠진 것 전부를 한 번에** 적은 Error 를 던진다 → 그 장면이 걸린 프레임의
 *    렌더·스틸이 그 메시지로 멈춘다. 다른 장면 프레임은 영향이 없다(Sequence 밖에서는
 *    컴포넌트가 마운트되지 않는다).
 */

export type DemoShotStatus = "ready" | "missing";

export interface DemoShot {
  /** public/shots/ 기준 상대 경로 */
  file: string;
  status: DemoShotStatus;
  width: number | null;
  height: number | null;
  /** 기기 화면에 담을 영역(캡처 화소). 없으면 캡처 전체 */
  viewport?: Rect | null;
  /** 명부 행 bbox(위→아래, 캡처 화소) */
  rows?: Rect[];
  /** 이름 붙은 표식(캡처 화소). 장면이 요구하는 키는 각 장면 파일 상단 NEED 참조 */
  marks?: Record<string, Rect | null>;
}

/** 검증을 통과한 소재 — 크기·표식이 모두 채워져 있다 */
export interface ReadyShot {
  file: string;
  width: number;
  height: number;
  viewport: Rect | null;
  rows: Rect[];
  marks: Record<string, Rect>;
}

type Scenes = Record<string, Record<string, DemoShot>>;
const M = manifest as unknown as {
  plate: { file: string; screenQuadScene: number };
  scenes: Scenes;
};

export const DEMO_PLATE = M.plate;

/** 장면 하나가 요구하는 것 — { 소재키: [표식키…] }. rows 가 필요하면 표식 목록에 "#rows:N" */
export type DemoNeed = Record<string, string[]>;

/** 요구 대비 빠진 것 목록(사람이 읽는 문장). 빈 배열이면 전부 있다 */
export const demoShotProblems = (scene: string, need: DemoNeed): string[] => {
  const block = M.scenes[scene];
  if (!block) return [`매니페스트에 장면 「${scene}」 블록이 없다`];
  const out: string[] = [];
  for (const [key, marks] of Object.entries(need)) {
    const s = block[key];
    if (!s) {
      out.push(`${scene}.${key}: 매니페스트 항목 없음`);
      continue;
    }
    if (s.status !== "ready") {
      out.push(`${scene}.${key}: 캡처 없음 → public/shots/${s.file}`);
      continue;
    }
    if (!s.width || !s.height) out.push(`${scene}.${key}: width/height 미기입 (${s.file})`);
    for (const m of marks) {
      const rowsNeed = /^#rows:(\d+)$/.exec(m);
      if (rowsNeed) {
        const n = Number(rowsNeed[1]);
        if ((s.rows?.length ?? 0) < n) out.push(`${scene}.${key}: rows ${n}개 필요(현재 ${s.rows?.length ?? 0})`);
        continue;
      }
      if (!s.marks?.[m]) out.push(`${scene}.${key}: 표식 marks.${m} 미기입`);
    }
  }
  return out;
};

/**
 * 장면이 쓸 소재를 꺼낸다. 하나라도 빠졌으면 Error 를 던져 렌더를 멈춘다.
 * 🔴 대체 그림을 그리지 않는다 — 이 함수가 던지지 않으면 모든 소재가 실캡처다.
 */
export const requireDemoShots = (scene: string, need: DemoNeed): Record<string, ReadyShot> => {
  const problems = demoShotProblems(scene, need);
  if (problems.length) {
    throw new Error(
      /* 한 줄로 — Remotion CLI 는 Error 메시지 첫 줄만 크게 찍는다(줄바꿈 뒤 목록이 묻혔다) */
      `[Demo53] 장면 「${scene}」 캡처 소재 없음, 렌더 중단 (src/demo-shots.json): ${problems.join(" | ")}`,
    );
  }
  const block = M.scenes[scene];
  const out: Record<string, ReadyShot> = {};
  for (const key of Object.keys(need)) {
    const s = block[key];
    const marks: Record<string, Rect> = {};
    for (const [k, v] of Object.entries(s.marks ?? {})) if (v) marks[k] = v;
    out[key] = {
      file: s.file,
      width: s.width as number,
      height: s.height as number,
      viewport: s.viewport ?? null,
      rows: s.rows ?? [],
      marks,
    };
  }
  return out;
};

export const rectCenterPt = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];
