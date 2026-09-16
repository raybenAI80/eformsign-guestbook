#!/usr/bin/env node
/**
 * setup.html 카드 마법사(16장) 워크스루 재생성 도구
 *
 *   node tools/walkthrough-setup.mjs [--port 8399] [--cdp 9273] [--out-dir evidence/setup-cards] [--keep]
 *   (--port = 정적 서버 포트, --cdp = 헤드리스 크롬 원격 디버깅 포트)
 *
 * 무엇을 하나:
 *   1) 이 폴더를 임시 정적 서버로 띄우고, 헤드리스 크롬(CDP)으로 setup.html 을 연다.
 *   2) 1단계 주소를 채워 서식 파싱(company/template)까지 마치고, 설치 방법을 「Vercel」로
 *      골라 카드 16장(BASE_CARDS 7 + SUBS.vercel 9)이 모두 나타나게 한다.
 *   3) window.__setupShowCard(i) 로 카드를 하나씩 직접 넘기며(게이팅 우회, 순수 표시 검사용)
 *      매 카드마다 axe-core 를 돌리고 표시 텍스트를 뽑는다.
 *   4) 375px·768px 두 폭으로 카드마다 스크린샷을 찍는다.
 *   5) evidence/setup-cards/walkthrough.txt 와 NN-<이름>-<폭>.png 로 저장한다.
 *
 * 🔴 포트는 반드시 인자로 지정한다 — 이 저장소의 다른 도구/워커가 8099·8199·8299·8499·8599
 *    를 쓰고 있을 수 있어 겹치면 안 된다(기본값 8399/9273 도 비어 있는지 먼저 확인할 것).
 * 🔴 헤드리스(--headless=new)만 쓴다. hidden 창(캡처 Chrome 재사용 등)은 입력이 무음으로
 *    소실되거나 스로틀된다(feedback_cdp_hidden_page_throttles_and_drops_input).
 * 이 파일은 tools/check-a11y.mjs 와 독립이다(서로 건드리지 않음). check-a11y.mjs 는 공식
 * 접근성 게이트이고, 이 도구는 카드별 육안·axe 확인용 워크스루 산출물을 만든다.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : d; };
const has = (n) => argv.includes('--' + n);

const SERVE_PORT = Number(arg('port', '8399'));
const CDP_PORT = Number(arg('cdp', '9273'));
const OUT_DIR = path.resolve(ROOT, arg('out-dir', 'evidence/setup-cards'));
const AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 카드 16장 — setup.html 의 cardList()(BASE_CARDS 7 + SUBS.vercel 9)와 순서를 맞춘다.
const CARD_LABELS = [
  '01-step1', '02-step2', '03-step3', '04-step3b', '05-step4', '06-step4b', '07-step5',
  '08-gh', '09-vercel', '10-copy', '11-deploy', '12-deploy2', '13-deploy3', '14-url', '15-report', '16-tablet'
];
const WIDTHS = [375, 768];

// ── axe-core 원본 확보 ──────────────────────────────────────────────────
async function axeSource() {
  const local = path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');
  if (fs.existsSync(local)) return fs.readFileSync(local, 'utf8');
  const cache = path.join(os.tmpdir(), 'axe-core-4.10.2.min.js');
  if (fs.existsSync(cache) && fs.statSync(cache).size > 100000) return fs.readFileSync(cache, 'utf8');
  const res = await fetch(AXE_URL);
  if (!res.ok) throw new Error('axe-core 를 내려받지 못했습니다: ' + res.status);
  const src = await res.text();
  fs.writeFileSync(cache, src, 'utf8');
  return src;
}

// ── 정적 파일 서버 ────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };
function serve(port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

// ── 헤드리스 크롬 ─────────────────────────────────────────────────────────
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];
function chromePath() {
  const p = CHROME_CANDIDATES.find((c) => fs.existsSync(c));
  if (!p) throw new Error('크롬을 찾지 못했습니다.');
  return p;
}
async function launchChrome(port) {
  const profile = path.join(os.tmpdir(), 'walkthrough-setup-profile-' + port);
  const child = spawn(chromePath(), [
    '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return child; } catch {}
    await sleep(250);
  }
  throw new Error('크롬이 뜨지 않았습니다 (포트 ' + port + ')');
}

// ── 아주 얇은 CDP 클라이언트 ──────────────────────────────────────────────
async function newPage(port, url) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const t = await r.json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  await new Promise((res) => { ws.onopen = res; });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r2 = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true });
    if (r2.exceptionDetails) throw new Error(r2.exceptionDetails.exception?.description || JSON.stringify(r2.exceptionDetails));
    return r2.result.value;
  };
  const setViewport = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  const screenshotPng = async () => {
    const r2 = await send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(r2.data, 'base64');
  };
  return {
    target: t, send, evaluate, setViewport, screenshotPng,
    close: async () => { try { ws.close(); } catch {} await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`); }
  };
}

// ── setup.html 준비 — 서식 파싱 + 설치 방법 Vercel 선택 (카드 게이팅 우회는 __setupShowCard 로) ──
const PREP = `(function () {
  try { localStorage.removeItem('kiosk-setup-v2'); } catch (e) {}
  var set = function (id, v) { var el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
  set('srcUrl', 'https://www.eformsign.com/eform/document/external_user_view_service.html?company_id=' + 'a'.repeat(32) + '&form_id=' + 'b'.repeat(32) + '&lang_code=ko&country_code=kr');
  var p = document.getElementById('btnParse'); if (p) p.click();
  var y = document.getElementById('btnYes'); if (y && !y.disabled) y.click();
  set('fCompanyName', '주식회사 보기');
  var pv = document.getElementById('pathVercel'); if (pv) pv.click();
  return typeof window.__setupShowCard === 'function' ? 'ready' : 'missing __setupShowCard';
})()`;

const AXE_EXPR = `
  axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] },
    resultTypes: ['violations']
  }).then(function (r) {
    return JSON.stringify(r.violations.map(function (v) {
      return { id: v.id, impact: v.impact, help: v.help, nodeCount: v.nodes.length,
               targets: v.nodes.slice(0, 4).map(function (n) { return n.target; }) };
    }));
  })
`;

const SHOW_CARD = (i) => `window.__setupShowCard(${i})`;
const CARD_INFO = `(function () {
  var cnt = document.getElementById('wizCount');
  var prev = document.getElementById('wizPrev');
  var next = document.getElementById('wizNext');
  var hint = document.getElementById('wizHint');
  var af = document.activeElement;
  var main = document.querySelector('main') || document.body;
  return JSON.stringify({
    count: cnt ? cnt.textContent : '',
    prev: prev ? (prev.disabled ? '못 누름' : '누를 수 있음') : '',
    next: next ? (next.disabled ? '못 누름' : '누를 수 있음') : '',
    hint: hint ? hint.textContent : '',
    focus: af ? (af.id || af.tagName) : '',
    text: (main.innerText || '').trim()
  });
})()`;

// ── 본체 ──────────────────────────────────────────────────────────────────
let srv = null, chrome = null;
try {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const axeSrc = await axeSource();
  srv = await serve(SERVE_PORT);
  const origin = `http://127.0.0.1:${SERVE_PORT}`;
  chrome = await launchChrome(CDP_PORT);

  let out = '';
  let violCount = 0;

  for (const width of WIDTHS) {
    const height = width <= 480 ? 812 : 1024;
    const pg = await newPage(CDP_PORT, origin + '/setup.html');
    try {
      await pg.setViewport(width, height);
      await sleep(400);
      await pg.evaluate('location.reload()');
      await sleep(1200);
      const prepResult = await pg.evaluate(PREP);
      if (prepResult !== 'ready') throw new Error('준비 실패: ' + prepResult);
      await sleep(300);
      await pg.evaluate(axeSrc);

      for (let i = 0; i < CARD_LABELS.length; i++) {
        await pg.evaluate(SHOW_CARD(i));
        await sleep(350);
        const info = JSON.parse(await pg.evaluate(CARD_INFO));
        const violations = JSON.parse(await pg.evaluate(AXE_EXPR));
        violCount += violations.length;

        if (width === WIDTHS[0]) {
          out += `\n===== ${CARD_LABELS[i]} =====\n`;
          out += `진행: ${info.count} | 보이는 칸: ${CARD_LABELS[i].split('-').slice(1).join('-')}\n`;
          out += `아래 버튼: [이전 (${info.prev})] [다음 (${info.next})]` + (info.hint ? ` | 안내: ${info.hint}` : '') + '\n';
          out += `초점: ${info.focus || 'BODY'}\n`;
          out += violations.length ? '' : 'axe 위반: 없음\n';
          if (violations.length) {
            out += 'axe 위반:\n';
            for (const v of violations) out += `  [${v.impact}] ${v.id} — ${v.help} (${v.nodeCount}곳, 예: ${JSON.stringify(v.targets[0])})\n`;
          }
          out += '--- 표시 텍스트 ---\n' + info.text + '\n';
        } else if (violations.length) {
          out += `\n(폭 ${width}px 에서도 위반 있음) ${CARD_LABELS[i]}:\n`;
          for (const v of violations) out += `  [${v.impact}] ${v.id} — ${v.help} (${v.nodeCount}곳)\n`;
        }

        const png = await pg.screenshotPng();
        fs.writeFileSync(path.join(OUT_DIR, `${CARD_LABELS[i]}-${width}.png`), png);
      }
    } finally { await pg.close(); }
  }

  out += `\n===== 요약 =====\n생성 시각: ${new Date().toISOString()}\n카드 수: ${CARD_LABELS.length} × 폭 ${WIDTHS.join('/')}px\n합계 axe 위반: ${violCount}건\n`;
  fs.writeFileSync(path.join(OUT_DIR, 'walkthrough.txt'), out.trimStart(), 'utf8');

  console.log(`카드 ${CARD_LABELS.length}장 × 폭 ${WIDTHS.length}종 순회 완료. axe 위반 합계: ${violCount}건`);
  console.log(`출력: ${path.join(OUT_DIR, 'walkthrough.txt')}`);
  console.log(`스크린샷: ${OUT_DIR}\\NN-이름-폭.png (${CARD_LABELS.length * WIDTHS.length}장)`);
  process.exitCode = violCount > 0 ? 1 : 0;
} catch (e) {
  console.error('워크스루 실패:', e.message);
  process.exitCode = 2;
} finally {
  if (chrome && !has('keep')) { try { process.kill(chrome.pid); } catch {} }
  if (srv) srv.close();
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
