#!/usr/bin/env node
/* ==========================================================================
   capture.mjs — 홍보영상용 실화면 캡처 보조기 (9223 로그인 프로필 전용)

   왜 있나
     정본 캡처 드라이버는 `eformsign-course/tools/console-capture.mjs` 다(nav·click·
     eval·drag·viewport 는 전부 그쪽을 쓴다 — 재발명 금지). 그런데 그 도구에는
     `Page.bringToFront` 가 없어서, 캡처 Chrome 창이 다른 앱에 가려지면
     `Page.captureScreenshot` 이 타임아웃한다(2026-09-18 실측: 같은 명령이 성공↔타임아웃
     교대). 이 파일은 그 한 가지 빈틈만 메운다 — 앞으로 끌어올린 뒤 찍는다.

   사용
     CDP_PORT=9223 node tools/capture.mjs front
     CDP_PORT=9223 node tools/capture.mjs shot <out.png> [--clip x,y,w,h] [--scale 1]
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.CDP_PORT || 9223;
const HOST = '127.0.0.1';

async function pickTarget() {
  const r = await fetch(`http://${HOST}:${PORT}/json/list`);
  if (!r.ok) throw new Error(`CDP 목록 실패: HTTP ${r.status}`);
  const pages = (await r.json()).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pages.length) throw new Error('열린 페이지 탭이 없다');
  return pages.find((t) => (t.url || '').includes('eformsign')) || pages[0];
}

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
  send(method, params = {}, timeout = 30000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waiting.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.waiting.delete(id)) rej(new Error(`${method} 타임아웃`)); }, timeout);
    });
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const opt = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };

const target = await pickTarget();
const cdp = await Cdp.open(target.webSocketDebuggerUrl);
try {
  await cdp.send('Page.bringToFront');
  try { await cdp.send('Page.setWebLifecycleState', { state: 'active' }); } catch { /* 미지원 무시 */ }
  await new Promise((r) => setTimeout(r, 250));

  if (cmd === 'front') {
    console.log(`front: ${target.url}`);
  } else if (cmd === 'shot') {
    /* 첫 인자는 반드시 출력 경로다. 옵션이 먼저 오면 '--clip' 이름의 파일이 생기므로 막는다. */
    if (!rest[0] || rest[0].startsWith('--')) {
      throw new Error('shot: 첫 인자는 출력 png 경로여야 한다 (예: shot out.png --clip x,y,w,h)');
    }
    const out = path.resolve(rest[0]);
    const clipArg = opt('clip');
    const scale = Number(opt('scale', 1));
    let params = { format: 'png' };
    if (clipArg) {
      const [x, y, width, height] = clipArg.split(',').map(Number);
      params = { format: 'png', clip: { x, y, width, height, scale }, captureBeyondViewport: true };
    }
    let r;
    for (let i = 0; ; i++) {
      try { r = await cdp.send('Page.captureScreenshot', params, 20000); break; }
      catch (e) {
        if (i >= 2) throw e;
        await cdp.send('Page.bringToFront');
        await new Promise((s) => setTimeout(s, 600));
      }
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    console.log(`saved ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
  } else if (cmd === 'do') {
    /* 스텝 시퀀스: click:x,y | type:문자열 | wait:ms — 모두 bringToFront 뒤에 실행한다.
       (console-capture.mjs 에는 bringToFront 도 text 입력도 없다.) */
    for (const step of rest) {
      const [k, ...v] = step.split(':');
      const arg = v.join(':');
      if (k === 'click') {
        const [x, y] = arg.split(',').map(Number);
        for (const type of ['mousePressed', 'mouseReleased']) {
          await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
        }
        console.log(`click ${x},${y}`);
      } else if (k === 'type') {
        for (const ch of arg) { await cdp.send('Input.insertText', { text: ch }); await new Promise((r) => setTimeout(r, 45)); }
        console.log(`type ${arg.length}자`);
      } else if (k === 'key') {
        const vk = { Backspace: 8, Delete: 46, Enter: 13, Tab: 9 }[arg] ?? 13;
        for (const type of ['keyDown', 'keyUp']) {
          await cdp.send('Input.dispatchKeyEvent', { type, key: arg, code: arg, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        }
        console.log(`key ${arg}`);
      } else if (k === 'press' || k === 'release' || k === 'mmove') {
        /* 드래그 분해 실행(프리뷰 확인용). press → mmove... → release */
        const [x, y] = arg.split(',').map(Number);
        const type = k === 'press' ? 'mousePressed' : k === 'release' ? 'mouseReleased' : 'mouseMoved';
        const p2 = { type, x, y, button: 'left' };
        if (k === 'mmove') p2.buttons = 1; else p2.clickCount = 1;
        await cdp.send('Input.dispatchMouseEvent', p2);
        console.log(`${k} ${x},${y}`);
      } else if (k === 'move') {
        const [x, y] = arg.split(',').map(Number);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        console.log(`move ${x},${y}`);
      } else if (k === 'wheel') {
        /* 캔버스 스크롤 — deltaY 만. (console-capture 에 없다) */
        const [x, y, dy] = arg.split(',').map(Number);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy });
        console.log(`wheel ${dy}`);
      } else if (k === 'drag') {
        /* 팔레트→캔버스 끌어놓기. `drag:x0,y0~x1,y1[~x2,y2...]`
           HTML5 dnd 가 아니라 mouse 기반 위젯이므로 중간 mouseMoved 를 반드시 넣는다.

           🔴 구분자는 `~` 를 쓴다. 옛 문법 `>` 도 계속 받지만, 인자를 따옴표로 감싸지 않으면
              **셸이 `>` 를 출력 리다이렉션으로 먹어** 프로젝트 루트에 「776,456」 같은 좌표
              이름의 쓰레기 파일이 생긴다(2026-09-18 실제 발생, 0바이트 7개 + 13바이트 1개).
              도구 버그가 아니라 호출 문법 함정이라, 기본 구분자를 셸 안전한 `~` 로 바꿨다. */
        const pts = arg.split(/[~>]/).map((s2) => s2.split(',').map(Number));
        const [x0, y0] = pts[0];
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
        for (let i = 1; i < pts.length; i++) {
          const [px, py] = pts[i - 1]; const [nx, ny] = pts[i];
          for (let s3 = 1; s3 <= 8; s3++) {
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(px + (nx - px) * s3 / 8), y: Math.round(py + (ny - py) * s3 / 8), button: 'left', buttons: 1 });
            await new Promise((r) => setTimeout(r, 40));
          }
        }
        const [lx, ly] = pts[pts.length - 1];
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: lx, y: ly, button: 'left', clickCount: 1 });
        console.log(`drag ${arg}`);
      } else if (k === 'wait') {
        await new Promise((r) => setTimeout(r, Number(arg)));
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } else if (cmd === 'burst') {
    /* 클릭 직후 연속 촬영. OZ 뷰어는 Page.startScreencast 프레임이 갱신되지 않아
       (2026-09-18 실측) 동작 자산은 captureScreenshot 연속 촬영으로 만든다. */
    const out = path.resolve(opt('out', 'burst/f'));
    const n = Number(opt('n', 12));
    const gap = Number(opt('gap', 400));
    const clickArg = opt('click');
    /* 🔴 --clip/--scale: Emulation 의 deviceScaleFactor 는 captureScreenshot 에 먹지 않는다
       (2026-09-21 실측: --dsf 1.5 로 뷰포트를 잡아도 dpr=1, 캡처는 CSS 크기 그대로).
       세로 캡처 1920x2700 을 만들려면 shot 과 똑같이 clip+scale 을 줘야 한다. */
    const bClip = opt('clip');
    const bScale = Number(opt('scale', 1));
    let shotParams = { format: 'png' };
    if (bClip) {
      const [cx, cy, cw, ch] = bClip.split(',').map(Number);
      shotParams = { format: 'png', clip: { x: cx, y: cy, width: cw, height: ch, scale: bScale }, captureBeyondViewport: true };
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (clickArg) {
      const [x, y] = clickArg.split(',').map(Number);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
    }
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      try { await cdp.send('Page.bringToFront'); } catch { /* noop */ }
      let r;
      try { r = await cdp.send('Page.captureScreenshot', shotParams, 12000); }
      catch { console.log(`${i} skip`); continue; }
      const f = `${out}-${String(i).padStart(3, '0')}.png`;
      fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
      console.log(`${i} t=${Date.now() - t0}ms`);
      if (gap) await new Promise((s2) => setTimeout(s2, gap));
    }
  } else {
    console.log('usage: capture.mjs front | shot <out.png> [--clip x,y,w,h] [--scale n]');
    console.log('       capture.mjs do <step>...   step = click:x,y | move:x,y | wheel:x,y,dy | type:문자 | key:Enter | drag:x0,y0~x1,y1[~...] | wait:ms');
    console.log('       capture.mjs burst --out dir/f --n 12 --gap 400 [--click x,y] [--clip x,y,w,h] [--scale n]');
    console.log('       🔴 drag 구분자는 ~ 를 쓴다. > 를 쓰려면 인자를 따옴표로 감싸라(셸 리다이렉션).');
  }
} finally { cdp.ws.close(); }
process.exit(0);
