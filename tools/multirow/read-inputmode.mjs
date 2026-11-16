// Read the real <input> elements the eformsign viewer creates (type / inputmode / rect), to check what on-screen keyboard a text box asks for.
// node tools/multirow/read-inputmode.mjs --port 9265 --tab <id prefix> [--click x,y] [--wait 700] [--out <json>]
//   --click x,y : one left click at top-frame CSS px first (e.g. the 연락처 cell of the own row), then read.
// The writer iframe (m_external_view_service / external_user_view_service) is a cross-origin CDP target: attach with
//   Target.attachToTarget({flatten:true}) and Runtime.evaluate inside it (same approach as tools/form-coords.mjs detectConsentGate).
// Walks the iframe's document and every same-origin child iframe. Prints, per input/textarea: type, inputmode, maxlength, rect,
//   whether it is the active element. A phone keypad request shows as inputmode="tel" (KEYBOARDTYPE 5); numeric as "decimal" (2).
// Read-only except the optional --click. Never ticks the consent box.
import fs from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const port = arg('--port', '9265'); const tabPrefix = arg('--tab'); const clickArg = arg('--click'); const waitMs = Number(arg('--wait', '700'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!tabPrefix) { console.error('--tab <id prefix> required'); process.exit(2); }
const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 30000); });
const { targetInfos } = await send('Target.getTargets');
if (clickArg) {
  const top = targetInfos.find((t) => t.type === 'page' && t.targetId.startsWith(tabPrefix));
  if (!top) throw new Error('tab not found');
  const { sessionId } = await send('Target.attachToTarget', { targetId: top.targetId, flatten: true });
  const [x, y] = clickArg.split(',').map(Number);
  await send('Target.activateTarget', { targetId: top.targetId });
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId);
  await send('Target.detachFromTarget', { sessionId });
  await sleep(waitMs);
}
const frames = targetInfos.filter((t) => t.type === 'iframe' && /eformsign\.com\/eform\/document\/(m_)?external_(user_)?view_service/i.test(t.url || ''));
if (!frames.length) { console.error('writer iframe target not found'); process.exit(3); }
const EXPR = `(function(){
  var out=[]; var walk=function(doc,path){
    var act=doc.activeElement;
    Array.prototype.forEach.call(doc.querySelectorAll('input,textarea'),function(el){
      var r=el.getBoundingClientRect();
      out.push({frame:path,tag:el.tagName,type:el.getAttribute('type'),inputmode:el.getAttribute('inputmode'),maxlength:el.getAttribute('maxlength'),
        id:el.id||null,cls:(el.className&&el.className.baseVal===undefined?String(el.className):'').slice(0,60),
        rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],active:el===act,hidden:!(el.offsetParent||el.getClientRects().length)});
    });
    Array.prototype.forEach.call(doc.querySelectorAll('iframe'),function(f,i){ try{ if(f.contentDocument) walk(f.contentDocument,path+'>iframe'+i); }catch(e){ out.push({frame:path+'>iframe'+i,error:'cross-origin'}); } });
  }; walk(document,'root'); return JSON.stringify(out);
})()`;
const result = [];
for (const f of frames) {
  const { sessionId } = await send('Target.attachToTarget', { targetId: f.targetId, flatten: true });
  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true }, sessionId);
  try { await send('Target.detachFromTarget', { sessionId }); } catch {}
  if (r.exceptionDetails) { result.push({ target: f.targetId.slice(0, 8), error: r.exceptionDetails.exception?.description }); continue; }
  result.push({ target: f.targetId.slice(0, 8), inputs: JSON.parse(r.result.value) });
}
const txt = JSON.stringify(result, null, 1);
if (arg('--out')) fs.writeFileSync(arg('--out'), txt);
const all = result.flatMap((x) => x.inputs ?? []);
console.log(txt);
console.log(`SUMMARY inputs=${all.length} tel=${all.filter((i) => i.inputmode === 'tel').length} decimal=${all.filter((i) => i.inputmode === 'decimal').length} active=${JSON.stringify(all.filter((i) => i.active).map((i) => ({ type: i.type, inputmode: i.inputmode })))}`);
ws.close();
