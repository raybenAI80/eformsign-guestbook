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
 * 서식 지정: `--form <formId>` (= `--template <formId>`) · 환경변수 KIOSK_FORM / KIOSK_TEMPLATE /
 *            KIOSK_QUERY="company=..&template=.."
 * 환경변수: KIOSK_COORDS (JSON 문자열) · KIOSK_TAP_X / KIOSK_TAP_Y (첫 입력칸 = `name` 키)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

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
 * @returns {{coords: object, sources: string[], templateId: string, warnings: string[]}}
 */
export function resolveCoords({ templateId = '', argv = [], env = {} } = {}) {
  const c = JSON.parse(JSON.stringify(DEFAULT_COORDS));
  const sources = ['default'];
  const warnings = [];

  const tpl = templateId || argOf(argv, 'form', '') || argOf(argv, 'template', '')
    || env.KIOSK_FORM || env.KIOSK_TEMPLATE
    || (/(?:^|&)template=([^&]+)/.exec(env.KIOSK_QUERY || '') || [])[1] || '';
  if (tpl) {
    const prof = new URL('./form-profiles/' + decodeURIComponent(tpl) + '.json', import.meta.url);
    try { Object.assign(c, JSON.parse(fs.readFileSync(prof, 'utf8'))); sources.push('profile:' + tpl); }
    catch {
      // 프로필 없음 = 기본값 사용. 값 입력이 목적이면 --notype 을 쓴다.
      warnings.push('서식 프로필 없음(form-profiles/' + decodeURIComponent(tpl) + '.json) — 레퍼런스 기본 좌표로 폴백한다. '
        + '좌표가 서식과 어긋나면 프레임 포커스가 들어가지 않아 검증이 FAIL 로 보일 수 있다.');
    }
  } else {
    warnings.push('서식 ID 미지정(--form <formId>) — 레퍼런스 기본 좌표를 쓴다.');
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

  return { coords: c, sources, templateId: tpl, warnings };
}

/**
 * 외부 작성자 **동의 게이트**(전자문서 사용 동의 체크 → 「계속」)를 통과시킨다.
 *
 * 🔴 2026-09-16 함정: 이 게이트를 지나지 않으면 작성 화면(입력칸)이 아직 없다.
 *    프로브가 입력칸 좌표를 맹목적으로 클릭해도 프레임 포커스가 들어가지 않아
 *    `__kioskIdle.engaged` 가 false 로 남고, 그 프로브 케이스는 **래퍼 결함이 아닌데도** FAIL 한다
 *    (probe-idle-reset case1·case4 가 실제로 이렇게 오판했다 — index.html 회귀가 아니었다).
 *    동의 게이트가 없는 서식이면 이 클릭들은 빈 여백을 누르는 것이라 무해하다.
 *
 * 🔴 게이트 유무 감지(2026-09-16 신설) — `cdpPort` 를 주면 클릭 전에 **게이트가 실제로 떠 있는지**
 *    작성 iframe 의 DOM 으로 확인하고, 없으면 클릭을 생략한다. 근거는 아래 detectConsentGate 주석.
 *
 * @param {object} o
 * @param {(x:number,y:number)=>Promise<any>} o.click   좌표 클릭 (대기 없음)
 * @param {(ms:number)=>Promise<any>} o.sleep
 * @param {object} o.coords                              resolveCoords() 결과
 * @param {number} [o.consentWait]  동의 체크 뒤 대기(ms)
 * @param {number} [o.continueWait] 「계속」 뒤 작성 화면이 뜰 때까지 대기(ms)
 * @param {number|string} [o.cdpPort] 헤드리스 크롬 CDP 포트. 주면 게이트 유무를 먼저 감지한다.
 * @returns {Promise<{gate: boolean|null, clicked: boolean, passed: boolean|null, detail: object|null}>}
 *          gate=true 게이트 있었음 · false 없음(클릭 생략) · null 감지 불가(예전처럼 그냥 클릭)
 */
export async function passConsentGate({ click, sleep, coords, consentWait = 700, continueWait = 8000, cdpPort = '' }) {
  let detail = null, gate = null;
  if (cdpPort) {
    detail = await detectConsentGate({ port: cdpPort });
    gate = detail.gate;
  }
  if (gate === false) return { gate: false, clicked: false, passed: null, detail };

  await click(coords.consent[0], coords.consent[1]);
  await sleep(consentWait);
  await click(coords.continue[0], coords.continue[1]);
  await sleep(continueWait);

  let passed = null;
  if (cdpPort && gate === true) {
    const after = await detectConsentGate({ port: cdpPort, waitMs: 0 });
    passed = after.gate === false;
  }
  return { gate, clicked: true, passed, detail };
}

/**
 * 작성 iframe 안에 **외부 작성자 동의 게이트**가 떠 있는지 CDP 로 조회한다.
 *
 * 왜 이렇게 하나(2026-09-16 실측)
 *   작성 화면은 `www.eformsign.com/eform/document/external_user_view_service.html` 을 띄운
 *   교차 출처 iframe 이고, 사이트 격리 때문에 **별도 CDP 타깃(type=iframe)** 으로 잡힌다.
 *   그 타깃에 `Target.attachToTarget({flatten:true})` 로 붙으면 그 문서 안에서 `Runtime.evaluate`
 *   가 된다. 서식 본문은 `<canvas>` 라 읽을 수 없지만 **동의 게이트는 평범한 DOM** 이다:
 *     · `#terms_agree`  = 「전자문서 및 전자서명 사용에 동의합니다」 체크박스
 *     · `#agreeButton`  = 「계속」 버튼 (게이트를 지나면 감춰진다)
 *   둘 중 하나라도 보이면 게이트가 떠 있는 것이다.
 *   (참고: `#terms_agree_all`·`#terms_agree_company` 는 이 서식에서 항상 숨겨져 있다.)
 *
 * @param {object} o
 * @param {number|string} o.port  CDP 포트
 * @param {number} [o.waitMs]     작성 iframe 타깃이 나타날 때까지 기다릴 시간(ms)
 * @returns {Promise<{gate: boolean|null, reason: string, agreeButton?: boolean, consentBox?: boolean}>}
 */
export async function detectConsentGate({ port, waitMs = 8000 }) {
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const WRITER = /eformsign\.com\/eform\/document\/external_user_view_service/i;
  let ws = null;
  try {
    const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    ws = new WebSocket(ver.webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) {
        const p = pend.get(m.id); pend.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const send = (method, params, sessionId) => new Promise((res, rej) => {
      const i = ++id; pend.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });

    let target = null;
    const t0 = Date.now();
    do {
      const { targetInfos } = await send('Target.getTargets', {});
      target = targetInfos.find((t) => t.type === 'iframe' && WRITER.test(t.url || ''));
      if (target || Date.now() - t0 >= waitMs) break;
      await nap(500);
    } while (true);
    if (!target) return { gate: null, reason: '작성 iframe 타깃을 찾지 못했다(아직 안 떴거나 구조가 바뀌었다)' };

    const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const EXPR = `(function(){
      var vis = function(el){ return !!(el && (el.offsetParent || el.getClientRects().length)); };
      var box = document.getElementById('terms_agree');
      var btn = document.getElementById('agreeButton');
      return JSON.stringify({ consentBox: vis(box), agreeButton: vis(btn), checked: !!(box && box.checked) });
    })()`;
    const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true }, sessionId);
    try { await send('Target.detachFromTarget', { sessionId }); } catch {}
    if (r.exceptionDetails) return { gate: null, reason: 'iframe 평가 실패: ' + (r.exceptionDetails.exception?.description || '') };
    const d = JSON.parse(r.result.value);
    const gate = !!(d.consentBox || d.agreeButton);
    return { gate, reason: gate ? '동의 게이트 있음' : '동의 게이트 없음(또는 이미 통과)', ...d };
  } catch (e) {
    return { gate: null, reason: '감지 불가: ' + (e && e.message || e) };
  } finally {
    try { ws && ws.close(); } catch {}
  }
}

