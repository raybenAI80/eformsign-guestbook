// CDP eval helper: node cdp-eval.mjs <port> <targetUrlSubstr> <jsFile>
import fs from 'node:fs';
const port = process.argv[2] || '9223';
const match = process.argv[3] || '';
const jsFile = process.argv[4];
const expr = jsFile ? fs.readFileSync(jsFile, 'utf8') : process.argv[5];

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const t = targets.find(x => x.type === 'page' && (x.url || '').includes(match));
if (!t) { console.error('no target for', match, targets.map(x=>x.url)); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const send = (method, params) => new Promise((res, rej) => { const i = ++id; pend.set(i, {res, rej}); ws.send(JSON.stringify({id:i, method, params})); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise(r => ws.onopen = r);
try {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true });
  if (r.exceptionDetails) { console.error('EXCEPTION', JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails)); process.exit(1); }
  const v = r.result.value;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
} finally { ws.close(); }
