// Measure how long the kiosk wrapper takes to show the consent screen (read-only, no clicks).
// node tools/perf/measure-open.mjs --site-a <url> [--site-b <url>] --out <result.json> [--only A|B]
// Schedule: round1 = cold + warm x2 on one profile, round2/3 = cold on new profiles; A and B alternate.
// Headless Chrome, tablet UA, 768x1024, CDP over WebSocket (Node 22 global WebSocket).
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import { acquireProfile } from 'file:///C:/Users/FORCS/.agent-harness/tools/chrome-profile-pool/pool.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const argv = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
const SITES = { A: argv('site-a'), B: argv('site-b') };   // full URLs, e.g. https://<host>/?idle=0&abandon=3600 (idle/abandon off so the wrapper never resets mid-measure)
if (!SITES.A && !SITES.B) { console.error('usage: node tools/perf/measure-open.mjs --site-a <url> [--site-b <url>] --out <result.json> [--only A|B] [--quick] [--shots <dir>]'); process.exit(2); }
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const sleep =(ms) => new Promise((r) => setTimeout(r, ms));
let portSeq = 9380;

async function launch(profile) {
  const port = portSeq++;
  const p = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--remote-allow-origins=*',
    `--user-data-dir=${profile}`, '--window-size=768,1024', `--user-agent=${UA}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); return { pid: p.pid, port, ws: j.webSocketDebuggerUrl }; } catch { await sleep(250); }
  }
  throw new Error('chrome did not open port ' + port);
}
const killPid = (pid) => { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch { /* already gone */ } };

class Cdp {
  constructor(wsUrl) { this.id = 0; this.cb = new Map(); this.handlers = []; this.ws = new WebSocket(wsUrl); }
  open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; this.ws.onmessage = (e) => this.onMsg(JSON.parse(e.data)); }); }
  onMsg(m) {
    if (m.id && this.cb.has(m.id)) { const { res, rej } = this.cb.get(m.id); this.cb.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else this.handlers.forEach((h) => h(m));
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.cb.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => { if (this.cb.has(id)) { this.cb.delete(id); rej(new Error('timeout ' + method)); } }, 20000);
    });
  }
}

// In-page recorder: wall-clock time when #terms_agree exists (__cp) and is visible (__ct); main-thread long tasks (__lt).
const INJECT = `(()=>{if(window.__pi)return;window.__pi=1;window.__lt=[];
try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push([Math.round(performance.timeOrigin+e.startTime),Math.round(e.duration)])}).observe({entryTypes:['longtask']})}catch(e){}
const chk=(d)=>{const t=d&&d.querySelector&&d.querySelector('#terms_agree');if(!t)return 0;const r=t.getBoundingClientRect();const cs=getComputedStyle(t);return(r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none')?2:1};
const tick=()=>{let v=chk(document);if(v<2){try{const vf=document.getElementById('viewer_frame');if(vf&&vf.contentDocument)v=Math.max(v,chk(vf.contentDocument))}catch(e){}}
if(v>=1&&!window.__cp){window.__cp=Date.now();try{parent.__cp=parent.__cp||window.__cp}catch(e){}}
if(v===2){window.__ct=Date.now();try{parent.__ct=parent.__ct||window.__ct}catch(e){}return}setTimeout(tick,30)};setTimeout(tick,30)})()`;
const CONSENT_JS_OLD =`(()=>{const chk=(d)=>{const t=d.querySelector('#terms_agree');if(!t)return null;const r=t.getBoundingClientRect();const cs=getComputedStyle(t);return {w:r.width,h:r.height,vis:cs.visibility,disp:cs.display}};
let r=chk(document);if(r)return r;const vf=document.getElementById('viewer_frame');try{if(vf&&vf.contentDocument)return chk(vf.contentDocument)}catch(e){}return null})()`;

async function measure(cdp, top, url, tag) {
  const sessions = new Map([[top, { type: 'page' }]]);
  const reqs = new Map();
  let off = null; let dcl = null; let load = null; let consentAt = null; let presentAt = null;
  const h = async (m) => {
    if (m.method === 'Target.attachedToTarget') {
      const s = m.params.sessionId; sessions.set(s, { type: m.params.targetInfo.type });
      try {
        await cdp.send('Network.enable', { maxTotalBufferSize: 1e7 }, s);
        await cdp.send('Page.enable', {}, s);
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT }, s);
        await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s);
      } catch (e) { if (process.argv.includes('--debug')) console.error('attach err', e.message); }
      try { await cdp.send('Runtime.runIfWaitingForDebugger', {}, s); } catch { /* not waiting */ }
      return;
    }
    const s = m.sessionId; if (!s) return;
    const P = m.params || {};
    if (m.method === 'Network.requestWillBeSent') {
      if (off === null && P.wallTime) off = P.wallTime - P.timestamp;
      const k = s + ':' + P.requestId;
      if (!reqs.has(k)) reqs.set(k, { s, url: P.request.url, type: P.type, tStart: P.timestamp });
    } else if (m.method === 'Network.responseReceived') {
      const r = reqs.get(s + ':' + P.requestId); if (!r) return;
      const rs = P.response; r.status = rs.status; r.tResp = P.timestamp; r.timing = rs.timing || null; r.fromCache = !!rs.fromDiskCache;
      const hd = {}; for (const k of Object.keys(rs.headers || {})) hd[k.toLowerCase()] = rs.headers[k];
      r.hdr = { 'x-vercel-id': hd['x-vercel-id'], 'x-vercel-cache': hd['x-vercel-cache'], 'cache-control': hd['cache-control'], 'content-encoding': hd['content-encoding'], 'content-length': hd['content-length'] };
    } else if (m.method === 'Network.loadingFinished') {
      const r = reqs.get(s + ':' + P.requestId); if (!r) return; r.tEnd = P.timestamp; r.bytes = P.encodedDataLength;
    } else if (m.method === 'Network.loadingFailed') {
      const r = reqs.get(s + ':' + P.requestId); if (!r) return; r.tEnd = P.timestamp; r.failed = P.errorText;
    } else if (m.method === 'Page.domContentEventFired' && s === top) dcl = P.timestamp;
    else if (m.method === 'Page.loadEventFired' && s === top) load = P.timestamp;
  };
  cdp.handlers.push(h);
  await cdp.send('Page.enable', {}, top);
  await cdp.send('Network.enable', { maxTotalBufferSize: 1e7 }, top);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT }, top);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false }, top);
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, top);
  const t0 = Date.now();
  await cdp.send('Page.navigate', { url }, top);
  const deadline = Date.now() + 60000;
  let shotAt = 2000;
  while (Date.now() < deadline && !consentAt) {
    for (const s of [...sessions.keys()]) {
      try {
        const r = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify([window.__ct||0,window.__cp||0])', returnByValue: true }, s);
        const [ct, cp] = JSON.parse(r.result.value);
        if (cp && (presentAt === null || cp < presentAt)) presentAt = cp;
        if (ct && (consentAt === null || ct < consentAt)) consentAt = ct;
        if (consentAt) break;
      } catch { /* session not ready */ }
    }
    if (SHOTS && !consentAt && Date.now() - t0 > shotAt) {
      shotAt += 3000;
      try {
        const img = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 40 }, top);
        fs.writeFileSync(`${SHOTS}/${tag}-${Math.round((Date.now() - t0) / 1000)}s.jpg`, Buffer.from(img.data, 'base64'));
        const lg = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify((window.__kioskLog||[]).slice(-12))', returnByValue: true }, top);
        console.error(tag, Math.round((Date.now() - t0) / 1000) + 's log', String(lg.result.value).slice(0, 700));
      } catch (e) { console.error('shot fail', e.message); }
    }
    if (!consentAt) await sleep(250);
  }
  await sleep(1500);
  const lt = [];
  for (const [s, info] of sessions) {
    try {
      const r = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify([location.href.slice(0,70),window.__lt||[]])', returnByValue: true }, s);
      const [href, arr] = JSON.parse(r.result.value);
      const end = consentAt || Infinity;
      const inRange = arr.filter(([st]) => st >= t0 && st <= end);
      lt.push({ type: info.type, href, count: inRange.length, totalMs: inRange.reduce((a, b) => a + b[1], 0), maxMs: Math.max(0, ...inRange.map((x) => x[1])) });
    } catch { /* session gone */ }
  }
  cdp.handlers.splice(cdp.handlers.indexOf(h), 1);
  const rel = (ts) => (ts == null || off === null ? null : Math.round((ts + off) * 1000 - t0));
  const out = [...reqs.values()].map((r) => ({
    url: r.url.length > 220 ? r.url.slice(0, 220) + '...' : r.url, type: r.type, status: r.status, session: sessions.get(r.s)?.type,
    start: rel(r.tStart), respStart: rel(r.tResp), end: rel(r.tEnd), bytes: r.bytes ?? 0, fromCache: r.fromCache, failed: r.failed, hdr: r.hdr,
    timing: r.timing ? { dns: r.timing.dnsEnd - r.timing.dnsStart, connect: r.timing.connectEnd - r.timing.connectStart, ssl: r.timing.sslEnd - r.timing.sslStart, send: r.timing.sendEnd - r.timing.sendStart, wait: r.timing.receiveHeadersStart - r.timing.sendEnd } : null,
  }));
  return { tag, url, consentMs: consentAt ? consentAt - t0 : null, presentMs: presentAt ? presentAt - t0 : null, dclMs: rel(dcl), loadMs: rel(load), longTasks: lt, requests: out };
}

async function siteRuns(site, profile, plan) {
  const res = [];
  const L = await launch(profile);
  const cdp = new Cdp(L.ws); await cdp.open();
  try {
    for (const tag of plan) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId: top } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const r = await measure(cdp, top, SITES[site], tag);
      r.site = site; res.push(r);
      console.error(site, tag, 'consent', r.consentMs, 'ms  req', r.requests.length, 'bytes', r.requests.reduce((a, b) => a + b.bytes, 0));
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
      await sleep(500);
    }
  } finally { killPid(L.pid); await sleep(800); }
  return res;
}

const outArg = process.argv.indexOf('--out'); const outFile = outArg > 0 ? process.argv[outArg + 1] : null;
const only = process.argv.indexOf('--only'); const onlySite = only > 0 ? process.argv[only + 1] : null;
const all = [];
const rounds = process.argv.includes('--quick') ? [['cold1']] : [['cold1', 'warm1', 'warm2'], ['cold2'], ['cold3']];
for (let i = 0; i < rounds.length; i++) {
  for (const site of ['A', 'B']) {
    if ((onlySite && onlySite !== site) || !SITES[site]) continue;
    const prof = acquireProfile('perf-open'); // pooled profile, page state cleared on acquire = cold cache
    try { all.push(...(await siteRuns(site, prof.dir, rounds[i]))); } finally { prof.release(); }
    if (outFile) fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
  }
}
