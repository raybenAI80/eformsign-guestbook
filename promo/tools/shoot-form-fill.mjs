#!/usr/bin/env node
/**
 * shoot-form-fill.mjs — 「방문자 기록(영상용)」 외부 작성 화면을 **채워가는 과정**을
 * 한 프로세스 안에서 입력+연속촬영으로 만든다(fill-seq / kiosk 채우기 공용).
 *
 * 왜 스크립트인가
 *   서식을 고칠 때마다 B·C 계열을 통째로 다시 찍어야 하는데(2026-09 네 번째 재촬영),
 *   45~55 프레임을 tool call 로 하나씩 찍으면 세션 예산이 먼저 죽는다.
 *   또 `Input.dispatchMouseEvent` 가 밀리는 구간이 있어 한 프로세스 안에서
 *   순차 await 로 돌리는 편이 훨씬 안정적이다.
 *
 * 전제
 *   - 캡처 Chrome 9223 에 이미 **작성 화면이 열려 있고 「입력 시작」까지 눌린 상태**여야 한다.
 *     (동의 → 계속 → 입력 시작 은 capture.mjs do 로 미리 처리한다.)
 *   - 뷰포트는 CSS 1280x1800. 저장은 clip 0,0,1280,1800 + scale 1.5 = **1920x2700**.
 *     🔴 Emulation 의 deviceScaleFactor 는 captureScreenshot 에 먹지 않는다 — clip.scale 로만 는다.
 *
 * 쓰는 법
 *   node tools/shoot-form-fill.mjs --out public/shots/B/fill-seq/f --plan <json파일>
 *   plan = [{click:[x,y]},{type:"홍길동",per:2},{shot:1},{wait:400}] 형태의 배열.
 *          type 의 per = 몇 글자마다 한 장 찍을지(0 이면 안 찍음).
 *
 *   --input-match <url 조각> [--input-offset x,y]
 *          클릭·입력을 **그 iframe 타깃 세션**으로 직접 보낸다(촬영은 계속 page 타깃).
 *          plan 좌표는 page 좌표 그대로 쓰고, iframe 의 page 내 원점을 --input-offset 로 빼 준다.
 *          🔴 왜(2026-09-23 실측): 헤드리스 Chrome 에서 래퍼(키오스크) 페이지 안의 이폼사인 iframe
 *          (OOPIF)에 page 세션으로 클릭을 보내면 **간헐적으로 먹지 않는다** — 동의 체크가 안 되고,
 *          서명 다이얼로그 버튼(취소·확인·텍스트 탭)이 반응하지 않았다. iframe 타깃 세션으로
 *          같은 좌표(프레임 기준)를 보내면 즉시 먹었다. 외부 작성 화면(최상위 문서)은 해당 없음.
 */
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.CDP_PORT || 9223;
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt('out', 'out/seq/f'));
const PLAN = JSON.parse(fs.readFileSync(path.resolve(opt('plan')), 'utf8'));
const CLIP = (opt('clip', '0,0,1280,1800')).split(',').map(Number);
const SCALE = Number(opt('scale', 1.5));
const START = Number(opt('start', 0));
const INPUT_MATCH = opt('input-match', '');
const [OFF_X, OFF_Y] = (opt('input-offset', '0,0')).split(',').map(Number);

const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
const pages = (await r.json()).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
const target = pages.find((t) => (t.url || '').includes('eformsign')) || pages[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const waiting = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
const send = (method, params = {}, timeout = 30000) => new Promise((res, rej) => {
  const i = ++id; waiting.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (waiting.delete(i)) rej(new Error(method + ' 타임아웃')); }, timeout);
});
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

/* 입력 전용 세션 — --input-match 가 있으면 그 iframe 타깃, 없으면 page 세션 그대로 */
let sendInput = send;
let inWs = null;
if (INPUT_MATCH) {
  const all = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const it = all.find((t) => t.type === 'iframe' && (t.url || '').includes(INPUT_MATCH));
  if (!it) { console.error('input-match 대상 iframe 없음: ' + INPUT_MATCH); process.exit(2); }
  inWs = new WebSocket(it.webSocketDebuggerUrl);
  await new Promise((res, rej) => { inWs.onopen = res; inWs.onerror = rej; });
  const w2 = new Map(); let id2 = 0;
  inWs.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && w2.has(m.id)) { const { res, rej } = w2.get(m.id); w2.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
  sendInput = (method, params = {}, timeout = 30000) => new Promise((res, rej) => {
    const i = ++id2; w2.set(i, { res, rej }); inWs.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (w2.delete(i)) rej(new Error(method + ' 타임아웃')); }, timeout);
  });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
let n = START;
async function shot() {
  try { await send('Page.bringToFront'); } catch { /* noop */ }
  const [x, y, w, h] = CLIP;
  let res;
  for (let i = 0; ; i++) {
    try { res = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: SCALE }, captureBeyondViewport: true }, 20000); break; }
    catch (e) { if (i >= 2) { console.log('shot 실패 skip'); return; } await sleep(600); }
  }
  const f = `${OUT}-${String(n).padStart(3, '0')}.png`;
  fs.writeFileSync(f, Buffer.from(res.data, 'base64'));
  console.log(`${path.basename(f)}`);
  n++;
}

try {
  await send('Page.bringToFront');
  for (const step of PLAN) {
    if (step.click) {
      const [x, y] = step.click;
      for (const type of ['mousePressed', 'mouseReleased']) await sendInput('Input.dispatchMouseEvent', { type, x: x - OFF_X, y: y - OFF_Y, button: 'left', clickCount: 1 });
      console.log(`click ${x},${y}`);
      await sleep(step.after ?? 450);
    }
    if (step.type !== undefined) {
      const per = step.per ?? 0; let c = 0;
      for (const ch of step.type) {
        await sendInput('Input.insertText', { text: ch });
        await sleep(step.delay ?? 70); c++;
        if (per && c % per === 0) await shot();
      }
      if (per && c % per !== 0) await shot();
    }
    if (step.shot) { for (let i = 0; i < step.shot; i++) { await shot(); await sleep(step.gap ?? 250); } }
    if (step.wait) await sleep(step.wait);
  }
} finally { ws.close(); if (inWs) inWs.close(); }
console.log(`총 ${n - START}장 (${OUT}-${String(START).padStart(3, '0')} ~ ${String(n - 1).padStart(3, '0')})`);
process.exit(0);
