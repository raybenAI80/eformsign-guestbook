// 「처음부터 다시」 + 복귀 카운트다운 설정 실기 검증 — 헤드리스 CDP
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
/** 🔴 제품 저장소의 config.js 는 회사·서식 ID 가 비어 있다 — 검증 때만 주입한다.
 *  KIOSK_QUERY="company=<id>&template=<id>" 를 환경변수로 넘긴다. */
const EXTRA = process.env.KIOSK_QUERY ? '&' + process.env.KIOSK_QUERY : '';
const nav = async url => { await send('Page.navigate', { url: url + EXTRA }); await sleep(9000); };
const st = () => evalJs(`JSON.stringify({
  session: __kioskState.session, phase: __kioskState.phase,
  warn: !document.getElementById('ovIdle').hidden,
  ring: document.getElementById('idleRing').textContent,
  blur: document.getElementById('frameHost').classList.contains('blurred'),
  confirm: !document.getElementById('ovRestart').hidden,
  btnHidden: document.getElementById('btnRestart').hidden,
  mark: document.getElementById('eformsign_iframe').__mark || null
})`).then(JSON.parse);
const logs = () => evalJs('JSON.stringify(__kioskLog.slice(-25))').then(JSON.parse);
const clickEl = idSel => evalJs(`document.getElementById('${idSel}').click(),1`);
const mark = () => evalJs(`document.getElementById('eformsign_iframe').__mark='M1',1`);
const blurOut = () => evalJs('document.activeElement.blur&&document.activeElement.blur();document.body.focus&&document.body.focus();1');
const waitFor = async (fn, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await st(); if (fn(v)) return v; await sleep(500); } return null; };

await send('Page.enable', {});
await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
const report = {};

// ── (a) ?countdown=8 → 카운트다운이 8 부터, 뒤 프레임 blur
await nav(`${BASE}/?countdown=8&idle=15&debug=1`);
await blurOut();
const aWarn = await waitFor(v => v.warn === true, 25000);
await shot('restart-a-countdown8');
report.a = { warn: aWarn, pass: !!aWarn && aWarn.ring === '8' && aWarn.blur === true };

// ── (c) 취소 → 입력 유지(프레임 미재생성)
await nav(`${BASE}/?countdown=5&idle=600&abandon=600&debug=1`);
await mark();
const cBefore = await st();
await clickEl('btnRestart'); await sleep(600);
const cConfirm = await st();
await shot('restart-c-confirm');
await clickEl('btnRestartNo'); await sleep(800);
const cAfter = await st();
await shot('restart-c-cancelled');
report.c = { before: cBefore, confirm: cConfirm, after: cAfter,
  pass: cConfirm.confirm === true && cAfter.confirm === false
     && cAfter.session === cBefore.session && cAfter.mark === 'M1', logs: await logs() };

// ── (b) 확인 → 새 세션 + 프레임 재생성
await clickEl('btnRestart'); await sleep(600);
await clickEl('btnRestartYes'); await sleep(6000);
const bAfter = await st();
await shot('restart-b-after-confirm');
const bLogs = await logs();
report.b = { after: bAfter, pass: bAfter.session === cBefore.session + 1 && bAfter.mark === null
  && bLogs.some(l => l.includes('reason=manual')), logs: bLogs };

// ── (d) 감사 화면 중 버튼 숨김
await evalJs('__kioskSimulateSubmit("PROBE-RESTART")'); await sleep(1200);
const dState = await st();
await shot('restart-d-thanks-button-hidden');
report.d = { state: dState, pass: dState.phase === 'thanks' && dState.btnHidden === true };

const all = report.a.pass && report.b.pass && report.c.pass && report.d.pass;
fs.writeFileSync(`${OUT}/restart-cases-report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ a: report.a.pass, b: report.b.pass, c: report.c.pass, d: report.d.pass }));
console.log('ALL_PASS=' + all);
ws.close();
process.exit(all ? 0 : 1);
