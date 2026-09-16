/**
 * 「이 origin 에서 이폼사인 임베딩이 동작하는가」를 실기로 판정한다.
 *
 * 배경(2026-09-16)
 *   키오스크 래퍼는 이폼사인 임베딩 스크립트(efs_embedded_v2.js)를 불러와 작성 화면을
 *   iframe 으로 띄운다. API 키는 쓰지 않고 회사 ID·서식 ID 만 쓴다. 그때까지 실제로
 *   열어 본 origin 은 *.vercel.app 과 localhost 둘뿐이었고, **고객 자체 도메인에서도
 *   되는지**는 확인된 적이 없었다(이폼사인 서버가 Origin/Referer 로 막을 가능성).
 *   이 도구는 임의의 배포 URL 에 대해 그 판정을 자동으로 내리고 증거를 남긴다.
 *
 * 판정 3항목
 *   1. script  — efs_embedded_v2.js 가 200 으로 내려오고 EformSignDocument 가 정의되는가
 *   2. frame   — 작성 화면 iframe 이 실제로 렌더되는가(action_callback = __kioskState.formReady)
 *   3. submit  — (--submit 일 때만) 값 입력 후 전송이 접수되고 빈 서식이 다시 열리는가
 *   덧붙여 이폼사인 도메인에서 온 모든 응답의 상태코드와 차단 관련 헤더
 *   (x-frame-options · content-security-policy(frame-ancestors) · access-control-allow-origin)를
 *   모아 기록한다. 거절당했다면 그 근거가 여기 남는다.
 *
 * 사용법
 *   node tools/verify-origin.mjs --url https://eformsign-guestbook-test.vercel.app
 *   node tools/verify-origin.mjs --url https://kiosk.고객사.co.kr --submit
 *   # 로컬 자체서명 HTTPS 로 임의 호스트명을 만들어 보는 경우(serve-https.mjs 를 안에서 띄운다)
 *   node tools/verify-origin.mjs --serve . --host kiosk.127.0.0.1.nip.io --https-port 8443 \
 *        --company <회사ID> --template <서식ID>
 *
 * 주요 옵션
 *   --submit            전송까지 한다(실제 문서가 1건 만들어진다)
 *   --company/--template  저장소 config.js 가 비어 있을 때 URL 쿼리로 주입
 *   --port <n>          CDP 포트(기본 8199 계열에서 비어 있는 것을 고른다)
 *   --out <file>        결과 JSON 경로(기본 reports/origin-<host>.json)
 *   --shots <dir>       스크린샷 디렉터리(기본 evidence/origin)
 *   --insecure          자체서명 인증서를 무시한다(--serve 면 자동)
 *   --notype            값 입력을 건너뛴다(서식 좌표가 다른 경우)
 *   --keep-open         끝나고 크롬을 남긴다(디버그용)
 *
 * 🔴 크롬은 반드시 헤드리스로 띄운다 — 화면에 가려진 창은 클릭이 무음으로 사라진다.
 * 🔴 정리할 때 이름 기준 일괄 종료(taskkill /IM chrome.exe)를 하지 않는다. 이 도구는
 *    자기가 띄운 자식 프로세스만 죽인다.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveCoords } from './form-coords.mjs';
import { serveHttps } from './serve-https.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SUBMIT = has('submit');
const SHOTS = path.resolve(arg('shots', path.join(ROOT, 'evidence', 'origin')));
const LABEL = arg('label', '');

// ── 유틸 ──────────────────────────────────────────────────────────────────
function freePort(from) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', () => resolve(freePort(from + 1)));
    s.once('listening', () => s.close(() => resolve(from)));
    s.listen(from, '127.0.0.1');
    s.unref?.();
    setTimeout(() => reject(new Error('포트 탐색 실패')), 5000).unref?.();
  });
}

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
function chromePath() {
  const p = CHROME_CANDIDATES.find((c) => fs.existsSync(c));
  if (!p) throw new Error('크롬을 찾지 못했습니다.');
  return p;
}

async function launchChrome(port, { insecure }) {
  const profile = path.join(os.tmpdir(), 'kiosk-origin-profile-' + port);
  fs.rmSync(profile, { recursive: true, force: true });
  const args = [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--remote-allow-origins=*',
    '--user-data-dir=' + profile,
    '--window-size=768,1024',
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  ];
  if (insecure) args.push('--ignore-certificate-errors');
  args.push('about:blank');
  const child = spawn(chromePath(), args, { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return child; } catch {}
    await sleep(250);
  }
  throw new Error('크롬이 뜨지 않았습니다 (포트 ' + port + ')');
}

/** 얇은 CDP 페이지 핸들 — tools/cdp.mjs 와 같은 프로토콜 사용법을, 이벤트 수신까지 되도록 확장한 것. */
async function newPage(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const t = await r.json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    } else if (m.method) listeners.forEach((fn) => fn(m.method, m.params));
  };
  await new Promise((res) => { ws.onopen = res; });
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression) => {
    const r2 = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true });
    if (r2.exceptionDetails) throw new Error(r2.exceptionDetails.exception?.description || JSON.stringify(r2.exceptionDetails));
    return r2.result.value;
  };
  return { send, evaluate, on: (fn) => listeners.push(fn), close: () => { try { ws.close(); } catch {} } };
}

