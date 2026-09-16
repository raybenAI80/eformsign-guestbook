// 무응답 리셋 5케이스 실기 검증 — 헤드리스 CDP
import fs from 'node:fs';
import { resolveCoords } from './form-coords.mjs';
const PORT = process.env.CDP_PORT || '9233';
const BASE = process.env.KIOSK_BASE || 'http://localhost:8099';
const OUT = 'D:/pjt/eformsign/kiosk-product/evidence/final';
/** 🔴 작성 프레임 안을 터치하는 좌표. 서식 항목이 바뀌면 입력칸 위치도 바뀐다.
 *  프레임은 다른 도메인이라 위치를 자동으로 찾을 수 없다(실측 부정 결과 — form-coords.mjs 머리말).
 *  해석 규칙은 verify-kiosk.mjs 와 같은 `form-coords.mjs` 를 쓴다.
 *    · 서식별 프로필:  KIOSK_QUERY="company=..&template=<formId>"  → form-profiles/<formId>.json 자동 적용
 *    · 직접 지정:      KIOSK_TAP_X=500 KIOSK_TAP_Y=518 node probe-idle-reset.mjs
 *  아무 입력칸이어도 된다 — 이 프로브가 보는 것은 "프레임 안으로 포커스가 들어갔는가" 뿐이다. */
const { coords: COORDS, sources: COORD_SRC } = resolveCoords({ argv: process.argv, env: process.env });
const [TAP_X, TAP_Y] = COORDS.name;
console.log('COORDS name=' + JSON.stringify(COORDS.name) + ' via ' + COORD_SRC.join(','));
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const t = targets.find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise(r => ws.onopen = r);
const evalJs = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval fail');
  return r.result.value;
};
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log('SHOT ' + name);
};
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
/** 🔴 제품 저장소의 config.js 는 회사·서식 ID 가 비어 있다 — 검증 때만 주입한다.
 *  KIOSK_QUERY="company=<id>&template=<id>" 를 환경변수로 넘긴다. */
const EXTRA = process.env.KIOSK_QUERY ? '&' + process.env.KIOSK_QUERY : '';
const nav = async url => { await send('Page.navigate', { url: url + EXTRA }); await sleep(9000); };
const st = () => evalJs('JSON.stringify({session:__kioskState.session,phase:__kioskState.phase,engaged:__kioskIdle.engaged,src:__kioskIdle.source,warn:!document.getElementById("ovIdle").hidden})');
const logs = () => evalJs('JSON.stringify(__kioskLog.slice(-40))').then(x=>JSON.parse(x));
const report = {};
const waitFor = async (fn, ms=30000) => { const t0=Date.now(); while (Date.now()-t0<ms) { const v=JSON.parse(await st()); if (fn(v)) return v; await sleep(500); } return null; };

await send('Page.enable', {});
await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });

// ── CASE 1: 프레임 안에 포커스를 두고 40초 대기 → abandon 한도(180s) 전이므로 리셋 없음 (idle=15)
await nav(`${BASE}/?idle=15&abandon=180&debug=1`);
await click(TAP_X, TAP_Y);                       // 작성 프레임 안 입력칸
await sleep(800);
for (const ch of '홍길동') await send('Input.insertText', { text: ch });
await sleep(500);
const c1before = JSON.parse(await st());
await shot('idle-case1-a-focus-in-frame');
await sleep(40000);
const c1after = JSON.parse(await st());
await shot('idle-case1-b-after-40s-no-reset');
report.case1 = { before: c1before, after: c1after, pass: c1before.session === c1after.session && !c1after.warn, logs: await logs() };

// ── CASE 2: 프레임 밖(포커스 없음)에서 대기 → 카운트다운 → 리셋 (idle=15)
await nav(`${BASE}/?idle=15&abandon=180&debug=1`);
await evalJs('document.activeElement.blur&&document.activeElement.blur();document.body.focus&&document.body.focus();1');
const c2start = JSON.parse(await st());
const c2warn = await waitFor(v => v.warn === true, 25000);
await shot('idle-case2-a-countdown');
const c2after = await waitFor(v => v.session > c2start.session, 15000);
await shot('idle-case2-b-after-reset');
report.case2 = { start: c2start, warn: c2warn, after: c2after, pass: !!c2warn && !!c2after, logs: await logs() };

