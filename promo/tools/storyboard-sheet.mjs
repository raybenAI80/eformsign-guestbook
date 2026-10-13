#!/usr/bin/env node
// Storyboard sheet for promo (scene data = tools/storyboard-sets/<set>.json)
//   --set v5   (default) 9 scenes, 3x3 -> docs/storyboard-v5.png
//   --set v5.1 7 scenes, 4+3      -> docs/storyboard-v5.1.png (strategy box + 「왜」 row)
// Usage: node tools/storyboard-sheet.mjs [--set v5] [--out <png>] [--check]
// Renders an HTML page with the Remotion-bundled chrome-headless-shell (no new deps).
// --check: dumps DOM after layout and fails (exit 1) if any text block overflows its box.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const SET = opt('--set', 'v5');
const setPath = path.join(ROOT, 'tools/storyboard-sets', SET + '.json');
if (!fs.existsSync(setPath)) { console.error('unknown --set:', SET, '(no ' + setPath + ')'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(setPath, 'utf8'));
const OUT = path.resolve(ROOT, opt('--out', cfg.out));
const pub = (p) => pathToFileURL(path.join(ROOT, 'public', p)).href;

const CHROME = path.join(ROOT, 'node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe');
if (!fs.existsSync(CHROME)) { console.error('chrome-headless-shell not found:', CHROME); process.exit(2); }

const W = 2400, PAD = 48, GAP = 32, COLS = cfg.cols;
const CW = Math.floor((W - PAD * 2 - GAP * (COLS - 1)) / COLS); // cell width
const IH = Math.round(CW * 9 / 16);
const TEXT_H = cfg.textH, HEAD_H = cfg.headH, CELL_H = 56 + IH + TEXT_H;
const STRAT_H = cfg.strategy ? 112 : 0; // strategy box band below the header
const scenes = cfg.scenes;
const ROWS = Math.ceil(scenes.length / COLS);
const H = HEAD_H + STRAT_H + PAD + CELL_H * ROWS + GAP * (ROWS - 1) + PAD;

// frame kinds: cover(src|file) | tablet(src, y = top crop in 1920-wide source px) | logo(src) | ph(text) | none
//   split(left, right, y)                        legacy (v5): left = cover path, right = tablet path
//   split(left:{frame}, right:{frame}, arrow?)   each half is any frame kind above; arrow:'small'
//   phlogo(text, small, src)                     grey placeholder + note + logo scaled down (never altered)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const absOf = (f, key) => (key === 'file' ? path.join(ROOT, f.file) : path.join(ROOT, 'public', f[key]));
const urlOf = (f, key) => pathToFileURL(absOf(f, key)).href;

// verify all referenced files exist; missing -> placeholder with reason
const missingOf = (f) => ['src', 'left', 'right', 'file'].filter((k) => typeof f[k] === 'string')
  .map((k) => absOf(f, k)).filter((p) => !fs.existsSync(p));
const fixFrame = (f, id) => {
  if (f.kind === 'split' && typeof f.left === 'object') { f.left = fixFrame(f.left, id); f.right = fixFrame(f.right, id); return f; }
  const miss = missingOf(f);
  if (!miss.length) return f;
  console.warn(`[${id}] missing -> placeholder:`, miss.join(', '));
  return f.kind === 'split' || !cfg.strategy ? { kind: 'none' } : { kind: 'ph', text: '소재 없음 · ' + miss.map((p) => path.basename(p)).join(', ') };
};
for (const s of scenes) s.frame = fixFrame(s.frame, s.id);

function tabletImg(src, y, w) {
  const s = w / 1920;
  return `<img src="${src}" style="width:${w}px;margin-top:${-Math.round(y * s)}px;display:block">`;
}
function frameHtml(f, w = CW) {
  switch (f.kind) {
    case 'cover': return `<img class="cover" src="${urlOf(f, f.file ? 'file' : 'src')}">`;
    case 'tablet': return tabletImg(urlOf(f, 'src'), f.y, w);
    case 'split': {
      const hw = Math.ceil(CW / 2);
      const arrow = `<div class="arrow${f.arrow === 'small' ? ' small' : ''}">→</div>`;
      if (typeof f.left === 'string') // legacy form (v5)
        return `<div class="split"><div><img class="cover" src="${urlOf(f, 'left')}"></div>` +
          `${arrow}<div>${tabletImg(urlOf(f, 'right'), f.y, hw)}</div></div>`;
      return `<div class="split"><div>${frameHtml(f.left, hw)}</div>${arrow}<div>${frameHtml(f.right, hw)}</div></div>`;
    }
    case 'logo': return `<div class="logo"><img src="${urlOf(f, 'src')}"></div>`;
    case 'phlogo': return `<div class="ph phlogo"><div class="pht kr">${esc(f.text)}</div>` +
      `<div class="phs kr">${esc(f.small)}</div><div class="phl"><img src="${urlOf(f, 'src')}"></div></div>`;
    case 'ph': return `<div class="ph${w < CW ? ' half' : ''}"><span class="pht kr">${esc(f.text)}</span></div>`;
    default: return `<div class="ph">신규 제작</div>`;
  }
}

const fontUrl = (f) => pub('fonts/' + f);

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@font-face{font-family:Pretendard;src:url(${fontUrl('Pretendard-Regular.ttf')})}
@font-face{font-family:PaperSemi;src:url(${fontUrl('Paperlogy-6SemiBold.ttf')})}
@font-face{font-family:PaperXB;src:url(${fontUrl('Paperlogy-8ExtraBold.ttf')})}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;background:#f3f5f9;color:#16202e;font-family:Pretendard,'Malgun Gothic',sans-serif}
.kr{word-break:keep-all;overflow-wrap:break-word;line-break:strict}
.nb{white-space:nowrap}
.head{height:${HEAD_H}px;padding:${PAD}px ${PAD}px 0;display:flex;align-items:flex-end;justify-content:space-between;gap:40px}
.head h1{font-family:PaperXB;font-size:46px;letter-spacing:-0.5px;text-wrap:balance}
.head p{font-size:22px;color:#4a5668;text-align:right;line-height:1.5}
.grid{display:grid;grid-template-columns:repeat(${COLS},${CW}px);gap:${GAP}px;padding:${PAD}px}
.cell{height:${CELL_H}px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(20,40,80,.08);display:flex;flex-direction:column}
.top{height:56px;flex:none;display:flex;align-items:center;gap:14px;padding:0 20px;background:#0f2a4f;color:#fff}
.top .n{font-family:PaperXB;font-size:26px}
.top .id{font-family:PaperSemi;font-size:24px;white-space:nowrap;overflow:hidden}
.top .sec{margin-left:auto;font-family:PaperSemi;font-size:22px;background:#1f74d4;border-radius:999px;padding:3px 14px}
.frame{position:relative;flex:none;width:${CW}px;height:${IH}px;overflow:hidden;background:#dfe4ec}
.frame img.cover{width:100%;height:100%;object-fit:cover;display:block}
.split{display:flex;height:100%}.split>div{width:50%;height:100%;overflow:hidden}
.split .arrow{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:50%;background:#1f74d4;color:#fff;font-size:36px;display:flex;align-items:center;justify-content:center;z-index:2}
.logo{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fff}
.logo img{width:46%;height:auto}
.ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#c9ced6;color:#4a5260;font-family:PaperSemi;font-size:34px}
.split .arrow.small{width:40px;height:40px;font-size:24px}
.ph.half{padding:0 26px;text-align:center}.ph.half .pht{font-size:23px;line-height:1.35}
.phlogo{flex-direction:column;gap:12px;padding:0 24px;text-align:center}
.phlogo .pht{font-size:26px;line-height:1.35}.phlogo .phs{font-family:Pretendard;font-size:20px;color:#3a4250}
.phl{background:#fff;border-radius:8px;padding:8px 16px;display:flex}.phl img{width:150px;height:auto;display:block}
.strat{height:${STRAT_H}px;padding:${Math.round(PAD / 2)}px ${PAD}px 0}
.strat div{height:100%;display:flex;align-items:center;background:#fff6e0;border:2px solid #e3a21a;border-left:10px solid #e3a21a;border-radius:10px;padding:0 26px;font-family:PaperSemi;font-size:25px;line-height:1.4;color:#3d2c00;text-wrap:balance}
.why{font-size:19px;line-height:1.4;color:#5a4300;background:#fff6e0;border-radius:6px;padding:6px 10px}
.badge{position:absolute;left:12px;top:12px;max-width:calc(100% - 24px);background:rgba(15,42,79,.88);color:#fff;font-size:19px;padding:6px 12px;border-radius:8px;line-height:1.35;z-index:3}
.badge.warn{background:rgba(176,60,20,.92)}
.badge.bottom{top:auto;bottom:12px}
.txt{height:${TEXT_H}px;flex:none;padding:18px 22px;display:flex;flex-direction:column;gap:12px;overflow:hidden}
.lbl{font-family:PaperSemi;font-size:17px;color:#1f74d4;margin-bottom:3px}
.screen{font-size:21px;color:#3a4556;line-height:1.4}
.narr{font-size:22px;line-height:1.5;text-wrap:pretty}
.cap{font-family:PaperSemi;font-size:22px;line-height:1.4;background:#eef4fc;border-left:5px solid #1f74d4;padding:8px 12px;text-wrap:balance}
</style></head><body>
<div class="head"><h1 class="kr">${esc(cfg.title)}</h1>
<p class="kr">${cfg.metaHtml}</p></div>
${cfg.strategy ? `<div class="strat"><div class="kr">${esc(cfg.strategy)}</div></div>\n` : ''}<div class="grid">
${scenes.map((s) => `<div class="cell" data-id="${s.id}">
<div class="top"><span class="n">${s.n}</span><span class="id kr">${esc(s.id)} · ${esc(s.name)}</span><span class="sec nb">${s.sec}초</span></div>
<div class="frame">${frameHtml(s.frame)}${s.badge ? `<div class="badge kr${s.badge.startsWith('⚠') ? ' warn' : ''}${s.badgePos === 'bottom' ? ' bottom' : ''}">${esc(s.badge)}</div>` : ''}</div>
<div class="txt">
<div><div class="lbl">화면</div><div class="screen kr">${esc(s.screen)}</div></div>
<div><div class="lbl">나레이션</div><div class="narr kr">${esc(s.narr)}</div></div>
<div><div class="lbl">자막</div><div class="cap kr">${s.cap.split(' / ').map(esc).join('<br>')}</div></div>
${s.why ? `<div><div class="lbl">왜</div><div class="why kr">${esc(s.why)}</div></div>\n` : ''}</div></div>`).join('\n')}
</div>
<script>
// overflow audit: text blocks must fit their boxes
const bad=[];
document.querySelectorAll('.txt').forEach(t=>{if(t.scrollHeight>t.clientHeight+1)bad.push(t.closest('.cell').dataset.id+':txt '+t.scrollHeight+'>'+t.clientHeight)});
document.querySelectorAll('.top .id,.badge').forEach(e=>{if(e.scrollWidth>e.clientWidth+1)bad.push(e.closest('.cell').dataset.id+':'+e.className)});
document.querySelectorAll('.ph').forEach(e=>{if(e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1)bad.push(e.closest('.cell').dataset.id+':ph')});
document.querySelectorAll('.strat div,.head h1,.head p').forEach(e=>{if(e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1)bad.push('head:'+e.className+e.tagName)});
if(document.documentElement.scrollHeight>${H}+1)bad.push('page '+document.documentElement.scrollHeight+'>'+${H});
document.body.setAttribute('data-overflow',bad.join('|')||'none');
</script></body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
const htmlPath = path.join(tmp, 'storyboard.html');
fs.writeFileSync(htmlPath, html);
const url = pathToFileURL(htmlPath).href;
const common = ['--headless', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--window-size=${W},${H}`, '--virtual-time-budget=5000'];
const dom = execFileSync(CHROME, [...common, '--dump-dom', url], { encoding: 'utf8', maxBuffer: 64 << 20 });
const ov = (dom.match(/data-overflow="([^"]*)"/) || [])[1] ?? '(unknown)';
console.log('overflow audit:', ov);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync(CHROME, [...common, `--screenshot=${OUT}`, url], { stdio: 'ignore' });
fs.rmSync(tmp, { recursive: true, force: true });
console.log('wrote', OUT, `${W}x${H}`);
if (args.includes('--check') && ov !== 'none') process.exit(1);
