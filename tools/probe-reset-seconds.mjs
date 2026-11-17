// 무응답 리셋 시간 측정 — 설정값(idle/abandon/countdown)을 URL 쿼리로 주고 실제 경고·리셋 시각을 잰다.
//   CDP_PORT=9272 KIOSK_BASE=http://localhost:8696 node tools/probe-reset-seconds.mjs --idle 30 --abandon 30 [--countdown 5] [--tap 400,700] [--skip-engage]
// 동의 화면은 누르지 않는다. 기본은 작성 프레임 영역을 한 번 눌러 포커스를 프레임 안으로 보낸 뒤(engaged=true)
// 아무것도 하지 않고 경고(덮개)와 리셋(startSession 번호 증가)까지 걸린 초를 출력한다.
// --skip-engage: 프레임을 누르지 않는다(빈 화면 방치 = idle 한도).
// 출력 한 줄: RESULT {limitExpected, warnAt, resetAt, engaged, sessionBefore, sessionAfter}. 화면 저장·저장소 쓰기 없음.
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = process.env.CDP_PORT || '9240';
const BASE = process.env.KIOSK_BASE;
if (!BASE) { console.error('KIOSK_BASE 필수(함정 ㉚)'); process.exit(2); }
const idle = Number(arg('--idle', '30')), abandon = Number(arg('--abandon', '30')), countdown = Number(arg('--countdown', '5'));
const skipEngage = process.argv.includes('--skip-engage');
const [tx, ty] = (arg('--tap', '400,700')).split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
const st = async () => JSON.parse(await ev('JSON.stringify({session:__kioskState.session,phase:__kioskState.phase,engaged:__kioskIdle.engaged,inFrame:__kioskIdle.inFrame,warn:!document.getElementById("ovIdle").hidden})'));
await send('Page.enable', {});
await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/?idle=${idle}&abandon=${abandon}&countdown=${countdown}` });
// 작성 화면이 뜰 때까지(phase=form) 기다린다
let s0; const t0 = Date.now();
while (Date.now() - t0 < 40000) { try { s0 = await st(); if (s0.phase === 'form') break; } catch {} await sleep(500); }
if (!s0 || s0.phase !== 'form') { console.log('RESULT ' + JSON.stringify({ error: 'phase!=form', s0 })); process.exit(1); }
await sleep(3000);
if (!skipEngage) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tx, y: ty, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1 }); }
await sleep(1500);
const start = Date.now(); const before = await st();
let warnAt = null, resetAt = null, after = before;
while (Date.now() - start < 130000) {
  await sleep(500); after = await st();
  const sec = Math.round((Date.now() - start) / 100) / 10;
  if (warnAt === null && after.warn) warnAt = sec;
  if (after.session > before.session) { resetAt = sec; break; }
}
const limit = skipEngage || !before.engaged ? idle : Math.max(abandon, idle);
console.log('RESULT ' + JSON.stringify({ config: { idle, abandon, countdown }, limitExpected: limit, engaged: before.engaged, inFrame: before.inFrame, warnAtSec: warnAt, resetAtSec: resetAt, sessionBefore: before.session, sessionAfter: after.session }));
ws.close(); process.exit(resetAt !== null ? 0 : 1);
