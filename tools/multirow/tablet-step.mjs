// Drive ONE participant step of a member-variant multirow document in a tablet viewport (768x1024 portrait,
// Android tablet UA -> eformsign mobile viewer view_iframe_mobile, fit-to-width) on the logged-in capture Chrome.
// Measures the rendered input boxes from the viewer iframe DOM (OZ inputs are real <input> elements) and fills
// the editable row (+ text-tab signature), then sends. Never logs in / switches accounts.
//
// node tablet-step.mjs --doc <.local/.../doc.json> --row N --ev <evidence dir> --tag <name> [--port 9223] [--tab <id prefix>]
//        [--no-send] [--start]   (--start: tap header 「입력 시작」 first and record where the viewer scrolls)
// Output (stdout JSON): own-row input rects (CSS px, viewport), name box height, page/scroll info, send result.
// 2026-09-28 measured: PC UA at 768 wide = view_iframe_pc at 100% (overflows); mobile UA list page bounces to
// m_document_list (no documentUtil) -> get the open URL with PC UA first, then navigate with the tablet UA.
// Signature pad in the mobile viewer ignores CDP mouse drags and Input.dispatchTouchEvent times out -> 「텍스트」 tab.
import fs from 'node:fs';
import path from 'node:path';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const port = arg('--port', '9223'); const row = Number(arg('--row')); const E = arg('--ev'); const tag = arg('--tag', 'x');
const d = JSON.parse(fs.readFileSync(arg('--doc'), 'utf8'));
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
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
let evSend = null; // set in --embed mode: Runtime.evaluate goes to the eformsign OOPIF (m_view_service) target
const ev = async (js) => { const r = await (evSend ?? send)('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)); return r.result.value; };
const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(E, { recursive: true }); const f = path.join(E, `${tag}-${name}.png`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f; };
const text = () => ev("document.body.innerText.split(String.fromCharCode(10)).filter(x=>x.trim()).slice(0,40).join(' | ')");
const out = { row, shots: [] };
const embed = arg('--embed');
if (embed) {
  // --embed <url>: no logged-in session needed (the dead 9223 path). tools/multirow/embed-member.mjs serves an efs_embedded_v2 page
  // with user.type 01 + API member token. 🔴 The tablet UA must be set on the Chrome process (--user-agent=...): a page-level
  // Emulation UA override does not reach the eformsign OOPIF, whose viewer then picks the PC toolbar layout at 100% (measured 2026-09-28).
  await send('Emulation.setUserAgentOverride', { userAgent: TABLET_UA });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: embed }); await sleep(Number(arg('--wait', '25000')));
  const fr = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((x) => x.type === 'iframe' && /m_view_service/.test(x.url) && (!x.parentId || x.parentId === t.id));
  if (!fr.length) throw new Error('embedded m_view_service frame not found');
  const fws = new WebSocket(fr.at(-1).webSocketDebuggerUrl); const fp = new Map(); let fid = 0;
  fws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && fp.has(m.id)) { const p = fp.get(m.id); fp.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  await new Promise((r) => (fws.onopen = r));
  evSend = (method, params = {}) => new Promise((res, rej) => { const i = ++fid; fp.set(i, { res, rej }); fws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (fp.has(i)) { fp.delete(i); rej(new Error('timeout ' + method)); } }, 45000); });
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
await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true });
// touch emulation stays OFF: with it on at load the mobile viewer ignores CDP mouse clicks for the whole page life (measured 2026-09-28);
// the mobile viewer is chosen by UA, so the tablet layout (view_iframe_mobile, fit-to-width) is unchanged.
await send('Page.navigate', { url: 'https://www.eformsign.com' + rel }); await sleep(20000);
}
out.shots.push(await shot(`step${row}-open`));
// measure: inputs inside the viewer iframe, grouped into rows of 4 (성명·연락처·목적 text + 서명 button) in DOM order
const OX0 = () => (globalThis.__OFF ?? [0, 0]);
const measure = `(()=>{const OX=${OX0()[0]},OY=${OX0()[1]};const f=[...document.querySelectorAll('iframe')].find(x=>/view_iframe/.test(x.src));if(!f)return null;const o0=f.getBoundingClientRect();const o={left:o0.left+OX,top:o0.top+OY,x:o0.left+OX,y:o0.top+OY,width:o0.width,height:o0.height,toJSON(){return {x:this.x,y:this.y,width:this.width,height:this.height}}};const dd=f.contentDocument;
const els=[...dd.querySelectorAll('input')].filter(e=>e.type==='text'||e.type==='button').map(e=>{const r=e.getBoundingClientRect();return {t:e.type,x:r.left+o.left,y:r.top+o.top,w:r.width,h:r.height,vis:r.width>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none',dis:e.disabled||e.readOnly}});
const sc=dd.scrollingElement?{top:dd.scrollingElement.scrollTop,h:dd.scrollingElement.scrollHeight}:null;
const scrollers=[...dd.querySelectorAll('div')].filter(x=>x.scrollHeight>x.clientHeight+50&&x.clientHeight>300).map(x=>({top:x.scrollTop,sh:x.scrollHeight,ch:x.clientHeight})).slice(0,3);
return {frame:o.toJSON(),n:els.length,els,sc,scrollers,inner:[innerWidth,innerHeight]}})()`;
const m = await ev(measure);
if (!m) throw new Error('viewer iframe not found');
out.inputCount = m.n; out.frame = m.frame; out.scrollers = m.scrollers;
// Row identity: the OZ <input> elements carry no FORMID -> the own row = the visible, editable (not readonly) inputs;
// sorted left->right they are 성명, 연락처, 방문목적 (text) and 서명 (button).
const pickOwn = (mm) => {
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
out.ownInViewport = own.length ? own[0].y >= m.frame.y && own[0].y + own[0].h <= Math.min(m.frame.y + m.frame.height, 1024 - 70) : null;
// 🔴 measurement above is at mobile:true (the judged tablet render). CDP mouse input is ignored while the metrics
// override says mobile:true (touch path; Input.dispatchTouchEvent times out) -> for interaction flip to mobile:false at the
// same 768x1024. That re-lays the viewer out slightly larger (A: name box 38px -> 46px), so interaction shots are not the judged render.
await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false }); await sleep(2000);
if (has('--start')) {
  const r = await ev(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>x.innerText.trim()==='입력 시작'&&x.getBoundingClientRect().width>0);if(!b)return null;const q=b.getBoundingClientRect();return [q.left+q.width/2,q.top+q.height/2]})()`);
  out.startButton = r;
  if (r) { await click(r[0], r[1]); await sleep(2500); out.shots.push(await shot(`step${row}-after-start`)); const m2 = await ev(measure); const g2 = pickOwn(m2); out.ownAfterStart = g2.map((e) => ({ x: Math.round(e.x), y: Math.round(e.y), h: Math.round(e.h) })); out.ownInViewportAfterStart = g2[0].y >= m2.frame.y && g2[0].y + g2[0].h <= 1024 - 70; out.textAfterStart = (await text()).slice(0, 200);
    // close any input dialog the start button opened (text input dialog / keypad) is not expected in the mobile viewer; continue
  }
}
if (own.length !== 4) { console.log(JSON.stringify(out, null, 1)); ws.close(); process.exit(1); }
if (!out.ownInViewport && !has('--start')) {
  // scroll the own row into view by clicking needs it on screen -> use element.scrollIntoView inside the viewer iframe
  await ev(`(()=>{const f=[...document.querySelectorAll('iframe')].find(x=>/view_iframe/.test(x.src));const e=[...f.contentDocument.querySelectorAll('input')].find(e=>e.type==='text'&&!e.readOnly&&e.getBoundingClientRect().width>0);e.scrollIntoView({block:'center'});return 1})()`);
  await sleep(1500); out.scrolledIntoView = true;
}
const m3 = await ev(measure); const g3 = pickOwn(m3);
const c = (e) => [Math.round(e.x + e.w / 2), Math.round(e.y + e.h / 2)];
const vals = [`방문자${row}`, `010-${String(1000 + row).slice(-4)}-${String(5000 + row).slice(-4)}`, ['회의', '납품', '면접', '견학'][row % 4]];
const active = `(()=>{const f=[...document.querySelectorAll('iframe')].find(x=>/view_iframe/.test(x.src));const a=f.contentDocument.activeElement;return (a&&a.tagName)+' '+(a&&a.id)+' ro='+(a&&a.readOnly)})()`;
out.clicks = [];
for (let i = 0; i < 3; i++) { const [x, y] = c(g3[i]); await click(x, y); await sleep(700); out.clicks.push([x, y, await ev(active)]); await send('Input.insertText', { text: vals[i] }); await sleep(300); }
const btn = (label) => ev(`(()=>{const b=[...document.querySelectorAll('button,a,li,span,div')].filter(x=>x.children.length===0&&x.innerText&&x.innerText.trim()===${JSON.stringify(label)}&&x.getBoundingClientRect().width>0).map(x=>{const q=x.getBoundingClientRect();return [q.left+q.width/2,q.top+q.height/2]});return bs=b.pop()||null})()`.replace('return bs=', 'return '));
{ const [x, y] = c(g3[3]); await click(x, y); await sleep(2500); const tt = await btn('텍스트'); if (tt) { await click(...tt); await sleep(1500); } const ok = await btn('확인'); if (ok) { await click(...ok); await sleep(2500); } out.signDialog = { text: tt, ok }; }
out.shots.push(await shot(`step${row}-filled`));
out.textFilled = (await text()).slice(0, 200);
if (!has('--no-send')) {
  const b = await ev(`(()=>{const bs=[...document.querySelectorAll('button,a')].filter(x=>x.innerText.trim()==='전송'&&x.getBoundingClientRect().width>0).map(x=>{const q=x.getBoundingClientRect();return [q.left+q.width/2,q.top+q.height/2]});return bs.pop()||null})()`);
  if (!b) { console.log(JSON.stringify(out, null, 1)); throw new Error('send button not found: ' + out.textFilled); }
  await click(b[0], b[1]); await sleep(4000);
  out.shots.push(await shot(`step${row}-send`));
  const tx = await text(); out.sendDialog = /문서 전송/.test(tx) ? tx.slice(0, 160) : null;
  if (out.sendDialog) { const b2 = await btn('전송'); if (b2) await click(...b2); await sleep(8000); }
  else await sleep(5000);
  out.shots.push(await shot(`step${row}-after-send`));
}
console.log(JSON.stringify(out, null, 1));
ws.close();
globalThis.__FWS?.close();
