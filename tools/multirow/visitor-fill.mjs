// visitor-fill — one visitor of the handwriting 누적형 방명록 (성명 + 손글씨 서명, 2/2) typed, signed and sent.
// 2026-11-16. Starts AFTER the consent gate (the caller clicks 동의 체크 + 「계속」 first, e.g. consent-click.mjs).
//
//   node tools/multirow/visitor-fill.mjs --port <cdp> --tab <idPrefix> --name "<성명>" --shape <any integer, used mod 10> --out <evidence prefix>
//        [--dry] [--wait-next <sec, default 60>]
//
// Flow: scale-1 shot + state check (「입력 시작」 visible, 필수 0/2) -> 입력 시작 (focus lands in the 성명 field)
//   -> Input.insertText 성명 -> 「다음」 (header button) -> 손글씨 창 -> mouse-drag stroke (shape = seed) -> 「확인」
//   -> 「필수 입력 항목(2/2)」 + 「전송」 present (else exit 1, NOT sent) -> 「전송」 ONCE -> 감사 화면
//   -> wait (<= --wait-next s) until the wrapper opens the next visitor's consent gate -> screenshot.
// --dry: touches nothing. Reports the current screen (consent gate / 입력 시작 / 진행도) + one screenshot, exit 0 when readable.
// Exit codes: 0 PASS · 1 FAIL (reason printed; nothing is sent unless the failure is after the 전송 click) · 2 bad arguments / start state.
// stdout = ONE JSON line {status, name, shape, reason, evidence[], steps[]}; logs go to stderr.
//
// 🔴 This script never clicks the consent checkbox or 「계속」. Coordinates come from the live DOM of the eformsign viewer
//   (m_external_view_service OOPIF); the fixed fallbacks below are the 768-wide layout measured 2026-11-16 and are logged when used.
// 🔴 A 2.5x capture leaves Input.* coordinates scaled; every shot here is scale 1.
// 🔴 No company / template IDs in this file (public repository).
import path from 'node:path';
import { connect, sleep, strokePoints } from './cdp-lib.mjs';
import { measureChrome, consentState, oopifOffset } from './measure-row.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
const DRY = argv.includes('--dry');
const NAME = arg('--name');
const SHAPE = ((Number(arg('--shape', '0')) % 10) + 10) % 10;   // any integer; reduced mod 10 (NaN stays NaN -> bad arguments)
const OUT = arg('--out', '.local/evidence-multirow/visitor-fill');
const WAIT_NEXT = Number(arg('--wait-next', '60'));
const evidence = []; const steps = [];
const log = (...a) => console.error(new Date().toTimeString().slice(0, 8), ...a);
const done = (status, reason, code) => { console.log(JSON.stringify({ status, name: NAME, shape: SHAPE, reason, evidence, steps })); process.exit(code); };

if (!DRY && (!NAME || !Number.isInteger(SHAPE))) { console.error('usage: see header (--name and an integer --shape required)'); done('FAIL', 'bad arguments', 2); }
if (!arg('--port') || arg('--tab') === undefined) { console.error('usage: --port and --tab required'); done('FAIL', 'bad arguments', 2); }

let c;
const open = () => connect({ port: arg('--port'), tab: arg('--tab'), metrics: false, scale: 1, log: () => {} });
try { c = await open(); }
catch (e) { done('FAIL', 'cannot connect: ' + e.message, 2); }
const shot = async (name) => { const f = `${OUT}-${name}.png`; await c.shot(f, 1); evidence.push(f); log('shot', f); };
const note = (s) => { steps.push(s); log(s); };

// visible buttons / links with exactly this text, in top-page CSS px (viewer OOPIF offset added), topmost first
async function buttons(text) {
  const [ox, oy] = await oopifOffset(c);
  const r = await c.evalView(`(()=>{const OX=${ox},OY=${oy};const vis=e=>{const q=e.getBoundingClientRect();const s=getComputedStyle(e);return q.width>0&&q.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
    return [...document.querySelectorAll('button,a,div,span')].filter(e=>vis(e)&&e.children.length<=1&&e.innerText&&e.innerText.trim()===${JSON.stringify(text)})
      .map(e=>{const q=e.getBoundingClientRect();return {center:[Math.round(OX+q.left+q.width/2),Math.round(OY+q.top+q.height/2)],w:Math.round(q.width),h:Math.round(q.height)}}).sort((a,b)=>a.center[1]-b.center[1])})()`);
  return Array.isArray(r) ? r : [];
}
const consentOf = () => consentState(c).catch(() => null);
const clickAt = async (xy, what) => { await c.shot(`${OUT}-_reset.png`, 1); await c.click(...xy); note(`click ${what} @${xy}`); };

// ── 1. current screen ──
await shot('1-start');
const ch = await measureChrome(c); const cs = await consentOf();
const state = { title: ch?.title, prog: ch?.prog, startBtn: ch?.start?.[0]?.center || null, sendBtn: ch?.send?.[0]?.center || null,
  consentGate: !!(cs && cs.present), consentChecked: cs?.checked ?? null, continueDisabled: cs?.continueDisabled ?? null };
