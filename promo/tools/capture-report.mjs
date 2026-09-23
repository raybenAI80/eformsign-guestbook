#!/usr/bin/env node
/* ==========================================================================
   capture-report.mjs — 상품 리포트 화면(report.html) 홍보영상용 캡처 (E 장면)

   왜 있나
     리포트 화면은 암호 칸을 통과해야 내용이 보인다. 그 암호(`REPORT_SECRET`)를
     사람이나 에이전트가 **보지 않은 채로** 넣어야 해서, 설정 파일을 이 프로세스가
     읽어 CDP 로 바로 입력 칸에 넣는다. 값은 화면 밖으로도 로그로도 나가지 않는다.

   먼저 띄워 둘 것 (상품 저장소에서)
     node tools/report-preview.mjs --env .local/report.env --port 5179

   사용
     node tools/capture-report.mjs --env <설정파일> [--url http://127.0.0.1:5179/]
                                   [--out public/shots/E] [--port 9333]

   🔴 9223 캡처 Chrome 을 건드리지 않는다 — 자기 전용 프로필로 새 헤드리스를 띄우고
      끝나면 자기 PID 만 종료한다.
   ========================================================================== */
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const ENV_FILE = arg('env', '');
const URL_ = arg('url', 'http://127.0.0.1:5179/');
const OUT = resolve(arg('out', 'public/shots/E'));
const PORT = Number(arg('port', 9333));
const CHROME = arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');

/** 설정 파일 → 값. 🔴 어디에도 출력하지 않는다. */
function readEnv(file) {
  const out = {};
  for (const line of readFileSync(resolve(file), 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v.length > 1 && v.startsWith('<') && v.endsWith('>')) v = v.slice(1, -1).trim();
    out[m[1]] = v;
  }
  return out;
}
if (!ENV_FILE) { console.error('--env <설정파일> 이 필요합니다.'); process.exit(2); }
const ENV = readEnv(ENV_FILE);
if (!ENV.REPORT_SECRET) { console.error('설정 파일에 REPORT_SECRET 이 없습니다.'); process.exit(2); }

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new Cdp(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) {
        const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waiting.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.waiting.has(id)) { this.waiting.delete(id); rej(new Error(`timeout ${method}`)); } }, 30000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = join(tmpdir(), `capture-report-profile-${process.pid}`);
mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--force-device-scale-factor=2', '--hide-scrollbars',
  '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' });
console.log(`헤드리스 Chrome 기동 pid=${chrome.pid} port=${PORT}`);

function cleanup() {
  try { chrome.kill('SIGTERM'); } catch { /* noop */ }
  try { if (existsSync(profile)) rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
process.on('exit', cleanup);

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const pages = (await r.json()).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pages.length) return pages[0];
    } catch { /* 아직 안 떴다 */ }
    await sleep(300);
  }
  throw new Error('CDP 준비 실패');
}

async function shot(cdp, file, clip) {
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const c = clip || { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 };
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: c, captureBeyondViewport: true, fromSurface: true });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log(`  저장 ${file}`);
}

const LEAK = [
  ['이메일', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ['company_id 꼴', /company[_-]?id["' :=]/gi],
  ['template/form id 꼴', /(template|form)[_-]?id["' :=]/gi],
  ['32자+ 16진/영숫자 토큰', /\b[A-Fa-f0-9]{32,}\b/g],
];

const t = await target();
const cdp = await Cdp.open(t.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false,
});
await cdp.send('Page.navigate', { url: URL_ });
await sleep(2500);

// 1) 암호 화면 — 카드 아래 빈 여백은 잘라낸다(영상에서 바로 쓰게)
const gateBox = await cdp.eval(`(function(){var b=document.getElementById('gate').getBoundingClientRect();` +
  `return {bottom:b.bottom+window.scrollY};})()`);
await shot(cdp, join(OUT, 'E01-report-gate.png'),
  { x: 0, y: 0, width: 1440, height: Math.ceil(gateBox.bottom + 40), scale: 1 });

// 2) 암호 투입 — 🔴 값은 이 프로세스 안에서만 흐른다
await cdp.send('Runtime.evaluate', {
  expression: `(function(v){var el=document.getElementById('secret');el.value=v;` +
    `el.dispatchEvent(new Event('input',{bubbles:true}));` +
    `document.getElementById('btnOpen').click();return true;})(${JSON.stringify(ENV.REPORT_SECRET)})`,
  returnByValue: true,
});

let ready = false;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const st = await cdp.eval(`(function(){var r=document.getElementById('result');var n=document.getElementById('notice');` +
    `return {result:!r.hidden, notice:!n.hidden, noticeTitle:(document.getElementById('noticeTitle')||{}).textContent||''};})()`);
  if (st.result) { ready = true; break; }
  // 「읽고 있습니다」는 진행 중 표시라서 실패로 보지 않는다.
  if (st.notice && !/읽고 있|불러오|잠시/.test(st.noticeTitle)) {
    console.error(`화면이 안내 상태로 멈췄습니다: ${st.noticeTitle}`);
    const body = await cdp.eval(`(document.getElementById('noticeBody')||{}).textContent||''`);
    console.error(`안내 내용: ${body.slice(0, 300)}`);
    break;
  }
}
if (!ready) { console.error('정상 화면(result)에 도달하지 못했습니다.'); cdp.close(); process.exit(4); }

await sleep(1200);
await shot(cdp, join(OUT, 'E02-report-ok.png'));

// 3) 표 부위
const box = await cdp.eval(`(function(){var e=document.getElementById('rowsPanel');var b=e.getBoundingClientRect();` +
  `return {x:b.x+window.scrollX,y:b.y+window.scrollY,w:b.width,h:b.height};})()`);
await shot(cdp, join(OUT, 'E03-report-table-zoom.png'),
  { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: box.w + 32, height: box.h + 32, scale: 1 });

// 4) 노출 검수 — 화면 텍스트에서 위험 패턴만 센다(내용은 찍지 않는다)
const text = await cdp.eval('document.body.innerText');
const html = await cdp.eval('document.documentElement.outerHTML');
const findings = [];
for (const [name, re] of LEAK) {
  const t1 = (text.match(re) || []).length;
  const t2 = (html.match(re) || []).length;
  if (t1 || t2) findings.push(`${name}: 본문 ${t1}건 · HTML ${t2}건`);
}
const docNames = await cdp.eval(
  `Array.from(document.querySelectorAll('#tableHost tbody tr')).slice(0,40).map(function(tr){return (tr.cells[1]||{}).innerText||'';})`
);
console.log('---- 노출 검수 ----');
console.log(findings.length ? findings.join('\n') : '위험 패턴 0건');
console.log('---- 표 문서 이름 ----');
console.log(JSON.stringify(docNames, null, 0));
cdp.close();
console.log('완료');
process.exit(0);
