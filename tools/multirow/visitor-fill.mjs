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
// 2026-11-17: 필수 항목 수는 화면 「필수 입력 항목(0/N)」 에서 읽는다(성명·서명 = 2, 연락처 필수 서식 = 3).
//   --phone <번호>: 연락처 칸이 포커스를 받으면 입력한다(없으면 연락처를 비운 채 서명한다).
//   --expect-blocked: 「확인」 뒤 「전송」 버튼이 없고 진행도가 N/N 이 아니면 PASS(필수 차단 성립), 전송은 누르지 않는다.
const PHONE = arg('--phone');
const RESUME = argv.includes('--resume');   // 손글씨 창이 이미 열려 있는 탭에서 이어서(입력 시작·성명·다음 단계 생략). --req-n <N> 으로 필수 수를 준다.
const EXPECT_BLOCKED = argv.includes('--expect-blocked');
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
const REQ_N = RESUME ? Number(arg('--req-n', '0')) : Number(((state.prog || '').match(/\(0\/(\d+)\)/) || [])[1] || 0);
if (!RESUME && (!state.startBtn || !REQ_N)) done('FAIL', `start state: 입력 시작=${!!state.startBtn} 진행도=${state.prog}`, 2);

// ── 2. 입력 시작 → 성명 ──
if (!RESUME) {
await clickAt(state.startBtn, '입력 시작'); await sleep(1200);
await c.type(NAME); await sleep(600); note(`typed 성명 ${NAME}`);
await shot('2-name');
}

// ── 3. 다음 → (연락처 칸이 먼저 오면 거기서 입력/건너뜀) → 손글씨 창 ──
const padCanvas = async () => {
  const [ox, oy] = await oopifOffset(c);
  const cv = await c.evalView(`(()=>{const OX=${ox},OY=${oy};return [...document.querySelectorAll('canvas')].map(e=>{const q=e.getBoundingClientRect();return [Math.round(OX+q.left),Math.round(OY+q.top),Math.round(q.width),Math.round(q.height)]}).filter(r=>r[2]>=250&&r[2]<=480&&r[3]>=180&&r[3]<=320&&r[1]>=560)})()`);
  return Array.isArray(cv) && cv.length ? cv[0] : null;
};
const activeMode = () => c.evalView(`(()=>{const a=(function f(d){const x=d.activeElement;return x&&x.contentDocument?f(x.contentDocument):x})(document);return a&&a.tagName==='INPUT'?a.getAttribute('inputmode')||a.type:null})()`).catch(() => null);
let phoneTyped = false;
for (let hop = RESUME ? 4 : 0; hop < 4; hop++) {
  // 서명 창이 이미 열려 있으면(캔버스가 DOM 에 안 잡혀도 아래쪽 「확인」 버튼이 보이면) 더 누르지 않고 빠져나간다.
  if (hop > 0 && (await buttons('확인')).some((b) => b.center[1] > 400)) { note('손글씨 창 감지(확인 버튼) — 다음 클릭 생략'); break; }
  let nx = (await buttons('다음'))[0];
  if (!nx) { const ch2 = await measureChrome(c); nx = ch2?.start?.[0] && { center: ch2.start[0].center }; }
  // 「다음」 이 없고 이미 한 번 눌렀다면 손글씨 창이 열린 것으로 보고(캔버스가 DOM 에 안 잡히는 경우) 고정 좌표 폴백으로 이어간다.
  if (!nx && hop > 0) { note('「다음」 없음 — 손글씨 창으로 보고 진행'); break; }
  if (!nx) done('FAIL', '「다음」 button not found after typing (nothing sent)', 1);
  await clickAt(nx.center, '다음'); await sleep(1500);
  if (await padCanvas()) break;
  const mode = await activeMode(); note('after 다음 #' + (hop + 1) + ': active input mode=' + mode);
  if (mode === 'tel' && PHONE && !phoneTyped) { await c.type(PHONE); phoneTyped = true; await sleep(500); note('typed 연락처'); await shot('2b-phone'); }
}
await shot('3-pad');

// ── 4. stroke ──
let pad = await padCanvas();
if (!pad) { pad = [185, 600, 361, 249]; note('pad canvas not found in DOM — fixed fallback 185,600,361,249'); }
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
const fullRe = new RegExp(String.raw`\(${REQ_N}/${REQ_N}\)`);
if (EXPECT_BLOCKED) {
  const blocked = !fullRe.test(ch3?.prog || '') && !ch3?.send?.length;
  done(blocked ? 'PASS' : 'FAIL', `expect-blocked: 진행도=${ch3?.prog} 전송=${!!ch3?.send?.length} — 전송은 누르지 않았다`, blocked ? 0 : 1);
}
if (!fullRe.test(ch3?.prog || '') || !ch3?.send?.length) done('FAIL', `after 확인: 진행도=${ch3?.prog} 전송=${!!ch3?.send?.length} — 전송하지 않았다`, 1);
note(`필수 ${REQ_N}/${REQ_N} + 전송 버튼 확인`);

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
