// node cdp.mjs --port 9223 --match <urlSubstr> [--nav <url>] [--wait ms] [--js <file>] [--expr <code>] [--shot <path>] [--new <url>]
import fs from 'node:fs';
const arg = (n, d) => { const i = process.argv.indexOf('--'+n); return i > -1 ? process.argv[i+1] : d; };
const has = n => process.argv.includes('--'+n);
const port = arg('port', '9223');
const match = arg('match', '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (arg('new')) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(arg('new'))}`, { method: 'PUT' });
  console.log(JSON.stringify(await r.json())); process.exit(0);
}
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const t = targets.find(x => x.type === 'page' && (x.url || '').includes(match));
if (!t) { console.error('no target', match, targets.filter(x=>x.type==='page').map(x=>x.url)); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (method, params) => new Promise((res, rej) => { const i = ++id; pend.set(i, {res, rej}); ws.send(JSON.stringify({id:i, method, params})); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise(r => ws.onopen = r);
try {
  if (arg('size')) {
    const [w, h] = arg('size').split('x').map(Number);
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  }
  if (arg('nav')) { await send('Page.enable', {}); await send('Page.navigate', { url: arg('nav') }); }
  if (arg('wait')) await sleep(Number(arg('wait')));
  const expr = arg('js') ? fs.readFileSync(arg('js'), 'utf8') : arg('expr');
  if (expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true });
    if (r.exceptionDetails) { console.error('EXCEPTION', r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); process.exitCode = 1; }
    else { const v = r.result.value; console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1)); }
  }
  for (const a of process.argv.filter((x, i) => process.argv[i-1] === '--click')) {
    const [x, y] = a.split(',').map(Number);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    console.log('CLICK ' + x + ',' + y);
    await sleep(Number(arg('clickwait', '900')));
  }
  if (arg('type')) {
    for (const ch of arg('type')) await send('Input.insertText', { text: ch });
    console.log('TYPE ' + arg('type'));
  }
  if (arg('wait2')) await sleep(Number(arg('wait2')));
  if (arg('shot')) {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(arg('shot').replace(/[\/][^\/]*$/, ''), { recursive: true });
    fs.writeFileSync(arg('shot'), Buffer.from(r.data, 'base64'));
    console.log('SHOT ' + arg('shot'));
  }
} finally { ws.close(); }