note('state ' + JSON.stringify(state));
if (DRY) {
  const readable = !!(ch && (ch.title || state.consentGate));
  done(readable ? 'DRY' : 'FAIL', readable
    ? (state.consentGate && state.consentChecked === false ? '동의 화면(체크 안 됨). 아무것도 누르지 않았다' : '작성 화면. 아무것도 누르지 않았다')
    : 'screen not readable (viewer frame not attached)', readable ? 0 : 1);
}
if (state.consentGate && state.consentChecked === false) done('FAIL', '동의 화면이 아직 떠 있다 — 동의 체크와 「계속」은 호출자가 먼저 누른다 (nothing clicked)', 2);
if (!state.startBtn || !/\(0\/2\)/.test(state.prog || '')) done('FAIL', `start state: 입력 시작=${!!state.startBtn} 진행도=${state.prog}`, 2);

// ── 2. 입력 시작 → 성명 ──
await clickAt(state.startBtn, '입력 시작'); await sleep(1200);
await c.type(NAME); await sleep(600); note(`typed 성명 ${NAME}`);
await shot('2-name');

// ── 3. 다음 → 손글씨 창 ──
let nx = (await buttons('다음'))[0];
if (!nx) { const ch2 = await measureChrome(c); nx = ch2?.start?.[0] && { center: ch2.start[0].center }; }
if (!nx) done('FAIL', '「다음」 button not found after typing (nothing sent)', 1);
await clickAt(nx.center, '다음'); await sleep(1500);
await shot('3-pad');

// ── 4. stroke ──
let pad = null;
const [ox, oy] = await oopifOffset(c);
const cv = await c.evalView(`(()=>{const OX=${ox},OY=${oy};return [...document.querySelectorAll('canvas')].map(e=>{const q=e.getBoundingClientRect();return [Math.round(OX+q.left),Math.round(OY+q.top),Math.round(q.width),Math.round(q.height)]}).filter(r=>r[2]>=250&&r[2]<=480&&r[3]>=180&&r[3]<=320&&r[1]>=560)})()`);
if (Array.isArray(cv) && cv.length) pad = cv[0]; else { pad = [185, 600, 361, 249]; note('pad canvas not found in DOM — fixed fallback 185,600,361,249'); }
const pts = strokePoints(pad[0], pad[1], pad[2], pad[3], SHAPE);
const m = (type, x, y, b) => c.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !b ? 'none' : 'left', buttons: b, clickCount: 1 });
await c.shot(`${OUT}-_reset.png`, 1);
await m('mouseMoved', pts[0][0], pts[0][1], 0); await m('mousePressed', pts[0][0], pts[0][1], 1);
for (const [x, y] of pts.slice(1)) { await sleep(20); await m('mouseMoved', x, y, 1); }
const last = pts[pts.length - 1]; await m('mouseReleased', last[0], last[1], 0);
note(`stroke shape ${SHAPE} on pad ${pad}`); await sleep(500);
await shot('4-stroke');

// ── 5. 확인 ──
let ok = (await buttons('확인')).filter((b) => b.center[1] > 400).pop();
let okXY = ok?.center; if (!okXY) { okXY = [665, 555]; note('확인 button not found in DOM — fixed fallback 665,555'); }
await clickAt(okXY, '확인'); await sleep(1500);
const ch3 = await measureChrome(c);
await shot('5-confirmed');
if (!/\(2\/2\)/.test(ch3?.prog || '') || !ch3?.send?.length) done('FAIL', `after 확인: 진행도=${ch3?.prog} 전송=${!!ch3?.send?.length} — 전송하지 않았다`, 1);
note('필수 2/2 + 전송 버튼 확인');

// ── 6. 전송 (once) ──
await clickAt(ch3.send[0].center, '전송');
await sleep(2500); await shot('6-sent');

// ── 7. wait for the wrapper to open the next visitor's consent gate ──
const t0 = Date.now(); let next = null;
while (Date.now() - t0 < WAIT_NEXT * 1000) {
  await sleep(2000);
  let s = await consentOf();
  // The wrapper reloads the viewer iframe; the old CDP session can lose the new frame (consentOf -> null/undefined). Reconnect and read again.
  if (!s || typeof s !== 'object') { try { c.close(); } catch {} try { c = await open(); s = await consentOf(); note('reconnected CDP while waiting for the next consent gate'); } catch {} }
  if (s && typeof s === 'object' && s.present && s.checked === false) { next = s; break; }
}
await sleep(1500); await shot('7-next-consent');
if (!next) done('FAIL', `sent, but the next consent gate did not appear within ${WAIT_NEXT}s`, 1);
note('next visitor consent gate is up (not clicked)');
done('PASS', 'sent; next consent gate shown', 0);
