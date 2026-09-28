// Consent-click-only script for the v7 external kiosk lane (동의서 체크 전용).
// node tools/multirow/consent-click.mjs --port 9223 --tab <tabId prefix> [--check x,y] [--continue x,y] [--out <png prefix>] [--dry]
//
// Same minimal CDP approach as drive.mjs (fetch /json + raw WebSocket, no puppeteer).
// Default coordinates come from .work/progress-multirow-guestbook.md item 33 (gen.cjs 방식):
//   consent checkbox = 37,199 · 계속(continue) = 963,178.
//
// 🔴 이 스크립트는 동의서 체크(약관 동의 행위)를 실행한다 — 사용자 본인의 명시적 승인이
// 채팅으로 온 세션에서만 실행한다. 워커가 스스로 실행해서는 안 된다(--dry 만 허용).
//
// Flow: attach to tab -> Page.enable -> capture "before" screenshot -> click --check
// -> wait 800ms -> click --continue -> wait 3000ms -> capture "after" screenshot
// -> print top-frame document.body.innerText (first 300 chars) to stdout.
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const hasFlag = (k) => process.argv.includes(k);
const parseXY = (s) => s.split(',').map((n) => Number(n.trim()));

const port = arg('--port', '9223');
const tabPrefix = arg('--tab');
const checkXY = parseXY(arg('--check', '37,199'));
const continueXY = parseXY(arg('--continue', '963,178'));
const outPrefix = arg('--out', '.local/multirow/consent-click');
const dry = hasFlag('--dry');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTabs() {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  return res.json();
}

async function main() {
  const tabs = await listTabs();
  const pages = tabs.filter((t) => t.type === 'page');
  const match = tabPrefix ? pages.find((t) => t.id.startsWith(tabPrefix)) : undefined;

  if (dry) {
    console.log('DRY RUN — no click performed');
    console.log('port', port, 'tabPrefix', tabPrefix ?? '(none)');
    console.log('pages found:', pages.length);
    for (const t of pages) {
      console.log(' -', t.id.slice(0, 8), t.url?.slice(0, 120));
    }
    console.log(match ? `MATCH ${match.id.slice(0, 8)} ${match.url}` : 'MATCH none');
    return;
  }

  if (!tabPrefix) { console.error('no target: --tab <tabId prefix> required (or use --dry)'); process.exit(2); }
  if (!match) { console.error('no target: no page tab id starts with', tabPrefix); process.exit(2); }

  const ws = new WebSocket(match.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 45000);
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id);
      pend.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      return;
    }
    if (m.method === 'Page.javascriptDialogOpening') {
      ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    }
  };
  await new Promise((r) => (ws.onopen = r));
  // dismiss any pending beforeunload/alert dialog that would block Page.enable
  ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
  await sleep(500);
  await send('Page.enable');

  const mouseClick = async (x, y) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  };

  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('SHOT', file);
  };

  const beforeFile = `${outPrefix}-before.png`;
  const afterFile = `${outPrefix}-after.png`;

  await shot(beforeFile);

  console.log('CLICK check', checkXY.join(','));
  await mouseClick(checkXY[0], checkXY[1]);
  await sleep(800);

  console.log('CLICK continue', continueXY.join(','));
  await mouseClick(continueXY[0], continueXY[1]);
  await sleep(3000);

  await shot(afterFile);

  const r = await send('Runtime.evaluate', {
    expression: 'document.body.innerText.slice(0, 300)',
    returnByValue: true,
  });
  const text = r.exceptionDetails
    ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)
    : r.result?.value ?? '';
  console.log('TEXT', text.replace(/\s+/g, ' ').trim());

  console.log('TARGET', match.id.slice(0, 8));
  ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
