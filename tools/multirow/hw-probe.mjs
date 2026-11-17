// hw-probe — step driver for the handwriting multirow test (2026-11-16). Reuses cdp-lib/measure-row.
// node tools/multirow/hw-probe.mjs --port 9256 --tab 0F01C0BE <cmd> [args]
//  cmds: shot <file> | measure | tapat X Y | clicks X Y | type <text> | eval <js> | evalview <js>
import { connect } from './cdp-lib.mjs';
import { measureRow, measureChrome, consentState } from './measure-row.mjs';
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
const cmd = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')))[0];
const rest = argv.slice(argv.indexOf(cmd) + 1);
const c = await connect({ port: arg('--port', '9256'), tab: arg('--tab', ''), metrics: false });
let out;
if (cmd === 'shot') { await c.shot(rest[0], Number(rest[1] || 1)); out = 'ok'; }
else if (cmd === 'measure') out = { chrome: await measureChrome(c), consent: await consentState(c), row1: await measureRow(c, 1) };
else if (cmd === 'click') { await c.click(Number(rest[0]), Number(rest[1])); out = 'clicked'; }
else if (cmd === 'tap') { await c.tap(Number(rest[0]), Number(rest[1])); out = 'tapped'; }
else if (cmd === 'type') { await c.type(rest.join(' ')); out = 'typed'; }
else if (cmd === 'eval') out = await c.evalTop(rest.join(' '));
else if (cmd === 'evalview') out = await c.evalView(rest.join(' '));
else if (cmd === 'mdraw') {
  const pts = JSON.parse(rest[0]); const m = (type, x, y, b) => c.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !b ? 'none' : 'left', buttons: b, clickCount: 1 });
  await m('mouseMoved', pts[0][0], pts[0][1], 0); await m('mousePressed', pts[0][0], pts[0][1], 1);
  for (const [x, y] of pts.slice(1)) { await c.sleep(20); await m('mouseMoved', x, y, 1); }
  const l = pts[pts.length - 1]; await m('mouseReleased', l[0], l[1], 0); out = 'mdrawn';
}
else if (cmd === 'tdraw') { await c.touch(JSON.parse(rest[0])); out = 'tdrawn'; }
else if (cmd === 'crop') { // crop <file> x y w h [scale=2]; ends with a scale-1 shot so Input coords stay unscaled
  const [f, x, y, w, h, s] = rest; const r = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: +x, y: +y, width: +w, height: +h, scale: +(s || 2) } });
  (await import('node:fs')).writeFileSync(f, Buffer.from(r.data, 'base64')); await c.shot('.local/evidence-multirow/_reset.png', 1); out = 'cropped';
}
else if (cmd === 'frames') out = [...c.frames].map(([s, t]) => [s, t.type, t.url.slice(0, 100)]);
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
c.close(); process.exit(0);
