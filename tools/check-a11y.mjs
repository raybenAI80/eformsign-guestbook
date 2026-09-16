#!/usr/bin/env node
/**
 * 웹 접근성 자동 검사 (axe-core) — KWCAG 2.2 / WCAG 2.1 AA 기준
 *
 *   node tools/check-a11y.mjs [베이스주소] [--out reports/a11y-axe.json] [--port 9273] [--keep]
 *
 * 베이스주소를 주지 않으면 이 폴더를 임시 웹 서버(기본 8399)로 띄워 검사한다.
 * 검사 대상
 *   1) setup.html — 6단계까지 모두 펼친 상태(설정을 미리 채워 넣고 설치 단계를 연다)
 *   2) setup.html — 카드 모드(기본 화면) 16장을 한 장씩 axe로 전수 검사
 *      (카드 모드 전용 CSS/구조는 펼침 모드 검사가 타지 않으므로 별도 필요, 2026-09-16)
 *   3) index.html — 방명록 래퍼. 카운트다운 덮개를 띄운 상태도 함께 본다.
 *
 * 끝 코드: serious 이상 위반이 하나라도 있으면 1, 없으면 0.
 * 🔴 이 파일은 tools/verify-kiosk.mjs 와 독립이다. 서로 건드리지 않는다.
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
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['keep'].includes(argv[i - 1].slice(2))));

const SERVE_PORT = Number(arg('serve-port', '8399'));
const CDP_PORT = Number(arg('port', '9273'));
const OUT = path.resolve(ROOT, arg('out', 'reports/a11y-axe.json'));
const AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── axe-core 원본 확보 (내려받아 임시 폴더에 캐시) ─────────────────────────
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
  const profile = path.join(os.tmpdir(), 'a11y-profile-' + port);
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
  return { target: t, send, evaluate, close: async () => { try { ws.close(); } catch {} await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`); } };
}

// ── 검사 한 판 ────────────────────────────────────────────────────────────
async function auditPage(port, url, axeSrc, prepare, label) {
  const pg = await newPage(port, url);
  try {
    await sleep(1800);
    if (prepare) { await pg.evaluate(prepare); await sleep(900); }
    await pg.evaluate(axeSrc);
    const result = await pg.evaluate(`
      axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] },
        resultTypes: ['violations','incomplete']
      }).then(function (r) {
        return JSON.stringify({
          violations: r.violations.map(function (v) {
            return { id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags,
                     nodes: v.nodes.slice(0, 6).map(function (n) { return { target: n.target, html: (n.html || '').slice(0, 220) }; }),
                     nodeCount: v.nodes.length };
          }),
          incomplete: r.incomplete.map(function (v) { return { id: v.id, impact: v.impact, help: v.help, nodeCount: v.nodes.length }; })
        });
      })
    `);
    const parsed = JSON.parse(result);
    return { label, url, ...parsed };
  } finally { await pg.close(); }
}

// ── 카드 모드 전수 검사 (setup.html, 카드 16장을 한 장씩 axe) ──────────────
// 🔴 펼침 모드(PREP_SETUP)만 검사하면 body.cardMode 전용 CSS/구조(예: 카드 모드에서만
// 숨는 h3.subHeadWrap)를 안 타서 빈 헤딩 같은 결함을 놓친다(2026-09-16 실증).
// 카드 순서는 setup.html 의 cardList()(BASE_CARDS 7 + SUBS.vercel 9 = 16장)와 맞춘다.
const SETUP_CARD_LABELS = [
  'step1', 'step2', 'step3', 'step3b', 'step4', 'step4b', 'step5',
  'sub-gh', 'sub-vercel', 'sub-copy', 'sub-deploy', 'sub-deploy2', 'sub-deploy3', 'sub-url', 'sub-report', 'sub-tablet'
];
const PREP_SETUP_CARDS = `(function () {
  try { localStorage.removeItem('kiosk-setup-v2'); } catch (e) {}
  var set = function (id, v) { var el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
  set('srcUrl', 'https://www.eformsign.com/eform/document/external_user_view_service.html?company_id=' + 'a'.repeat(32) + '&form_id=' + 'b'.repeat(32) + '&lang_code=ko&country_code=kr');
  var p = document.getElementById('btnParse'); if (p) p.click();
  var y = document.getElementById('btnYes'); if (y && !y.disabled) y.click();
  set('fCompanyName', '주식회사 보기');
  var pv = document.getElementById('pathVercel'); if (pv) pv.click();
  return typeof window.__setupShowCard === 'function' ? 'ready' : 'missing __setupShowCard';
})()`;
const AXE_VIOLATIONS_EXPR = `
  axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] },
    resultTypes: ['violations']
  }).then(function (r) {
    return JSON.stringify(r.violations.map(function (v) {
      return { id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags,
               nodes: v.nodes.slice(0, 6).map(function (n) { return { target: n.target, html: (n.html || '').slice(0, 220) }; }),
               nodeCount: v.nodes.length };
    }));
  })
`;
async function auditSetupCards(port, url, axeSrc) {
  const pg = await newPage(port, url);
  try {
    await sleep(1800);
    const ready = await pg.evaluate(PREP_SETUP_CARDS);
    if (ready !== 'ready') throw new Error('setup.html 카드 모드 준비 실패: ' + ready);
    await sleep(600);
    await pg.evaluate(axeSrc);
    const out = [];
    for (let i = 0; i < SETUP_CARD_LABELS.length; i++) {
      await pg.evaluate(`window.__setupShowCard(${i})`);
      await sleep(300);
      const violations = JSON.parse(await pg.evaluate(AXE_VIOLATIONS_EXPR));
      out.push({ label: `setup.html (카드 모드 ${i + 1}/${SETUP_CARD_LABELS.length}: ${SETUP_CARD_LABELS[i]})`, url, violations, incomplete: [] });
    }
    return out;
  } finally { await pg.close(); }
}

// ── setup.html 을 6단계까지 펼치는 준비 스크립트 ──────────────────────────
const PREP_SETUP = `(function () {
  try {
    localStorage.setItem('eformsign-kiosk-setup', JSON.stringify({}));
  } catch (e) {}
  var set = function (id, v) { var el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
  set('srcUrl', 'https://www.eformsign.com/eform/document/external_user_view_service.html?company_id=' + 'a'.repeat(32) + '&form_id=' + 'b'.repeat(32) + '&lang_code=ko&country_code=kr');
  var p = document.getElementById('btnParse'); if (p) p.click();
  var y = document.getElementById('btnYes'); if (y && !y.disabled) y.click();
  set('fCompanyName', '주식회사 보기');
  var pv = document.getElementById('pathVercel'); if (pv) pv.click();
  // 모든 서브스텝을 펼친다 — 접힌 칸의 내용까지 전수 검사하기 위해서다.
  document.querySelectorAll('.sub').forEach(function (el) { el.classList.add('open'); });
  document.querySelectorAll('button.subHead').forEach(function (b) { b.setAttribute('aria-expanded', 'true'); });
  var rep = document.getElementById('fReport'); if (rep && !rep.checked) { rep.checked = true; rep.dispatchEvent(new Event('change', { bubbles: true })); }
  var s6 = document.getElementById('step6'); if (s6) s6.hidden = false;
  var body = document.getElementById('pathVercelBody'); if (body) body.hidden = false;
  // 카드 한 장씩 보여 주는 모드를 풀어 모든 단계를 한 화면에 펼친다(전수 검사용).
  if (typeof window.__setupShowAllCards === 'function') window.__setupShowAllCards();
  // 접힌 「안 돼요」 도움말까지 펼친다.
  document.querySelectorAll('details').forEach(function (d) { d.open = true; });
  return 'prepared';
})()`;

const PREP_INDEX_COUNTDOWN = `(function () {
  var ov = document.getElementById('ovIdle');
  var ld = document.getElementById('ovLoading');
  if (ld) ld.hidden = true;
  if (ov) ov.hidden = false;
  return 'countdown shown';
})()`;

// ── 본체 ──────────────────────────────────────────────────────────────────
const base = positional[0] || null;
let srv = null, chrome = null;
const started = Date.now();
try {
  const axeSrc = await axeSource();
  let origin = base;
  if (!origin) { srv = await serve(SERVE_PORT); origin = `http://127.0.0.1:${SERVE_PORT}`; }
  chrome = await launchChrome(CDP_PORT);

  const pages = [
    { label: 'setup.html (6단계 모두 펼친 상태)', url: origin + '/setup.html', prepare: PREP_SETUP },
    { label: 'index.html (방명록 래퍼 기본 화면)', url: origin + '/index.html?template=' + 'b'.repeat(32) + '&company=' + 'a'.repeat(32), prepare: null },
    { label: 'index.html (복귀 카운트다운 덮개 표시)', url: origin + '/index.html?template=' + 'b'.repeat(32) + '&company=' + 'a'.repeat(32), prepare: PREP_INDEX_COUNTDOWN }
  ];

  const results = [];
  for (const p of pages) results.push(await auditPage(CDP_PORT, p.url, axeSrc, p.prepare, p.label));
  results.push(...await auditSetupCards(CDP_PORT, origin + '/setup.html', axeSrc));

  const rank = { critical: 4, serious: 3, moderate: 2, minor: 1, null: 0 };
  let worst = 0, total = 0;
  for (const r of results) for (const v of r.violations) { total += v.nodeCount; worst = Math.max(worst, rank[v.impact] || 0); }

  const report = {
    tool: 'axe-core 4.10.2',
    standard: 'KWCAG 2.2 / WCAG 2.1 AA (axe tags: wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice)',
    at: new Date().toISOString(),
    origin,
    pages: results,
    summary: {
      violationRules: results.reduce((a, r) => a + r.violations.length, 0),
      violationNodes: total,
      worstImpact: Object.keys(rank).find((k) => rank[k] === worst) || 'none',
      seriousOrAbove: results.reduce((a, r) => a + r.violations.filter((v) => (rank[v.impact] || 0) >= 3).length, 0)
    },
    elapsedMs: Date.now() - started
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

  for (const r of results) {
    console.log(`\n■ ${r.label}`);
    if (!r.violations.length) console.log('   위반 없음');
    for (const v of r.violations) console.log(`   [${v.impact}] ${v.id} — ${v.help} (${v.nodeCount}곳)`);
    for (const v of r.incomplete) console.log(`   (수동 확인) ${v.id} — ${v.help} (${v.nodeCount}곳)`);
  }
  console.log(`\n결과 파일: ${OUT}`);
  console.log(`위반 규칙 ${report.summary.violationRules}건 / 해당 요소 ${report.summary.violationNodes}곳 / 가장 높은 심각도 ${report.summary.worstImpact}`);
  process.exitCode = report.summary.seriousOrAbove > 0 ? 1 : 0;
} catch (e) {
  console.error('검사 실패:', e.message);
  process.exitCode = 2;
} finally {
  if (chrome && !has('keep')) { try { process.kill(chrome.pid); } catch {} }
  if (srv) srv.close();
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
