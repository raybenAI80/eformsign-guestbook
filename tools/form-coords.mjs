/**
 * 서식별 클릭 좌표 해석기 — 검증 도구 공용.
 *
 * 🔴 왜 좌표인가(자동 탐색 부정 결과, 2026-09-16 실측)
 *    작성 프레임은 다른 도메인의 iframe 이고 그 안의 OZ 뷰어는 서식을 `<canvas>` 로 그린다.
 *    입력칸이 DOM 으로 나오지 않아 **위치를 자동으로 찾아낼 방법이 없다**
 *    (컴포넌트 후보 요소 0건 · 뷰어 JS 에 component/field API 0건 · 노출된 input 은 툴바 버튼뿐).
 *    그래서 "자동 탐색 우선, 실패 시 프로필" 이 아니라 **프로필 + 값 입력 생략(--notype)** 이
 *    서식 중립의 실제 수단이다.
 *
 * 우선순위: 기본값 → `form-profiles/<templateId>.json` → `--coords <file>` → `--<키>-x/-y` → 환경변수
 * 환경변수: KIOSK_COORDS (JSON 문자열) · KIOSK_TAP_X / KIOSK_TAP_Y (첫 입력칸 = `name` 키)
 */
import fs from 'node:fs';

/** 레퍼런스 서식(768×1024 태블릿 뷰포트) 실측 기본값.
 *  `name`/`org` 는 항목 이름이 아니라 **첫 번째·두 번째 입력칸**이라는 뜻이다. */
export const DEFAULT_COORDS = {
  consent: [38, 196],    // 전자문서 사용 동의 체크
  continue: [708, 175],  // 「계속」
  name: [480, 464],      // 첫 번째 입력칸
  org: [520, 518],       // 두 번째 입력칸
  send: [686, 973],      // 「전송」
  popup1: [606, 639],    // 확인 팝업의 전송(reCAPTCHA 없을 때)
  popup2: [606, 716],    // 확인 팝업의 전송(reCAPTCHA 있을 때 팝업이 길어진다)
  // ── 이탈 매트릭스(probe-abandon-matrix.mjs)가 쓰는 칸 ──
  purpose: [333, 679],   // 아무 체크박스 하나(레퍼런스 서식에서는 「방문 목적 = 회의」)
  zoomOut: [663, 151],   // 뷰어 축소(−) 버튼. 서식과 무관한 뷰어 툴바 좌표다
  signField: [512, 374], // 최소 배율(20%)에서 보이는 서명 칸
  // 「빈 서식인가」를 픽셀로 비교할 잘라내기 영역 [x, y, width, height].
  // 첫 입력칸을 감싸는 사각형이면 된다.
  blankClip: [322, 470, 350, 52],
};

const argOf = (argv, n, d) => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : d; };

/**
 * @param {object} o
 * @param {string} [o.templateId]  서식 ID. 주면 form-profiles/<id>.json 을 자동으로 읽는다.
 * @param {string[]} [o.argv]      process.argv
 * @param {object} [o.env]         process.env
 * @returns {{coords: object, sources: string[]}}
 */
export function resolveCoords({ templateId = '', argv = [], env = {} } = {}) {
  const c = JSON.parse(JSON.stringify(DEFAULT_COORDS));
  const sources = ['default'];

  const tpl = templateId || argOf(argv, 'template', '') || (/(?:^|&)template=([^&]+)/.exec(env.KIOSK_QUERY || '') || [])[1] || '';
  if (tpl) {
    const prof = new URL('./form-profiles/' + decodeURIComponent(tpl) + '.json', import.meta.url);
    try { Object.assign(c, JSON.parse(fs.readFileSync(prof, 'utf8'))); sources.push('profile:' + tpl); }
    catch { /* 프로필 없음 = 기본값 사용. 값 입력이 목적이면 --notype 을 쓴다. */ }
  }

  const file = argOf(argv, 'coords', '');
  if (file) { Object.assign(c, JSON.parse(fs.readFileSync(file, 'utf8'))); sources.push('file:' + file); }

  if (env.KIOSK_COORDS) { Object.assign(c, JSON.parse(env.KIOSK_COORDS)); sources.push('env:KIOSK_COORDS'); }

  for (const k of Object.keys(DEFAULT_COORDS)) {
    const x = argOf(argv, k + '-x', ''), y = argOf(argv, k + '-y', '');
    if (x !== '' || y !== '') {
      c[k] = [Number(x !== '' ? x : c[k][0]), Number(y !== '' ? y : c[k][1])];
      sources.push('arg:' + k);
    }
  }

  if (env.KIOSK_TAP_X || env.KIOSK_TAP_Y) {
    c.name = [Number(env.KIOSK_TAP_X || c.name[0]), Number(env.KIOSK_TAP_Y || c.name[1])];
    sources.push('env:KIOSK_TAP');
  }

  return { coords: c, sources };
}