// ── 본체 ──────────────────────────────────────────────────────────────────
const started = [];      // 내가 띄운 것만 정리한다
let server = null;

async function main() {
  let base = arg('url', '');
  const serveRoot = arg('serve', '');
  if (serveRoot) {
    const host = arg('host', 'kiosk.127.0.0.1.nip.io');
    const httpsPort = Number(arg('https-port', '8443'));
    const certDir = path.resolve(arg('cert-dir', path.join(os.tmpdir(), 'kiosk-origin-cert')));
    server = await serveHttps({ host, port: httpsPort, root: path.resolve(serveRoot), certDir });
    base = server.url;
    console.log('SERVE ' + base + '  (root=' + path.resolve(serveRoot) + ')');
  }
  if (!base) throw new Error('--url 또는 --serve 가 필요합니다.');

  const origin = new URL(base).origin;
  const insecure = has('insecure') || !!serveRoot;
  const cdpPort = Number(arg('port', '0')) || (await freePort(8199));
  const chrome = await launchChrome(cdpPort, { insecure });
  started.push(chrome);
  console.log('CHROME pid=' + chrome.pid + ' cdp=' + cdpPort + ' headless');

  const pg = await newPage(cdpPort);
  const net_ = { responses: [], failures: [], console: [] };
  pg.on((method, p) => {
    if (method === 'Network.responseReceived') {
      const r = p.response;
      net_.responses.push({
        url: r.url, status: r.status, type: p.type,
        headers: Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
      });
    } else if (method === 'Network.loadingFailed') {
      net_.failures.push({ type: p.type, errorText: p.errorText, blockedReason: p.blockedReason, canceled: p.canceled });
    } else if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(p.type)) {
      net_.console.push(p.type + ': ' + (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '));
    } else if (method === 'Log.entryAdded' && ['error'].includes(p.entry.level)) {
      net_.console.push('log: ' + p.entry.text + ' ' + (p.entry.url || ''));
    }
  });
  await pg.send('Network.enable', {});
  await pg.send('Page.enable', {});
  await pg.send('Runtime.enable', {});
  await pg.send('Log.enable', {});
  await pg.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });

  const q = [];
  if (arg('company', '')) q.push('company=' + encodeURIComponent(arg('company')));
  if (arg('template', '')) q.push('template=' + encodeURIComponent(arg('template')));
  q.push('idle=0', 'mode=immediate');
  const pageUrl = base.replace(/\/$/, '') + '/?' + q.join('&');

  const result = {
    at: new Date().toISOString(),
    origin, pageUrl, label: LABEL,
    checks: { script: null, frame: null, submit: SUBMIT ? null : 'skipped' },
    eformsignResponses: [], blockingHeaders: [], failures: [], consoleErrors: [],
    documents: [], shots: [], notes: [],
  };

  fs.mkdirSync(SHOTS, { recursive: true });
  const slug = (LABEL || new URL(base).host).replace(/[^a-zA-Z0-9.-]/g, '_');
  const shot = async (name) => {
    const r = await pg.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(SHOTS, `${slug}-${name}.png`);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    result.shots.push(f);
    console.log('  shot ' + path.basename(f));
  };
  const waitFor = async (expr, ms, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await pg.evaluate(expr)) return true; } catch {}
      await sleep(500);
    }
    return false;
  };

  console.log('NAVIGATE ' + pageUrl);
  await pg.send('Page.navigate', { url: pageUrl });
  await sleep(4000);

  // ── 1. 스크립트 ──────────────────────────────────────────────────────
  const scriptResp = () => net_.responses.find((r) => r.url.includes('efs_embedded_v2.js'));
  await waitFor('typeof EformSignDocument !== "undefined"', 20000, 'EformSignDocument');
  const sr = scriptResp();
  const defined = await pg.evaluate('typeof EformSignDocument !== "undefined"').catch(() => false);
  result.checks.script = (defined && sr && sr.status === 200) ? 'PASS' : 'FAIL';
  result.scriptResponse = sr || null;
  console.log('  [1] script  ' + result.checks.script + (sr ? ' (HTTP ' + sr.status + ')' : ' (응답 없음)'));

  // ── 2. 작성 화면 iframe ───────────────────────────────────────────────
  const frameOk = await waitFor('!!(window.__kioskState && window.__kioskState.formReady)', 45000, 'formReady');
  const frameInfo = await pg.evaluate(`(function(){
    var f = document.getElementById('eformsign_iframe');
    var s = window.__kioskState || {};
    return JSON.stringify({ hasIframe: !!f, src: f ? f.src : '', loads: s.loads, formReady: s.formReady, phase: s.phase });
  })()`).catch(() => '{}');
  result.frameInfo = JSON.parse(frameInfo || '{}');
  result.checks.frame = frameOk ? 'PASS' : 'FAIL';
  console.log('  [2] frame   ' + result.checks.frame + ' ' + frameInfo);
  await shot('1-form');

  // ── 3. 전송 ─────────────────────────────────────────────────────────
  if (SUBMIT && frameOk) {
    const { coords: C, sources } = resolveCoords({ argv: process.argv, env: process.env });
    console.log('  COORDS via ' + sources.join(','));
    const click = async (xy, wait = 1500) => {
      await pg.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xy[0], y: xy[1], button: 'left', clickCount: 1 });
      await pg.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xy[0], y: xy[1], button: 'left', clickCount: 1 });
      await sleep(wait);
    };
    const type = async (s) => {
      // 🔴 keyDown 에 text 를 실으면 char 이벤트와 함께 **두 번** 입력된다(2026-09-16 실측:
      //    "ORIGIN검증" → "OORRIIGGIINN검검증증"). keyDown 은 키만, 실제 문자는 char 로 보낸다.
      for (const ch of s) {
        await pg.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch });
        await pg.send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch, key: ch });
        await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
        await sleep(60);
      }
    };
    await sleep(6000);
    await click(C.consent);
    await click(C.continue, 9000);
    await shot('2-editable');
    if (!has('notype')) {
      await click(C.name, 1500); await type(arg('name', 'ORIGIN검증'));
      await sleep(600);
      await click(C.org, 1200); await type('도메인테스트');
      await sleep(1000);
    }
    await shot('3-filled');
    const before = await pg.evaluate('window.__kioskState.submits');
    await click(C.send, 6000);
    await click(C.popup1, 3000);
    if (!(await pg.evaluate(`window.__kioskState.submits > ${before}`))) await click(C.popup2, 4000);
    const submitted = await waitFor(`window.__kioskState.submits > ${before}`, 60000, '제출');
    result.documents = JSON.parse(await pg.evaluate('JSON.stringify(window.__kioskState.docs)').catch(() => '[]'));
    // 제출 후 빈 서식이 다시 열리는지
    const reopened = submitted && await waitFor('window.__kioskState.phase === "form" && window.__kioskState.loads >= 2', 60000, '재오픈')
      && await waitFor('!!window.__kioskState.formReady', 45000, '재오픈 formReady');
    await sleep(6000);
    await shot('4-next-blank');
    result.checks.submit = submitted ? (reopened ? 'PASS' : 'PARTIAL(전송됨·재오픈 실패)') : 'FAIL';
    console.log('  [3] submit  ' + result.checks.submit + ' docs=' + JSON.stringify(result.documents));
  } else if (SUBMIT) {
    result.checks.submit = 'SKIPPED(frame FAIL)';
  }

  // ── 증거 수집 ────────────────────────────────────────────────────────
  const HEADER_KEYS = ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only',
    'access-control-allow-origin', 'referrer-policy', 'cross-origin-resource-policy', 'cross-origin-embedder-policy'];
  result.eformsignResponses = net_.responses
    .filter((r) => /eformsign\.com/i.test(r.url))
    .map((r) => ({
      url: r.url.slice(0, 200), status: r.status, type: r.type,
      headers: Object.fromEntries(HEADER_KEYS.filter((k) => r.headers[k]).map((k) => [k, r.headers[k]])),
    }));
  result.blockingHeaders = result.eformsignResponses
    .filter((r) => r.headers['x-frame-options'] || /frame-ancestors/i.test(r.headers['content-security-policy'] || ''))
    .map((r) => ({ url: r.url, xfo: r.headers['x-frame-options'], csp: r.headers['content-security-policy'] }));
  result.httpErrors = result.eformsignResponses.filter((r) => r.status >= 400);
  result.failures = net_.failures;
  result.consoleErrors = net_.console.slice(0, 40);
  result.kioskLog = await pg.evaluate('window.__kioskLog ? window.__kioskLog.slice(-40).join("\\n") : ""').catch(() => '');

  const verdictParts = [result.checks.script, result.checks.frame, SUBMIT ? result.checks.submit : null].filter(Boolean);
  result.verdict = verdictParts.every((v) => v === 'PASS') ? 'PASS' : 'FAIL';

  const outFile = path.resolve(arg('out', path.join(ROOT, 'reports', `origin-${slug}.json`)));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');

  console.log('\nVERDICT ' + result.verdict + '  origin=' + origin);
  console.log('차단 헤더: ' + (result.blockingHeaders.length ? JSON.stringify(result.blockingHeaders) : '없음'));
  console.log('이폼사인 4xx/5xx: ' + (result.httpErrors.length ? JSON.stringify(result.httpErrors) : '없음'));
  console.log('결과 JSON: ' + outFile);
  if (!has('keep-open')) pg.close();
  return result;
}

try {
  const r = await main();
  process.exitCode = r.verdict === 'PASS' ? 0 : 1;
} catch (e) {
  console.error('ERROR ' + (e && e.stack || e));
  process.exitCode = 2;
} finally {
  if (!has('keep-open')) {
    for (const c of started) { try { process.kill(c.pid); } catch {} }   // 내가 띄운 PID 만
  }
  if (server) await server.close();
}
