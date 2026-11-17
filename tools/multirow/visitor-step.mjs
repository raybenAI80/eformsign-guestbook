// visitor-step — one visitor row of the 「방문자 기록부」 multirow document, typed + signed + sent, with evidence shots.
// 2026-10-07 lane D4a (실제 화면 편 V3 촬영). Reproduces the visitor-1 manual procedure (.work/progress-lane-d4a.md
// 「방문자 1」) with every coordinate MEASURED live (measure-row.mjs), never hard-coded.
//
//   node tools/multirow/visitor-step.mjs --port 9242 --tab <idPrefix> --row N --name <성명> --phone <연락처>
//        --purpose '단순 문의'|'도입 상담'|기타 [--staff <담당자>] --tag V3 --ev <evidence dir>
//
// Flow: scale-1 shot + state check (「입력 시작」 visible, row N open, not done; else exit 2)
//   -> 입력 시작 -> 성명·연락처·[담당자] typed (values read back) -> 목적 체크 -> 서명 버튼 -> signpad touch stroke (seed=N)
//   -> 확인 -> 「필수 입력 항목(2/2)」 + 「전송」 present (else exit 3, NOT sent) -> 2.5x evidence -> scale-1 reset shot
//   -> 「전송」 mouse click ONCE -> 16 x 500 ms burst (2.5x) -> +12 s return shots (2.5x, then scale 1 last)
//   -> judge: consent gate back (unchecked, 「계속」 disabled) + same document title + row N done + row N+1 open.
// stdout: ONE JSON line {row,name,status:PASS|FAIL,reason,evidence:[...]}; exit 0 PASS / 1 FAIL after send /
//   2 bad start state / 3 stopped before send (nothing sent). Logs go to stderr.
// --judge-only [--title <t>]: no input at all, just re-run step 7 on the current screen (e.g. after a judge crash).
// Files: <ev>/<tag>-step<N>-start.png, -filled-x25.png, -presend.png, <tag>-send<N>-t00..t15.png,
//   <tag>-step<N>-after-return-x25.png, -after-return.png (+ -fail.png on exit 3).
//
// 🔴 함정 (all measured 2026-10-07):
//  - A 2.5x Page.captureScreenshot leaves Input.* coordinates scaled x0.4 for every CDP session on the tab;
//    this script always shoots scale 1 right before any click/tap and ends on a scale-1 shot.
//  - The viewport (768x1389) is owned by a separate hold session (demo-cdp --hold); this script never sets
//    metrics (= --no-metrics). Do not use tablet-step --attach on this tab.
//  - The consent checkbox / 「계속」 are NOT clicked here — the caller (orchestrator) passes consent first.
//  - Send happens once. On any doubt before send the script exits 3 without sending; after send it never retries.
//  - All rows must finish inside one sheet window (site env NEW_SHEET=daily) or visitors split into documents.
import path from 'node:path';
import { connect, sleep } from './cdp-lib.mjs';
import { measureRow, measureChrome, rowValues, consentState } from './measure-row.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
const N = Number(arg('--row')), NAME = arg('--name'), PHONE = arg('--phone'), PURPOSE = arg('--purpose', '단순 문의');
const STAFF = arg('--staff'), TAG = arg('--tag', 'V3'), EV = arg('--ev', '.');
const PURPOSES = ['단순 문의', '도입 상담', '기타'];
const evidence = [];
const log = (...a) => console.error(new Date().toTimeString().slice(0, 8), ...a);
const out = (status, reason, code) => {
  console.log(JSON.stringify({ row: N, name: NAME, status, reason, evidence }));
  process.exit(code);
};
if (!N || !NAME || !PHONE || !PURPOSES.includes(PURPOSE)) { console.error('usage: see header'); out('FAIL', 'bad arguments', 2); }

if (argv.includes('--judge-only')) {
  for (const n of [`step${N}-after-return-x25`, `step${N}-after-return`]) evidence.push(path.join(EV, `${TAG}-${n}.png`));
  const j0 = await connect({ port: arg('--port', '9242'), tab: arg('--tab', ''), metrics: false, scale: 1 });
  const t = arg('--title') || (await measureChrome(j0))?.title; j0.close();
  await judge(t);
}
const c = await connect({ port: arg('--port', '9242'), tab: arg('--tab', ''), metrics: false, scale: 2.5 });
const f = (name) => path.join(EV, `${TAG}-${name}.png`);
const shot1 = async (name) => evidence.push(await c.shot(f(name), 1));
const shot25 = async (name) => evidence.push(await c.shot(f(name), 2.5));
const stop = async (reason) => { await shot1(`step${N}-fail`); out('FAIL', reason + ' (not sent)', 3); };

// 1. state check (the scale-1 shot also resets the input mapping)
await shot1(`step${N}-start`);
let ch = await measureChrome(c); let row = await measureRow(c, N);
log('start', JSON.stringify({ title: ch?.title, start: ch?.start?.[0]?.center, prog: ch?.prog, open: row?.open, done: row?.done, err: row?.error }));
if (!ch || !ch.start?.length || !row || row.error || !row.open || row.done) {
  out('FAIL', `start state: 입력시작=${!!ch?.start?.length} open=${row?.open} done=${row?.done} ${row?.error || ''}`, 2);
}
const TITLE = ch.title;

