// Consent-click-only script for the v7 external kiosk lane (동의서 체크 전용).
// node tools/multirow/consent-click.mjs --port 9223 --tab <tabId prefix> [--check x,y] [--continue x,y] [--out <png prefix>] [--dry|--resolve]
//
// --resolve : 클릭하지 않는다. 탭 활성화(Target.activateTarget) 후 external_view_service OOPIF 에
//   attach(flatten)해 체크박스(숨김이면 「동의」 라벨)·「계속」 버튼 중심을 구하고 최상위 프레임의 iframe
//   offset 을 더해 최상위 CSS 좌표를 출력한다: CHECK x,y / CONTINUE x,y / DPR n. 다이얼로그는 닫지 않고 보고만.
// 캡처는 증거일 뿐 — 캡처 실패(15s 타임아웃)는 경고만 남기고 클릭은 계속한다.
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
const resolve = hasFlag('--resolve');
const SHOT_TIMEOUT_MS = 15000;

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

  if (resolve) {
    if (!match) { console.error('no target: --tab <tabId prefix> required and must match a page'); process.exit(2); }
    await resolveCoords(match);
    return;
  }

  if (!tabPrefix) { console.error('no target: --tab <tabId prefix> required (or use --dry)'); process.exit(2); }
  if (!match) { console.error('no target: no page tab id starts with', tabPrefix); process.exit(2); }

  const ws = new WebSocket(match.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  const send = (method, params = {}, timeoutMs = 45000) => new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, timeoutMs);
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

  // Screenshot is evidence only: a capture failure (occluded/background tab) must not skip the click.
  const shot = async (file) => {
    try {
      await send('Page.bringToFront', {}, 5000).catch(() => {});
      const r = await send('Page.captureScreenshot', { format: 'png' }, SHOT_TIMEOUT_MS);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log('SHOT', file);
    } catch (e) {
      console.warn('WARN capture failed (click continues):', e.message);
    }
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

// --- resolve mode (no clicks) ---------------------------------------------
// Browser-level CDP: activate tab, attach (flatten) to top page + external_view_service OOPIF,
// read element rects inside the OOPIF and add the iframe's content-box offset in the top frame.
async function resolveCoords(page) {
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  const dialogs = [];
  const send = (method, params = {}, sessionId, timeoutMs = 15000) => new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, timeoutMs);
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id);
      pend.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    } else if (m.method === 'Page.javascriptDialogOpening') {
      dialogs.push(m.params); // report only — never dismissed in resolve mode
    }
  };
  await new Promise((r) => (ws.onopen = r));

  const { targetInfos } = await send('Target.getTargets');
  const pageInfo = targetInfos.find((t) => t.targetId === page.id);
  console.log('TAB', page.id.slice(0, 8), 'attached=' + pageInfo?.attached, (pageInfo?.url ?? '').slice(0, 80));
  await send('Target.activateTarget', { targetId: page.id });

  const top = (await send('Target.attachToTarget', { targetId: page.id, flatten: true })).sessionId;
  await send('Page.enable', {}, top).catch((e) => console.warn('WARN Page.enable', e.message));
  await send('Page.bringToFront', {}, top).catch(() => {});
  const evalIn = async (sid, expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
    return r.result.value;
  };
  const vis = await evalIn(top, '({ v: document.visibilityState, dpr: window.devicePixelRatio, w: innerWidth, h: innerHeight })');
  console.log('VISIBILITY', vis.v, 'viewport', `${vis.w}x${vis.h}`);

  const ifr = await evalIn(top, `(() => {
    const f = [...document.querySelectorAll('iframe')].find((x) => /external_view_service/.test(x.src)) || document.querySelector('iframe');
    if (!f) return null;
    const r = f.getBoundingClientRect(); const cs = getComputedStyle(f);
    return { x: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
             y: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop) };
  })()`);
  if (!ifr) { console.log('RESULT no iframe in top frame'); ws.close(); return; }

  const all = (await send('Target.getTargets')).targetInfos;
  const child = all.find((t) => t.type === 'iframe' && /external_view_service/.test(t.url));
  if (!child) { console.log('RESULT no external_view_service OOPIF target'); ws.close(); return; }
  const sub = (await send('Target.attachToTarget', { targetId: child.targetId, flatten: true })).sessionId;

  const found = await evalIn(sub, `(() => {
    const ctr = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.opacity !== '0' && cs.visibility !== 'hidden'; };
    const cb = document.querySelector('input[type=checkbox]');
    let check = null, how = null;
    if (cb && shown(cb)) { check = ctr(cb); how = 'checkbox'; }
    else {
      const lab = (cb && (cb.labels?.[0] || cb.closest('label')))
        || [...document.querySelectorAll('label,span,div')].find((e) => /동의/.test(e.textContent) && e.children.length <= 3 && shown(e));
      if (lab && shown(lab)) { check = ctr(lab); how = 'label'; }
    }
    const btn = [...document.querySelectorAll('button,a,input[type=button],[role=button],span,div')]
      .find((e) => (e.textContent || e.value || '').trim() === '계속' && shown(e));
    return { check, how, checked: cb ? cb.checked : null, cont: btn ? ctr(btn) : null, text: document.body.innerText.slice(0, 160) };
  })()`);

  const fmt = (p) => (p ? `${Math.round(ifr.x + p.x)},${Math.round(ifr.y + p.y)}` : 'NOT_FOUND');
  console.log('IFRAME_OFFSET', `${Math.round(ifr.x)},${Math.round(ifr.y)}`);
  console.log('CHECK', fmt(found.check), found.how ? `(${found.how}, checked=${found.checked})` : '');
  console.log('CONTINUE', fmt(found.cont));
  console.log('DPR', vis.dpr);
  if (!found.check && !found.cont) console.log('IFRAME_TEXT', found.text.replace(/\s+/g, ' ').trim());
  console.log('DIALOGS', dialogs.length ? JSON.stringify(dialogs) : 'none');
  await send('Target.detachFromTarget', { sessionId: sub }).catch(() => {});
  await send('Target.detachFromTarget', { sessionId: top }).catch(() => {});
  ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
