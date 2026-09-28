// Minimal CDP driver for the logged-in capture Chrome (never logs in / switches accounts).
// node drive.mjs --port 9223 (--match <urlSubstr> | --new) --steps <steps.json>
// steps: [{nav:url}|{wait:ms}|{evalFile:path,out?}|{shot:path}|{click:[x,y]}|{type:text}|{key:"Tab"}|{eval:js,out?:path}|{net:{dir,filter}}|{size:[w,h]}]
// {net} enables Network capture from that point on; response bodies whose URL matches filter are saved into dir.
import fs from 'node:fs';
import path from 'node:path';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const port = arg('--port', '9223');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t;
if (process.argv.includes('--new')) t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
else t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page' && (arg('--id') ? x.id.startsWith(arg('--id')) : x.url.includes(arg('--match', '#none#'))));
if (!t) { console.error('no target'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const reqs = new Map(); let net = null; const saved = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 45000); });
ws.onmessage = async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
  if (m.method === 'Page.javascriptDialogOpening') { console.log('DIALOG', m.params.type, (m.params.message || '').slice(0, 80)); ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } })); return; }
  if (!net) return;
  if (m.method === 'Network.responseReceived') reqs.set(m.params.requestId, m.params.response.url);
  if (m.method === 'Network.loadingFinished') {
    const url = reqs.get(m.params.requestId) ?? '';
    if (!new RegExp(net.filter).test(url)) return;
    try {
      const b = await send('Network.getResponseBody', { requestId: m.params.requestId });
      const f = path.join(net.dir, String(saved.length).padStart(3, '0') + '.body');
      fs.writeFileSync(f, b.base64Encoded ? Buffer.from(b.body, 'base64') : b.body);
      saved.push({ f, url: url.slice(0, 200) });
    } catch {}
  }
};
await new Promise((r) => (ws.onopen = r));
// a pending beforeunload/alert dialog blocks Page.enable -> dismiss it first (fire-and-forget)
ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
await sleep(500);
await send('Page.enable');
const steps = JSON.parse(fs.readFileSync(arg('--steps'), 'utf8'));
const mouse = async (x, y) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};
for (const s of steps) {
  if (s.size) await send('Emulation.setDeviceMetricsOverride', { width: s.size[0], height: s.size[1], deviceScaleFactor: 1, mobile: false });
  if (s.net) { fs.mkdirSync(s.net.dir, { recursive: true }); net = s.net; await send('Network.enable', { maxResourceBufferSize: 50e6, maxTotalBufferSize: 200e6 }); }
  if (s.nav) await send('Page.navigate', { url: s.nav });
  if (s.wait) await sleep(s.wait);
  if (s.click) await mouse(s.click[0], s.click[1]);
  if (s.type) await send('Input.insertText', { text: s.type });
  if (s.key) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: s.key, code: s.key, windowsVirtualKeyCode: s.key === 'Tab' ? 9 : 13 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: s.key, code: s.key }); }
  if (s.evalFile) s.eval = fs.readFileSync(s.evalFile, 'utf8');
  if (s.eval) {
    const r = await send('Runtime.evaluate', { expression: s.eval, awaitPromise: true, returnByValue: true });
    const v = r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails) : r.result.value;
    if (s.out) fs.writeFileSync(s.out, typeof v === 'string' ? v : JSON.stringify(v, null, 1)); else console.log('EVAL', typeof v === 'string' ? v.slice(0, 3000) : JSON.stringify(v).slice(0, 3000));
  }
  if (s.shot) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(path.dirname(s.shot), { recursive: true }); fs.writeFileSync(s.shot, Buffer.from(r.data, 'base64')); console.log('SHOT', s.shot); }
}
if (net) { fs.writeFileSync(path.join(net.dir, 'index.json'), JSON.stringify(saved, null, 1)); console.log('NET saved', saved.length); }
console.log('TARGET', t.id.slice(0, 8));
ws.close();
