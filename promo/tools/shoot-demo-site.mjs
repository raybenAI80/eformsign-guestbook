#!/usr/bin/env node
/**
 * shoot-demo-site.mjs — 「실제 화면 편」 테스트 사이트(비로그인 방문자 시점) 캡처. 레인 D2(2026-10-03).
 *
 * 내 전용 헤드리스 Chrome 을 띄워(포트 --port, 기본 9241 · 프로필 = OS 임시폴더) 대상 URL 을 열고
 * 두 규격으로 찍는다. 🔴 9223 캡처 Chrome(로그인 세션)은 건드리지 않는다. 종료는 내가 띄운 PID 만.
 *   promo : CSS 1280x1800, clip scale 1.5 -> 1920x2700 (홍보편 B·C·fill-seq 와 동일 = 바탕·손 층 재사용)
 *   tablet: CSS 768x1024, 태블릿 UA(프로세스 --user-agent; 페이지 단 override 는 이폼사인 OOPIF 에 안 닿음),
 *           clip scale 2.5 -> 1920x2560 (가로 1920 을 promo 와 맞춤)
 * 🔴 동의서 체크(약관 동의 행위)는 하지 않는다 — 첫 화면이 동의 게이트면 거기서 찍고 끝낸다(STOP 출력).
 *    동의 클릭은 오케스트레이터가 tools/multirow/consent-click.mjs 로 직접 하고, 이후 단계는
 *    tools/multirow/tablet-step.mjs --attach --tab <id> --no-send 로 이어간다(--keep 로 Chrome 을 남겨 둔다).
 *
 * node tools/shoot-demo-site.mjs [--url https://eformsign-guestbook-test.vercel.app/] [--out public/shots/demo]
 *        [--profile promo|tablet|both] [--wait 20000] [--port 9241] [--keep]
 * 출력: <out>/<profile>/S01-first-screen.png + .json(iframe 위치·본문 텍스트·동의 게이트 판정), 표준출력 요약 JSON.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes('--' + n);
const URL_ = opt('url', 'https://eformsign-guestbook-test.vercel.app/');
const OUT = path.resolve(opt('out', 'public/shots/demo'));
const WAIT = Number(opt('wait', 20000));
const BASE_PORT = Number(opt('port', 9241));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TABLET_UA = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const PROFILES = {
  promo: { w: 1280, h: 1800, scale: 1.5, ua: null, mobile: false },
  tablet: { w: 768, h: 1024, scale: 2.5, ua: TABLET_UA, mobile: true },
};
const which = opt('profile', 'both');
const names = which === 'both' ? ['promo', 'tablet'] : [which];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const wait = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { const p = wait.get(m.id); wait.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}, t = 45000) => new Promise((res, rej) => { const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (wait.delete(i)) rej(new Error(method + ' timeout')); }, t); });
  return { ws, send };
}

const summary = [];
for (const [k, name] of names.entries()) {
  const P = PROFILES[name]; const port = BASE_PORT + k;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), `demo-shot-${name}-`));
  const flags = [`--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    `--window-size=${P.w},${P.h}`, '--hide-scrollbars', '--lang=ko-KR'];
  if (P.ua) flags.push(`--user-agent=${P.ua}`);
  // --keep: detached + unref — 비분리 자식은 node 이벤트 루프를 붙잡아(종료 안 함 → 백그라운드 출력 0) Windows job 으로 부모와 함께 죽는다.
  const proc = spawn(CHROME, [...flags, 'about:blank'], { stdio: 'ignore', detached: has('keep') });
  if (has('keep')) proc.unref();
  let ver = null; for (let i = 0; i < 40 && !ver; i++) { await sleep(250); try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch {} }
  if (!ver) throw new Error('chrome did not start on ' + port);
  const tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl);
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: P.w, height: P.h, deviceScaleFactor: 1, mobile: P.mobile });
  if (P.ua) await send('Emulation.setUserAgentOverride', { userAgent: P.ua });
  await send('Page.navigate', { url: URL_ }); await sleep(WAIT);
  const ev = async (js) => (await send('Runtime.evaluate', { expression: js, returnByValue: true })).result.value;
  const top = await ev(`(()=>{const f=[...document.querySelectorAll('iframe')].map(x=>{const r=x.getBoundingClientRect();return {id:x.id,src:(x.src||'').replace(/[?#].*$/,''),rect:[r.left,r.top,r.width,r.height]}});return {title:document.title,text:document.body.innerText.slice(0,400),iframes:f}})()`);
  // eformsign OOPIF text (consent gate detection) — read only, no clicks
  const frames = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'iframe');
  let frameText = '';
  for (const f of frames) {
    try { const c = await cdp(f.webSocketDebuggerUrl); await c.send('Runtime.enable'); const r = await c.send('Runtime.evaluate', { expression: 'document.body.innerText.slice(0,600)', returnByValue: true }); frameText += `[${f.url.replace(/[?#].*$/, '')}] ` + (r.result.value || '') + '\n'; c.ws.close(); } catch (e) { frameText += `[${f.url.replace(/[?#].*$/, '')}] (read fail ${e.message})\n`; }
  }
  const consentGate = /동의서|동의합니다|전자서명 사용 동의/.test(frameText + top.text);
  const dir = path.join(OUT, name); fs.mkdirSync(dir, { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: P.w, height: P.h, scale: P.scale }, captureBeyondViewport: false });
  const file = path.join(dir, 'S01-first-screen.png'); fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  const meta = { step: 'S01-first-screen', profile: name, css: [P.w, P.h], scale: P.scale, px: [P.w * P.scale, P.h * P.scale], ua: P.ua ? 'tablet' : 'desktop-headless', url: URL_, shotAt: new Date().toISOString(), consentGate, top, frameText, port, pid: proc.pid, tabId: tab.id };
  fs.writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(meta, null, 1));
  summary.push({ name, file, consentGate, iframes: top.iframes, pid: proc.pid, port, tabId: tab.id });
  if (has('keep')) console.log(`KEEP ${name} port=${port} tab=${tab.id} pid=${proc.pid}`); // 탭 정보 먼저 출력
  ws.close();
  if (!has('keep')) { try { process.kill(proc.pid); } catch {} }
}
console.log(JSON.stringify(summary, null, 1));
if (summary.some((s) => s.consentGate)) console.error('STOP: 동의서 게이트 화면 — 동의 클릭은 오케스트레이터가 직접(consent-click.mjs). 이후 tablet-step.mjs --attach.');
process.exit(0); // --keep 이어도 node 는 끝낸다(Chrome 은 detached 로 남음)
