// Drive ONE participant step of a member-variant multirow document in a tablet viewport (768x1024 portrait,
// Android tablet UA -> eformsign mobile viewer view_iframe_mobile, fit-to-width) on the logged-in capture Chrome.
// Measures the rendered input boxes from the viewer iframe DOM (OZ inputs are real <input> elements) and fills
// the editable row (+ text-tab signature), then sends. Never logs in / switches accounts.
//
// node tablet-step.mjs --doc <.local/.../doc.json> --row N --ev <evidence dir> --tag <name> [--port 9223] [--tab <id prefix>]
//        [--no-send] [--start] [--no-step-check] [--sign text|draw] [--viewport 768x1024] [--timezone Asia/Seoul] [--burst-after-send 6x500]   (--start: tap header 「입력 시작」 first and record where the viewer scrolls)
// Send check (2026-09-29): the document step is read from the API before/after 「전송」; unchanged => exit 2, stderr FAIL: <reason>
//   (+ HINT for the embedded-external blank-next-step setEmbeddingReceipients TypeError). Needs EFORMSIGN_CORE_DIR + EFORMSIGN_ENV_FILE.
// Output (stdout JSON): own-row input rects (CSS px, viewport), name box height, page/scroll info, send result.
// 2026-09-28 measured: PC UA at 768 wide = view_iframe_pc at 100% (overflows); mobile UA list page bounces to
// m_document_list (no documentUtil) -> get the open URL with PC UA first, then navigate with the tablet UA.
// Signature pad in the mobile viewer ignores CDP mouse drags (touch listeners only). Input.dispatchTouchEvent times out while touch emulation is
//   OFF; with Emulation.setTouchEmulationEnabled ON only around the stroke it draws (2026-10-03, --sign draw). Default --sign text = 「텍스트」 tab.
// D안 (2026-09-28, --layout tools/multirow/layout-product.json --variant D): own row = the visible enabled signature button +
//   the editable text inputs on the same row band (성명·연락처·기타내용·담당자, 시각 is read-only). 방문 목적 checkboxes are not
//   <input> elements in the mobile viewer -> clicked at coordinates mapped from layout pt (scale from 성명/연락처 input lefts).
//   --check "단순 문의,기타"  --manager "<담당자>"  --other "<기타 내용>"  --min (성명+서명 only)
// --attach (with --tab <id prefix>, v5 2026-09-28): drive a tab that is ALREADY loaded — e.g. the kiosk wrapper
//   (probe.mjs serve, external visitor) after the consent screen was passed by a person. No navigation; the eformsign OOPIF
//   (external_view_service or m_view_service) is looked up under that tab. The Chrome process must carry --user-agent=<tablet UA>.
import fs from 'node:fs';
import path from 'node:path';
import { loadLayout, rowTop as rowTopPt, purposeItems } from './layout.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const port = arg('--port', '9223'); const row = Number(arg('--row')); const E = arg('--ev'); const tag = arg('--tag', 'x');
// --doc optional with --attach --no-send (promo capture, 2026-10-03): documentId is only read by the send step check
const d = arg('--doc') ? JSON.parse(fs.readFileSync(arg('--doc'), 'utf8')) : {};
if (!d.documentId && !(has('--attach') && has('--no-send'))) throw new Error('--doc <doc.json> required (only --attach --no-send may omit it)');
const TABLET_UA = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t;
if (arg('--tab')) t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.id.startsWith(arg('--tab')));
else t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
if (!t) throw new Error('no target');
// background tabs do not take input focus -> typing into OZ inputs is lost (measured); bring it to front
await fetch(`http://127.0.0.1:${port}/json/activate/${t.id}`);
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const pend = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 45000); });
// page exceptions / console errors from the viewer (top page + eformsign OOPIF) -> used to explain a silent send failure (D v6 #49)
const pageErrors = [];
const onEvt = (m) => {
  if (m.method === 'Runtime.exceptionThrown') { const x = m.params.exceptionDetails; pageErrors.push(String(x.exception?.description ?? x.text ?? '').slice(0, 300)); }
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
};
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } else if (m.method) onEvt(m); };
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Runtime.enable');
let evSend = null; // set in --embed mode: Runtime.evaluate goes to the eformsign OOPIF (m_view_service) target
const ev = async (js) => { const r = await (evSend ?? send)('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)); return r.result.value; };
const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
// frame-relative click: coords measured inside the eformsign OOPIF (start/sign/send buttons) + the wrapper iframe offset (0,0 in --embed; wrapper top bar in --attach, D v6 2026-09-29)
const clickF = async (x, y) => { const [ox, oy] = globalThis.__OFF ?? [0, 0]; return click(x + ox, y + oy); };
// --shot-scale S (promo 2026-10-03): clip the 768x1024 viewport at scale S (2.5 -> 1920x2560); default = plain viewport capture
const SHOT_SCALE = Number(arg('--shot-scale', '0'));
// --viewport WxH (promo 2026-10-03, default 768x1024): e.g. 768x1389 matches the device-mockup screen ratio 0.553 -> 2.5x = 1920x3472
const [VW, VH] = String(arg('--viewport', '768x1024')).split('x').map(Number);
// --timezone <IANA> (promo 2026-10-03): Emulation.setTimezoneOverride on the page AND the eformsign OOPIF session (session-scoped: released on disconnect)
const TZ = arg('--timezone');
// --burst-after-send NxMS (promo 2026-10-03, default off): N shots MS apart right after the 「전송」 click (send-t0..t{N-1}) — the wrapper thank-you cover lasts ~3 s
const BURST = arg('--burst-after-send') ? String(arg('--burst-after-send')).split('x').map(Number) : null;
const shot = async (name) => { const r = await send('Page.captureScreenshot', SHOT_SCALE ? { format: 'png', clip: { x: 0, y: 0, width: VW, height: VH, scale: SHOT_SCALE } } : { format: 'png' }); fs.mkdirSync(E, { recursive: true }); const f = path.join(E, `${tag}-${name}.png`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f; };
const text = () => ev("document.body.innerText.split(String.fromCharCode(10)).filter(x=>x.trim()).slice(0,40).join(' | ')");
const out = { row, shots: [] };
// --shot-steps (promo 2026-10-03): extra stage shots typing(성명·연락처 입력 직후) / checked(방문 목적 체크 후) / signed(서명 확인 직후)
const stepShot = async (name) => { if (has('--shot-steps')) out.shots.push(await shot(`step${row}-${name}`)); };
const embed = arg('--embed');
const attach = has('--attach');
if (embed || attach) {
  // --embed <url>: no logged-in session needed (the dead 9223 path). tools/multirow/embed-member.mjs serves an efs_embedded_v2 page
  // with user.type 01 + API member token. 🔴 The tablet UA must be set on the Chrome process (--user-agent=...): a page-level
  // Emulation UA override does not reach the eformsign OOPIF, whose viewer then picks the PC toolbar layout at 100% (measured 2026-09-28).
  await send('Emulation.setUserAgentOverride', { userAgent: TABLET_UA });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: true });
  if (attach) await sleep(Number(arg('--wait', '4000'))); // re-layout under the metrics override, no navigation
  else { await send('Page.navigate', { url: embed }); await sleep(Number(arg('--wait', '25000'))); }
  const fr = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((x) => x.type === 'iframe' && (attach ? /view_service/ : /m_view_service/).test(x.url) && (!x.parentId || x.parentId === t.id));
  if (!fr.length) throw new Error('embedded view_service frame not found');
  const fws = new WebSocket(fr.at(-1).webSocketDebuggerUrl); const fp = new Map(); let fid = 0;
  fws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && fp.has(m.id)) { const p = fp.get(m.id); fp.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } else if (m.method) onEvt(m); };
  await new Promise((r) => (fws.onopen = r));
  evSend = (method, params = {}) => new Promise((res, rej) => { const i = ++fid; fp.set(i, { res, rej }); fws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (fp.has(i)) { fp.delete(i); rej(new Error('timeout ' + method)); } }, 45000); });
  await evSend('Runtime.enable');
  if (TZ) { for (const sx of [send, evSend]) { try { await sx('Emulation.setTimezoneOverride', { timezoneId: TZ }); } catch (e) { (out.tzErrors ??= []).push(e.message.slice(0, 120)); } } out.timezone = TZ; }
  const off = (await send('Runtime.evaluate', { expression: "(()=>{const r=document.getElementById('eformsign_iframe').getBoundingClientRect();return [r.left,r.top]})()", returnByValue: true })).result.value;
  globalThis.__OFF = off; out.embed = true; globalThis.__FWS = fws;
} else {
// 1) open URL via PC UA
await send('Emulation.setUserAgentOverride', { userAgent: PC_UA });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
await send('Page.navigate', { url: 'https://www.eformsign.com/eform/document/document_list.html?mode=ip' }); await sleep(7000);
const rel = await ev(`documentUtil.getOpenDocUrl(${JSON.stringify(d.documentId)})`);
if (!/^\/eform\/document\/view_service\.html\?/.test(String(rel))) throw new Error('open url not resolved (list page not PC?): ' + String(rel).slice(0, 60));
// 2) tablet
await send('Emulation.setUserAgentOverride', { userAgent: TABLET_UA });
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: true });
// touch emulation stays OFF: with it on at load the mobile viewer ignores CDP mouse clicks for the whole page life (measured 2026-09-28);
// the mobile viewer is chosen by UA, so the tablet layout (view_iframe_mobile, fit-to-width) is unchanged.
await send('Page.navigate', { url: 'https://www.eformsign.com' + rel }); await sleep(20000);
}
out.shots.push(await shot(`step${row}-open`));
// measure: inputs inside the viewer iframe, grouped into rows of 4 (성명·연락처·목적 text + 서명 button) in DOM order
const OX0 = () => (globalThis.__OFF ?? [0, 0]);
const measure = `(()=>{const OX=${OX0()[0]},OY=${OX0()[1]};const f=[...document.querySelectorAll('iframe')].find(x=>/view_iframe/.test(x.src));if(!f)return null;const o0=f.getBoundingClientRect();const o={left:o0.left+OX,top:o0.top+OY,x:o0.left+OX,y:o0.top+OY,width:o0.width,height:o0.height,toJSON(){return {x:this.x,y:this.y,width:this.width,height:this.height}}};const dd=f.contentDocument;
const els=[...dd.querySelectorAll('input')].filter(e=>e.type==='text'||e.type==='button'||e.type==='checkbox').map(e=>{const r=e.getBoundingClientRect();return {t:e.type,ck:e.type==='checkbox'?e.checked:undefined,x:r.left+o.left,y:r.top+o.top,w:r.width,h:r.height,vis:r.width>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none',dis:e.disabled||e.readOnly}});
const sc=dd.scrollingElement?{top:dd.scrollingElement.scrollTop,h:dd.scrollingElement.scrollHeight}:null;
const scrollers=[...dd.querySelectorAll('div')].filter(x=>x.scrollHeight>x.clientHeight+50&&x.clientHeight>300).map(x=>({top:x.scrollTop,sh:x.scrollHeight,ch:x.clientHeight})).slice(0,3);
const probe=${has('--probe') ? 'true' : 'false'}?[...dd.querySelectorAll('input,[role=checkbox],[class*=heck]')].slice(0,400).map(e=>{const r=e.getBoundingClientRect();return [e.tagName,e.type||'',String(e.className).slice(0,40),Math.round(r.left+o.left),Math.round(r.top+o.top),Math.round(r.width),Math.round(r.height),e.disabled||e.readOnly||false,getComputedStyle(e).visibility,e.checked]}):undefined;
return {frame:o.toJSON(),n:els.length,els,sc,scrollers,inner:[innerWidth,innerHeight],probe}})()`;
const m = await ev(measure);
if (!m) throw new Error('viewer iframe not found');
out.inputCount = m.n; out.frame = m.frame; out.scrollers = m.scrollers;
if (has('--probe')) { out.probe = m.probe; out.els = m.els.map((e) => [e.t, Math.round(e.x), Math.round(e.y), Math.round(e.w), Math.round(e.h), e.vis, e.dis, e.ck]); console.log(JSON.stringify(out)); ws.close(); globalThis.__FWS?.close(); process.exit(0); }
// Row identity: the OZ <input> elements carry no FORMID -> the own row = the visible, editable (not readonly) inputs;
// sorted left->right they are 성명, 연락처, 방문목적 (text) and 서명 (button).
const LAY = arg('--layout') ? loadLayout() : null;
const pickOwn = (mm) => {
  if (LAY?.style === 'reception') {
    const sp = mm.els.filter((e) => e.t === 'button' && e.vis && e.w > 0 && !e.dis);
    if (!sp.length) return [];
    // v8 (2026-09-29): the signHint strip shortens the signpad/담당자 boxes -> own-row band tests the input TOP only (성명 box now ends below the signpad)
    const band = [sp[0].y - 12, sp[0].y + sp[0].h + 12];
    const tx = mm.els.filter((e) => e.t === 'text' && e.vis && e.w > 0 && !e.dis && e.y >= band[0] && e.y <= band[1]).sort((p, q) => p.x - q.x);
    return [...tx, sp[0]];
  }
  const tx = mm.els.filter((e) => e.t === 'text' && e.vis && e.w > 0 && !e.dis).sort((p, q) => p.x - q.x).slice(0, 3);
  if (!tx.length) return [];
  const sp = mm.els.filter((e) => e.t === 'button' && e.vis && e.w > 0 && Math.abs(e.y + e.h / 2 - (tx[0].y + tx[0].h / 2)) < 8);
  return [...tx, ...sp.slice(0, 1)];
};
const own = pickOwn(m);
out.own = own.map((e) => ({ t: e.t, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.w), h: Math.round(e.h) }));
out.nameBoxHeightPx = own.length ? Math.round(own[0].h * 10) / 10 : null;
out.nameBoxHeightPass = own.length ? own[0].h >= 44 : null;
// previous rows must have their inputs hidden (SetVisible(false)): count visible inputs above the own row
out.visibleInputsAboveOwn = own.length ? m.els.filter((e) => e.vis && e.w > 0 && e.y + e.h <= own[0].y - 2).length : null;
out.ownInViewport = own.length ? own[0].y >= m.frame.y && own[0].y + own[0].h <= Math.min(m.frame.y + m.frame.height, VH - 70) : null;
// 🔴 measurement above is at mobile:true (the judged tablet render). CDP mouse input is ignored while the metrics
// override says mobile:true (touch path; Input.dispatchTouchEvent times out) -> for interaction flip to mobile:false at the
// same 768x1024. That re-lays the viewer out slightly larger (A: name box 38px -> 46px), so interaction shots are not the judged render.
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false }); await sleep(2000);
if (has('--start')) {
  const r = await ev(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>x.innerText.trim()==='입력 시작'&&x.getBoundingClientRect().width>0);if(!b)return null;const q=b.getBoundingClientRect();return [q.left+q.width/2,q.top+q.height/2]})()`);
  out.startButton = r;
  if (r) { await clickF(r[0], r[1]); await sleep(2500); out.shots.push(await shot(`step${row}-after-start`)); const m2 = await ev(measure); const g2 = pickOwn(m2); out.ownAfterStart = g2.map((e) => ({ x: Math.round(e.x), y: Math.round(e.y), h: Math.round(e.h) })); out.ownInViewportAfterStart = g2[0].y >= m2.frame.y && g2[0].y + g2[0].h <= VH - 70; out.textAfterStart = (await text()).slice(0, 200);
    // close any input dialog the start button opened (text input dialog / keypad) is not expected in the mobile viewer; continue
  }
}
if (own.length !== (LAY?.style === 'reception' ? 5 : 4)) { console.log(JSON.stringify(out, null, 1)); ws.close(); process.exit(1); }
if (!out.ownInViewport && !has('--start')) {
  // scroll the own row into view by clicking needs it on screen -> use element.scrollIntoView inside the viewer iframe
  await ev(`(()=>{const f=[...document.querySelectorAll('iframe')].find(x=>/view_iframe/.test(x.src));const e=[...f.contentDocument.querySelectorAll('input')].find(e=>e.type==='text'&&!e.readOnly&&e.getBoundingClientRect().width>0);e.scrollIntoView({block:'center'});return 1})()`);
  await sleep(1500); out.scrolledIntoView = true;
}
const m3 = await ev(measure); const g3 = pickOwn(m3);
const c = (e) => [Math.round(e.x + e.w / 2), Math.round(e.y + e.h / 2)];
const vals = [`방문자${row}`, `010-${String(1000 + row).slice(-4)}-${String(5000 + row).slice(-4)}`, ['단순 문의', '도입 상담', '견학'][row % 3]];
const active = `(()=>{const f=[...document.querySelectorAll('iframe')].find(x=>/view_iframe/.test(x.src));const a=f.contentDocument.activeElement;return (a&&a.tagName)+' '+(a&&a.id)+' ro='+(a&&a.readOnly)})()`;
out.clicks = [];
if (LAY?.style === 'reception') {
  // g3 = [성명, 연락처, 기타내용, 담당자, 서명]
  const checks = (arg('--check', '') || '').split(',').filter(Boolean);
  // --name/--phone (promo 2026-10-03): override the default 방문자N / 010-... values (use obviously fake values)
  const dv = [arg('--name', `방문자${row}`), arg('--phone', `010-${String(1000 + row).slice(-4)}-${String(5000 + row).slice(-4)}`), checks.includes('기타') ? arg('--other', '견학') : '', arg('--manager', '')];
  const order = has('--min') ? [0] : [0, 1, 2, 3];
  for (const i of order) { if (!dv[i]) continue; const [x, y] = c(g3[i]); await click(x, y); await sleep(700); out.clicks.push([x, y, await ev(active)]); await send('Input.insertText', { text: dv[i] }); await sleep(300); if (i === 1) await stepShot('typing'); }
  // checkbox coordinates: pt -> px via the 성명/연락처 input lefts (layout cols x0 + textInsetX) and the 성명 input top (rowTop + textInsetY)
  const col = (k) => LAY.cols.find((q) => q.key === k);
  const sx = (g3[1].x - g3[0].x) / (col('연락처').x0 - col('성명').x0);
  const pt2px = (xp, yp) => [Math.round(g3[0].x + (xp - (col('성명').x0 + LAY.textInsetX)) * sx), Math.round(g3[0].y + (yp - (rowTopPt(LAY, row) + LAY.textInsetY)) * sx)];
  const pc = LAY.cols.find((q) => q.type === 'purpose'); const G = LAY.purposeGeo; const t0 = rowTopPt(LAY, row);
  const pos = Object.fromEntries(purposeItems(LAY, pc, t0).map(([lab, x, y]) => [lab, pt2px(x, y)]));
  out.checkboxTouchPx = Math.round(G.touch * sx * 10) / 10; out.checkboxPos = pos; out.scalePxPerPt = Math.round(sx * 1000) / 1000;
  // --poke "1:단순 문의,4:기타": tap checkboxes of OTHER rows (lock test — previous rows hidden, later rows disabled; judge by API values)
  for (const pk of (arg('--poke', '') || '').split(',').filter(Boolean)) {
    const [pr, lab] = pk.split(':'); const it = purposeItems(LAY, pc, rowTopPt(LAY, Number(pr))).find((q) => q[0] === lab);
    const xy = pt2px(it[1], it[2]);
    await click(...xy); await sleep(600); out.clicks.push([...xy, 'poke ' + pk]);
  }
  for (const lab of checks) { await click(...pos[lab]); await sleep(600); out.clicks.push([...pos[lab], 'check ' + lab]); }
  if (checks.length) await stepShot('checked');
} else {
for (let i = 0; i < 3; i++) { const [x, y] = c(g3[i]); await click(x, y); await sleep(700); out.clicks.push([x, y, await ev(active)]); await send('Input.insertText', { text: vals[i] }); await sleep(300); }
}
const btn = (label) => ev(`(()=>{const b=[...document.querySelectorAll('button,a,li,span,div')].filter(x=>x.children.length===0&&x.innerText&&x.innerText.trim()===${JSON.stringify(label)}&&x.getBoundingClientRect().width>0).map(x=>{const q=x.getBoundingClientRect();return [q.left+q.width/2,q.top+q.height/2]});return bs=b.pop()||null})()`.replace('return bs=', 'return '));
// --sign text|draw (default text). 🔴 text mode with no visible 「텍스트」 tab = FAIL rc 1 (a draw-only signature: the old flow pressed
// 「확인」 on an empty pad and went on silently, lane d2c 2026-10-03). --sign draw (lane d2d 2026-10-03): the pad (canvas.signpad) listens to
// touchstart/touchmove/touchend ONLY (DOMDebugger.getEventListeners; no mouse/pointer) -> turn Emulation touch on just for the stroke,
// Input.dispatchTouchEvent touchStart -> 24 touchMove -> touchEnd on the page target (page coords), touch off again; judged by toDataURL change.
const SIGN = arg('--sign', 'text');
const PAD = "(()=>{const docs=[document,...[...document.querySelectorAll('iframe')].map(x=>{try{return x.contentDocument}catch(e){return null}}).filter(Boolean)];for(const d of docs){const c=[...d.querySelectorAll('canvas.signpad')].find(c=>c.getBoundingClientRect().width>0);if(c)return c}return null})()";
const drawSign = async () => {
  const before = await ev(`(()=>{const c=${PAD};return c?c.toDataURL():null})()`);
  const r = await ev(`(()=>{const c=${PAD};if(!c)return null;const q=c.getBoundingClientRect();return [q.left,q.top,q.width,q.height]})()`);
  if (!r) return { ok: false, reason: 'canvas.signpad not visible' };
  const [ox, oy] = globalThis.__OFF ?? [0, 0]; const cx = ox + r[0] + r[2] / 2; const cy = oy + r[1] + r[3] / 2; const wd = Math.min(400, r[2] * 0.6);
  const pts = []; for (let i = 0; i <= 24; i++) { const k = i / 24; pts.push([cx - wd / 2 + wd * k, cy + Math.min(40, r[3] * 0.2) * Math.sin(k * Math.PI * 3) - 10 * k]); }
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  try {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1], id: 1 }] });
    for (const [x, y] of pts.slice(1)) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }); await sleep(25); }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
  await sleep(500);
  const after = await ev(`(()=>{const c=${PAD};return c?c.toDataURL():null})()`);
  return { ok: !!after && after !== before, canvas: r.map(Math.round), bytes: [before?.length ?? 0, after?.length ?? 0] };
};
{ const [x, y] = c(g3[g3.length - 1]); await click(x, y); await sleep(2500);
  let tt = null; let drawn = null;
  if (SIGN === 'draw') { drawn = await drawSign(); if (!drawn.ok) { out.signDialog = { drawn }; console.error('FAIL: --sign draw: pad unchanged (' + (drawn.reason ?? 'toDataURL same') + ')'); console.log(JSON.stringify(out, null, 1)); ws.close(); globalThis.__FWS?.close(); process.exit(1); } }
  else { tt = await btn('텍스트'); if (!tt) { out.signDialog = { text: null }; console.error('FAIL: --sign text: no visible 「텍스트」 tab (draw-only signature?) — rerun with --sign draw'); console.log(JSON.stringify(out, null, 1)); ws.close(); globalThis.__FWS?.close(); process.exit(1); } await clickF(...tt); await sleep(1500); }
  const ok = await btn('확인'); if (ok) { await clickF(...ok); await sleep(2500); } out.signDialog = { mode: SIGN, text: tt, drawn, ok }; await stepShot('signed'); if (has('--shot-steps')) await sleep(1500); }
out.shots.push(await shot(`step${row}-filled`));
out.textFilled = (await text()).slice(0, 200);
// Send judgement (D v6 2026-09-29, #49): rc=0 alone proved nothing — the send could fail silently. The document step is read
// from the API before and after; unchanged step => rc 2 + reason. --no-step-check skips the API read (no EFORMSIGN_* env).
const docStep = async () => { const { client } = await import('./env.mjs'); const g = await (await client()).documents.get(d.documentId, {}); const cs = g.current_status ?? {}; return [cs.status_type, cs.step_index, cs.step_name].join('|'); };
const fail = (reason, hint) => { out.fail = reason; if (hint) out.hint = hint; process.exitCode = 2; console.error('FAIL: ' + reason + (hint ? '\nHINT: ' + hint : '')); };
if (!has('--no-send')) {
  const stepCheck = !has('--no-step-check');
  if (stepCheck) { try { out.stepBefore = await docStep(); } catch (e) { fail('document status not readable before send (set EFORMSIGN_CORE_DIR/EFORMSIGN_ENV_FILE or pass --no-step-check): ' + e.message); console.log(JSON.stringify(out, null, 1)); ws.close(); globalThis.__FWS?.close(); process.exit(2); } }
  const b = await ev(`(()=>{const bs=[...document.querySelectorAll('button,a')].filter(x=>x.innerText.trim()==='전송'&&x.getBoundingClientRect().width>0).map(x=>{const q=x.getBoundingClientRect();return [q.left+q.width/2,q.top+q.height/2]});return bs.pop()||null})()`);
  if (!b) { console.log(JSON.stringify(out, null, 1)); throw new Error('send button not found: ' + out.textFilled); }
  await clickF(b[0], b[1]);
  if (BURST) { const [n, ms] = BURST; for (let i = 0; i < n; i++) { const t0 = Date.now(); out.shots.push(await shot(`send-t${i}`)); await sleep(Math.max(0, ms - (Date.now() - t0))); } }
  else await sleep(4000);
  out.shots.push(await shot(`step${row}-send`));
  const tx = await text(); out.sendDialog = /문서 전송/.test(tx) ? tx.slice(0, 160) : null;
  if (out.sendDialog) { const b2 = await btn('전송'); if (b2) await clickF(...b2); await sleep(8000); }
  else await sleep(5000);
  out.shots.push(await shot(`step${row}-after-send`));
  if (pageErrors.length) out.pageErrors = pageErrors.slice(-8);
  const embCrash = pageErrors.find((x) => /setEmbeddingReceipients|reading 'company_member'/.test(x));
  const crashHint = embCrash ? 'eformsign setEmbeddingReceipients TypeError (' + embCrash.split('\n')[0].slice(0, 120) + ') — 임베딩(래퍼 iframe) 외부 작성자 + 다음 단계 수신자 공란이면 「문서 전송」 창이 안 뜨고 전송이 조용히 실패한다. 상품 경로(api/multirow, 수신자 수=단계 수)에는 생기지 않는다; --fill N 공란 단계 실측이면 수신자를 모두 지정하거나 래퍼 밖 직접 외부 URL 로 구동할 것.' : null;
  if (stepCheck && out.stepBefore) {
    let after = out.stepBefore;
    for (let i = 0; i < 6 && after === out.stepBefore; i++) { try { after = await docStep(); } catch (e) { out.stepReadError = e.message; } if (after === out.stepBefore) await sleep(3000); }
    out.stepAfter = after; out.stepChanged = after !== out.stepBefore;
    if (!out.stepChanged) fail(`document step unchanged after send (${out.stepBefore})` + (out.sendDialog ? '' : ' — sendDialog null (「문서 전송」 창이 뜨지 않음)'), crashHint);
  } else if (!out.sendDialog && crashHint) fail('sendDialog null', crashHint);
}
console.log(JSON.stringify(out, null, 1));
ws.close();
globalThis.__FWS?.close();
