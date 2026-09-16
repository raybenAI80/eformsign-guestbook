// 무응답 리셋 3케이스 실기 검증 — 헤드리스 CDP
import fs from 'node:fs';
const PORT = process.env.CDP_PORT || '9233';
const BASE = process.env.KIOSK_BASE || 'http://localhost:8099';
const OUT = 'D:/pjt/eformsign/kiosk-product/evidence/final';
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

// ── CASE 1: 프레임 안에 포커스를 둔 채 40초 대기 → 리셋되지 않아야 한다 (idle=15)
await nav(`${BASE}/?idle=15&abandon=180&debug=1`);
await click(500, 518);                       // 방문자 성명 입력 영역
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

console.log(JSON.stringify({case1:report.case1.pass,case2:report.case2.pass,case3:report.case3.pass}));
fs.writeFileSync(`${OUT}/idle-cases-report.json`, JSON.stringify(report, null, 1));
const allPass = report.case1.pass && report.case2.pass && report.case3.pass;
console.log('ALL_PASS=' + allPass);
ws.close();
process.exit(allPass ? 0 : 1);
