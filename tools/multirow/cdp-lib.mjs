// Shared CDP primitives for the 「실제 화면 편」 tablet capture tools (demo-cdp.mjs, visitor-step.mjs).
// 2026-10-07 lane D4a — extracted from demo-cdp.mjs (lane D4b, 2026-10-06) so the drivers share one implementation.
//
// connect({ port, tab, metrics, vw, vh, scale }) -> { tab, send, evalTop, evalView, viewFrame, shot, click, tap,
//   touch, draw, type, burst, sleep, close, hold }
// 🔴 함정:
//  - Page.captureScreenshot with clip.scale != 1 leaves the Input.* coordinate mapping scaled by 1/scale for EVERY
//    CDP session on the tab (2.5 -> clicks land at x0.4). Before any click/tap the last capture must be shot(f, 1).
//  - metrics:false (= --no-metrics) when another session (hold) already owns Emulation.setDeviceMetricsOverride;
//    the override is released when the session that set it closes.
import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect({ port = '9242', tab: tabPrefix = '', metrics = true, vw = 768, vh = 1389, scale = 2.5, tz, log = console.error } = {}) {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const tab = pages.find((x) => x.type === 'page' && x.id.startsWith(tabPrefix));
  if (!tab) throw Object.assign(new Error('no tab ' + tabPrefix), { code: 'NO_TAB' });

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const frames = new Map();
  const send = (method, params = {}, sessionId, to = 30000) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, to);
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Target.attachedToTarget') frames.set(m.params.sessionId, m.params.targetInfo);
    if (m.method === 'Target.detachedFromTarget') frames.delete(m.params.sessionId);
    // the OOPIF url is only final after its first navigation; keep the stored url current (2026-11-16: stale url hid the viewer frame after the wrapper reloaded it)
    if (m.method === 'Target.targetInfoChanged') { for (const [sid, ti] of frames) if (ti.targetId === m.params.targetInfo.targetId) frames.set(sid, m.params.targetInfo); }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  if (metrics) await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
  if (tz) await send('Emulation.setTimezoneOverride', { timezoneId: tz }).catch((e) => console.log('TZ skip', e.message));
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await sleep(300);

  const evalIn = async (expr, sessionId) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true }, sessionId);
    if (r.exceptionDetails) return 'EXC ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  // the eformsign viewer runs in an OOPIF (m_external_view_service); the form inputs sit in its iframe#viewer_frame
  const viewFrame = () => {
    for (const [sid, ti] of frames) if (/m_external_(user_)?view_service/.test(ti.url) && ti.parentId === tab.id) return sid;
    for (const [sid, ti] of frames) if (/m_external_(user_)?view_service/.test(ti.url) && !/recaptcha/.test(ti.url)) return sid;
    return null;
  };
  const evalTop = (expr) => evalIn(expr);
  const evalView = async (expr) => { const sid = viewFrame(); return sid ? evalIn(expr, sid) : null; };

  const shot = async (file, sc = scale) => {
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: vw, height: vh, scale: sc } }, undefined, 20000);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const b = Buffer.from(r.data, 'base64'); fs.writeFileSync(file, b);
    log('SHOT', file, b.readUInt32BE(16) + 'x' + b.readUInt32BE(20), new Date().toISOString());
    return file;
  };
  const click = async (x, y) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  const touch = async (pts) => {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
      for (const [x, y] of pts.slice(1)) { await sleep(25); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); }
      await sleep(40); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
  };
  const tap = (x, y) => touch([[x, y]]);
  // default stroke = the D4b sine (seed undefined) so demo-cdp --draw output is unchanged;
  // a numeric seed gives a different signature-like stroke per row (visitor-step).
  const draw = (x, y, w, h, seed) => touch(strokePoints(x, y, w, h, seed));
  const type = (text) => send('Input.insertText', { text });
  const burst = async (n, ms, nameOf) => {
    const t0 = Date.now(); const out = [];
    for (let k = 0; k < n; k++) { const due = t0 + k * ms; if (Date.now() < due) await sleep(due - Date.now()); out.push(await shot(nameOf(k))); }
    return out;
  };
  const close = () => ws.close();
  const hold = (sec) => new Promise(() => { setTimeout(() => process.exit(0), sec * 1000); ws.onclose = () => process.exit(0); });
  return { tab, send, evalTop, evalView, viewFrame, frames, shot, click, tap, touch, draw, type, burst, sleep, close, hold, vw, vh };
}

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function strokePoints(x, y, w, h, seed) {
  const pts = [];
  if (seed === undefined || seed === null || Number.isNaN(Number(seed))) {
    for (let k = 0; k <= 24; k++) pts.push([x + w * (0.12 + 0.76 * k / 24), y + h * (0.5 + 0.28 * Math.sin(k / 24 * Math.PI * 3))]);
    return pts;
  }
  const rnd = mulberry32(Number(seed) * 7919 + 17);
  const loops = 2 + Math.floor(rnd() * 3), amp = 0.18 + rnd() * 0.14, ph = rnd() * Math.PI * 2, tilt = (rnd() - 0.5) * 0.2;
  const n = 30;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const yy = 0.5 + tilt * (t - 0.5) + amp * Math.sin(t * Math.PI * loops + ph) + 0.06 * Math.sin(t * Math.PI * 11 + ph * 2);
    pts.push([x + w * (0.1 + 0.8 * t), y + h * Math.min(0.9, Math.max(0.1, yy))]);
  }
  return pts;
}