// ── CASE 3: 카운트다운 중 터치 → 취소
await nav(`${BASE}/?idle=15&abandon=180&debug=1`);
await evalJs('document.activeElement.blur&&document.activeElement.blur();document.body.focus&&document.body.focus();1');
const c3start = JSON.parse(await st());
const c3warn = await waitFor(v => v.warn === true, 25000);
await shot('idle-case3-a-countdown');
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 384, y: 760 }] });
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(1200);
const c3cancel = JSON.parse(await st());
await shot('idle-case3-b-cancelled');
await sleep(8000);
const c3after = JSON.parse(await st());
report.case3 = { start: c3start, warn: c3warn, cancelled: c3cancel, after: c3after,
  pass: !!c3warn && c3cancel.warn === false && c3after.session === c3start.session, logs: await logs() };

// ── CASE 4 (2026-09-16 신설): 프레임 안에 포커스를 **유지한 채** 이탈 → abandon 리셋이 와야 한다
//    이전 판은 포커스가 프레임 안이면 매 초 타이머를 되감아 리셋이 영원히 오지 않았다.
await nav(`${BASE}/?idle=15&abandon=20&countdown=5&debug=1`);
await click(TAP_X, TAP_Y);                       // 작성 프레임 안 입력칸 = 포커스가 프레임 안으로
await sleep(800);
for (const ch of '이탈테스트') await send('Input.insertText', { text: ch });
await sleep(800);
const c4start = JSON.parse(await st());
await shot('idle-case4-a-typed-focus-in-frame');
const c4warn = await waitFor(v => v.warn === true, 30000);
await shot('idle-case4-b-countdown-blur');    // 흐림 덮개
const c4after = await waitFor(v => v.session > c4start.session, 15000);
await shot('idle-case4-c-after-reset');
report.case4 = { start: c4start, warn: c4warn, after: c4after,
  pass: c4start.engaged === true && !!c4warn && !!c4after, logs: await logs() };

// ── CASE 5 (2026-09-16 신설): 카운트다운 덮개를 터치 → 취소되고 타이머가 다시 시작해야 한다
//    (포커스가 프레임 안에 있어도 덮개가 화면 전체를 덮으므로 부모가 터치를 받는다)
await nav(`${BASE}/?idle=15&abandon=20&countdown=5&debug=1`);
await click(TAP_X, TAP_Y);
await sleep(800);
for (const ch of '이탈테스트') await send('Input.insertText', { text: ch });
const c5start = JSON.parse(await st());
const c5warn = await waitFor(v => v.warn === true, 30000);
await shot('idle-case5-a-countdown');
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 384, y: 760 }] });
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(1500);
const c5cancel = JSON.parse(await st());
await shot('idle-case5-b-cancelled');
await sleep(8000);                            // 취소 직후 8초 = 한도(20s) 전이므로 여전히 같은 세션
const c5mid = JSON.parse(await st());
const c5again = await waitFor(v => v.session > c5start.session, 25000);   // 타이머 재시작 → 다시 리셋
report.case5 = { start: c5start, warn: c5warn, cancelled: c5cancel, mid: c5mid, again: c5again,
  pass: !!c5warn && c5cancel.warn === false && c5mid.session === c5start.session && !!c5again, logs: await logs() };

console.log(JSON.stringify({case1:report.case1.pass,case2:report.case2.pass,case3:report.case3.pass,case4:report.case4.pass,case5:report.case5.pass}));
fs.writeFileSync(`${OUT}/idle-cases-report.json`, JSON.stringify(report, null, 1));
const allPass = report.case1.pass && report.case2.pass && report.case3.pass && report.case4.pass && report.case5.pass;
console.log('ALL_PASS=' + allPass);
ws.close();
process.exit(allPass ? 0 : 1);