// ── 포트·프로필 공용 유틸 (2026-09-16 신설) ────────────────────────────────
/**
 * 🔴 왜 여기 있는가 — 검증 도구가 저마다 고정 포트를 잡으면 **다른 세션의 헤드리스 크롬과
 *    충돌**한다. 특히 프로필 디렉터리를 포트 이름만으로 만들면, 남의 크롬이 물고 있는
 *    디렉터리를 지우려다 `EBUSY … unlink` 로 죽는다(2026-09-16 실사고).
 *    그래서 ① 포트는 리슨 시도로 빈 것을 찾고 ② 프로필은 포트+PID 로 **새로** 만들며
 *    ③ 남의 디렉터리는 **건드리지 않는다**.
 *
 * 🔴 8099~8599 는 이 저장소의 다른 도구(정적 서버·다른 워커)가 쓰는 대역이다. CDP 포트로
 *    쓰지 않는다. 기본 탐색 시작점이 8699 인 이유.
 */
export const RESERVED_PORT_RANGE = [8099, 8599];

/** 이미 떠 있는 크롬에 붙는 도구의 CDP 포트 기본값(공용). */
export const DEFAULT_ATTACH_CDP_PORT = 9240;

/** 빈 TCP 포트를 start 부터 순차 탐색한다. @returns {Promise<number>} */
export async function pickFreePort({ start = 8699, span = 50, host = '127.0.0.1' } = {}) {
  for (let p = start; p < start + span; p++) {
    const ok = await new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.once('listening', () => s.close(() => resolve(true)));
      try { s.listen(p, host); } catch { resolve(false); }
    });
    if (ok) return p;
  }
  throw new Error(`빈 포트를 찾지 못했습니다 (${start}~${start + span - 1})`);
}

/**
 * 포트+PID 로 고유한 크롬 프로필 디렉터리를 만든다.
 * 🔴 기존에 남아 있는(=다른 프로세스가 물고 있을 수 있는) 디렉터리는 지우지 않고 건너뛴다.
 */
export function makeProfileDir(tool, port) {
  let dir = path.join(os.tmpdir(), `kiosk-${tool}-profile-${port}-${process.pid}`);
  let n = 0;
  while (fs.existsSync(dir)) dir = path.join(os.tmpdir(), `kiosk-${tool}-profile-${port}-${process.pid}-${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 예약 대역(8099~8599)을 CDP 포트로 쓰면 경고한다. */
export function warnReservedCdpPort(port, toolName = '') {
  const p = Number(port);
  if (p >= RESERVED_PORT_RANGE[0] && p <= RESERVED_PORT_RANGE[1]) {
    console.warn(`⚠️  CDP 포트 ${p} 는 정적 서버·다른 워커가 쓰는 예약 대역(${RESERVED_PORT_RANGE.join('~')}) 입니다.`
      + ` ${toolName ? toolName + ' 은 ' : ''}CDP_PORT=${DEFAULT_ATTACH_CDP_PORT} 처럼 9240 계열을 쓰세요.`);
    return true;
  }
  return false;
}
