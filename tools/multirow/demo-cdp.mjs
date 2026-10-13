// Demo capture driver for the 「실제 화면 편」 tablet shots (lane D4b, 2026-10-06).
// One CDP connection per run, ops executed in argv order. Works on an EXISTING tab (no reload unless --nav).
//
//   node tools/multirow/demo-cdp.mjs --port 9242 --tab <idPrefix> [--vw 768 --vh 1389] [--scale 2.5]
//        [--no-metrics] [--tz Asia/Seoul] [--hold [sec]] <ops...>
// ops (repeatable, in order):
//   --nav <url>            Page.navigate (🔴 may create a new multirow sheet — think first)
//   --sleep <ms>
//   --shot <png>           clip 0,0,vw,vh at --scale (768x1389 x2.5 -> 1920x3473)
//   --eval <js>            Runtime.evaluate on the top page, prints JSON
//   --feval <js>           Runtime.evaluate inside the m_external_view_service OOPIF (parentId === page)
//   --click x,y            mouse click (top-page CSS px)
//   --tap x,y              touch tap (touch emulation on -> touchStart/End -> off)
//   --draw x,y,w,h         touch signature stroke (sine, 24 moves) inside the box (top-page CSS px)
//   --type <text>          Input.insertText
//   --burst N,ms,<prefix>  N shots every ms -> <prefix>0.png .. <prefix>N-1.png
// --hold [sec]: after the ops keep the session (and so the metrics override) alive for sec (default 3600)
//   so that another CDP client (e.g. consent-click.mjs, which sets no override) acts in the same viewport.
//   Kill it by PID (printed as HOLD pid=...). 🔴 CDP metrics override is released when its session closes.
import { connect } from './cdp-lib.mjs';
// (2026-10-07 lane D4a: CDP primitives moved to cdp-lib.mjs, shared with visitor-step.mjs — behaviour unchanged)

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);

let c;
try {
  c = await connect({ port: arg('--port', '9242'), tab: arg('--tab', ''), metrics: !has('--no-metrics'),
    vw: Number(arg('--vw', '768')), vh: Number(arg('--vh', '1389')), scale: Number(arg('--scale', '2.5')), tz: arg('--tz'), log: console.log });
} catch (e) { console.error(e.message); process.exit(2); }

for (let i = 0; i < argv.length; i++) {
  const op = argv[i], v = argv[i + 1];
  if (op === '--nav') { await c.send('Page.navigate', { url: v }); console.log('NAV', v, new Date().toISOString()); }
  else if (op === '--sleep') await c.sleep(Number(v));
  else if (op === '--shot') await c.shot(v);
  else if (op === '--eval') console.log('EVAL', JSON.stringify(await c.evalTop(v)));
  else if (op === '--feval') { const r = await c.evalView(v); console.log('FEVAL', r === null ? 'no view frame' : JSON.stringify(r)); }
  else if (op === '--click') { const [x, y] = v.split(',').map(Number); await c.click(x, y); console.log('CLICK', x, y); }
  else if (op === '--tap') { const [x, y] = v.split(',').map(Number); await c.tap(x, y); console.log('TAP', x, y); }
  else if (op === '--draw') { const [x, y, w, h] = v.split(',').map(Number); await c.draw(x, y, w, h); console.log('DRAW', v); }
  else if (op === '--type') { await c.type(v); console.log('TYPE', v); }
  else if (op === '--burst') {
    const [n, ms, prefix] = v.split(','); const t0 = Date.now();
    await c.burst(Number(n), Number(ms), (k) => { console.log('  t+', Date.now() - t0, 'ms'); return `${prefix}${k}.png`; });
  }
}

if (has('--hold')) {
  const sec = Number(arg('--hold', '3600')) || 3600;
  console.log(`HOLD pid=${process.pid} viewport=${c.vw}x${c.vh} for ${sec}s`);
  await c.hold(sec);
} else { c.close(); process.exit(0); }