// 2. 입력 시작 (header button = topmost)
await c.click(...ch.start[0].center); log('click 입력 시작', ch.start[0].center); await sleep(1200);

// 3. text fields — re-measure before each field
const field = async (key, text) => {
  const r = await measureRow(c, N); const p = r?.[key];
  if (!p || !p.enabled) return stop(`${key} not enabled`);
  await c.click(...p.center); await sleep(400); await c.type(text); await sleep(500);
  log(`${key} @${p.center} <- ${text}`);
};
await field('name', NAME);
await field('phone', PHONE);
if (STAFF) await field('staff', STAFF);
row = await measureRow(c, N);
const chk = row?.checks?.[PURPOSES.indexOf(PURPOSE)];
if (!chk || row.checks.length !== 3) await stop(`purpose checkboxes ${row?.checks?.length}`);
await c.click(...chk.click); log(`purpose ${PURPOSE} @${chk.click}`); await sleep(600);
const vals = await rowValues(c, N);
log('values', JSON.stringify(vals));
if (vals?.name !== NAME || vals?.phone !== PHONE || (STAFF && vals?.staff !== STAFF)) await stop('read-back mismatch ' + JSON.stringify(vals));

// 4. signature: open pad, draw (touch, seed=N), confirm (touch)
await c.click(...row.sign.center); log('sign button', row.sign.center); await sleep(1500);
ch = await measureChrome(c);
if (!ch?.pad) await stop('signpad not shown');
const [px, py, pw, ph] = ch.pad; const ink0 = ch.padInk;
await c.draw(px + 39, py + 20, pw - 76, ph - 46, N); await sleep(500);
ch = await measureChrome(c); log('pad', ch.pad, 'ink', ink0, '->', ch.padInk);
if (!(ch.padInk > ink0 + 1000)) await stop(`no ink on pad ${ink0}->${ch.padInk}`);
const ok = (ch.ok || []).filter((b) => b.rect[1] > py).pop() || (ch.ok || []).pop();
if (!ok) await stop('signpad 확인 not found');
await c.tap(...ok.center); log('tap 확인', ok.center); await sleep(1500);

// 5. (2/2) gate — nothing is sent before this passes
ch = await measureChrome(c);
log('after sign', JSON.stringify({ prog: ch?.prog, send: ch?.send?.[0]?.center, pad: ch?.pad }));
if (ch?.prog !== '필수 입력 항목(2/2)' || !ch.send?.length || ch.pad) await stop(`not ready: ${ch?.prog} send=${ch?.send?.length} pad=${!!ch?.pad}`);
await shot25(`step${N}-filled-x25`);
await shot1(`step${N}-presend`);                       // reset mapping right before the click
ch = await measureChrome(c);
const sendBtn = ch.send?.[0];
if (!sendBtn) await stop('전송 vanished after reset shot');

// 6. send ONCE + burst
const t0 = Date.now();
await c.click(...sendBtn.center); log('click 전송', sendBtn.center);
evidence.push(...await c.burst(16, 500, (k) => f(`send${N}-t${String(k).padStart(2, '0')}`)));
const wait = t0 + 20000 - Date.now(); if (wait > 0) await sleep(wait);   // ≈ +12 s after the 8 s burst window
await shot25(`step${N}-after-return-x25`);
await shot1(`step${N}-after-return`);                  // last shot = scale 1 (mapping left normal)

// 7. judge — on a FRESH CDP connection: after 전송 the viewer OOPIF reloads and Runtime.evaluate on the old
//    flattened session returns exceptions (2026-10-07 visitor 2: all checks read false while the screen was correct).
async function judge(TITLE) {
  const j = await connect({ port: arg('--port', '9242'), tab: arg('--tab', ''), metrics: false, scale: 1 });
  const cs = await consentState(j);
  const hasTitle = await j.evalView(`document.body.innerText.includes(${JSON.stringify(TITLE)})`);
  const rN = await measureRow(j, N); const rNext = N < 10 ? await measureRow(j, N + 1) : null;
  j.close();
  const checks = {
    consentBack: !!cs?.present && cs.checked === false,
    continueDisabled: cs?.continueDisabled === true,
    sameTitle: hasTitle === true,
    rowDone: rN?.done === true,
    nextOpen: N >= 10 ? true : rNext?.open === true,
  };
  log('judge', JSON.stringify({ checks, rN: rN?.error || { done: rN?.done, cyFrom: rN?.cyFrom }, rNext: rNext?.error || { open: rNext?.open, time: rNext?.time } }));
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  out(failed.length ? 'FAIL' : 'PASS', failed.length ? 'failed: ' + failed.join(',') + (rN?.error ? ' / ' + rN.error : '')
    : `row ${N} done, row ${N + 1} open${rNext?.time ? ' ' + rNext.time : ''}, consent gate back (unchecked), title 「${TITLE}」`, failed.length ? 1 : 0);
}
c.close();
await judge(TITLE);
