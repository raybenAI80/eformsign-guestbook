#!/usr/bin/env node
// Storyboard v5 scene 8 (branch · 확장) concept still -> promo/docs/storyboard-v5-s8.png (1600x900)
// Concept: 서식 종류 3갈래 (방명록 → 방명록 / 계약서 / 동의서·신청서 → 이폼사인 문서함). No channel icons.
// Usage: node tools/storyboard-s8.mjs [--out docs/storyboard-v5-s8.png] [--check]
// Same capture method as storyboard-sheet.mjs (Remotion-bundled chrome-headless-shell, no new deps).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const OUT = path.resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'docs/storyboard-v5-s8.png');
const pub = (p) => pathToFileURL(path.join(ROOT, 'public', p)).href;
const CHROME = path.join(ROOT, 'node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe');
if (!fs.existsSync(CHROME)) { console.error('chrome-headless-shell not found:', CHROME); process.exit(2); }
const SHOT = 'shots/demo/tablet/V3-step1-filled-x25.png';
const LOGO = 'brand/eformsign-logo-original.png';
for (const p of [SHOT, LOGO]) {
  if (!fs.existsSync(path.join(ROOT, 'public', p))) { console.error('missing asset:', p); process.exit(2); }
}

const W = 1600, H = 900;
// real capture crop (1920-wide source px): document title band + table rows 1-4; app bars, toolbar, logo cut off
const CROP = { x: 142, y: 530, w: 1646, h: 1110 };
const CARD_W = 470, S = CARD_W / CROP.w, CARD_H = Math.round(CROP.h * S);
const CARD_X = 56, CY = 480, CARD_Y = CY - Math.round(CARD_H / 2);
// branch geometry
const FORK_X = 610, DOC_X = 690, DOC_W = 300, DOC_H = 172, DOC_GAP = 34;
const docYs = [-1, 0, 1].map((k) => CY + k * (DOC_H + DOC_GAP) - DOC_H / 2);
const JOIN_X = 1100, BOX_X = 1170, BOX_W = 380, BOX_H = 250;
const docs = [{ label: '방명록', hl: true }, { label: '계약서' }, { label: '동의서 · 신청서' }];

const cardRight = CARD_X + CARD_W;
const mid = (y) => y + DOC_H / 2;
const lines = [
  `M${cardRight},${CY} H${FORK_X}`,
  ...docYs.map((y) => `M${FORK_X},${CY} C${FORK_X + 40},${CY} ${DOC_X - 50},${mid(y)} ${DOC_X},${mid(y)}`),
  ...docYs.map((y) => `M${DOC_X + DOC_W},${mid(y)} C${DOC_X + DOC_W + 50},${mid(y)} ${JOIN_X - 40},${CY} ${JOIN_X},${CY}`),
  `M${JOIN_X},${CY} H${BOX_X - 16}`,
];

// simple document shape (folded corner) — not an eformsign UI
const docSvg = (y, hl) => {
  const x = DOC_X, w = DOC_W, h = DOC_H, f = 30;
  const stroke = hl ? '#1f74d4' : '#8a97aa', fill = hl ? '#eaf3ff' : '#ffffff';
  return `<path d="M${x},${y} H${x + w - f} L${x + w},${y + f} V${y + h} H${x} Z" fill="${fill}" stroke="${stroke}" stroke-width="3"/>` +
    `<path d="M${x + w - f},${y} V${y + f} H${x + w}" fill="none" stroke="${stroke}" stroke-width="3"/>`;
};

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@font-face{font-family:Pretendard;src:url(${pub('fonts/Pretendard-Regular.ttf')})}
@font-face{font-family:PaperSemi;src:url(${pub('fonts/Paperlogy-6SemiBold.ttf')})}
@font-face{font-family:PaperXB;src:url(${pub('fonts/Paperlogy-8ExtraBold.ttf')})}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#f3f5f9;color:#16202e;font-family:Pretendard,'Malgun Gothic',sans-serif}
.kr{word-break:keep-all;overflow-wrap:break-word;line-break:strict}
.nb{white-space:nowrap}
.abs{position:absolute}
h1{left:56px;top:44px;width:${W - 112}px;font-family:PaperXB;font-size:44px;letter-spacing:-0.5px;text-wrap:balance}
.sub{left:58px;top:112px;width:${W - 112}px;font-size:24px;color:#4a5668}
svg{position:absolute;left:0;top:0}
.card{left:${CARD_X}px;top:${CARD_Y}px;width:${CARD_W}px;height:${CARD_H}px;overflow:hidden;border-radius:12px;background:#fff;box-shadow:0 6px 24px rgba(20,40,80,.16);outline:3px solid #1f74d4}
.card img{display:block;width:${Math.round(1920 * S)}px;margin-left:${-Math.round(CROP.x * S)}px;margin-top:${-Math.round(CROP.y * S)}px}
.cap{left:${CARD_X}px;top:${CARD_Y + CARD_H + 18}px;width:${CARD_W}px;text-align:center;font-family:PaperSemi;font-size:22px;color:#3a4556}
.dl{left:${DOC_X}px;width:${DOC_W - 24}px;height:${DOC_H}px;display:flex;align-items:center;justify-content:center;text-align:center;font-family:PaperXB;font-size:40px;color:#16202e}
.dl.hl{color:#0f4f9e}
.box{left:${BOX_X}px;top:${CY - BOX_H / 2}px;width:${BOX_W}px;height:${BOX_H}px;background:#0f2a4f;border-radius:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;box-shadow:0 8px 28px rgba(15,42,79,.28)}
.box .logo{background:#fff;border-radius:10px;padding:12px 22px;display:flex}
.box .logo img{width:200px;height:auto;display:block}
.box .t{font-family:PaperXB;font-size:40px;color:#fff}
</style></head><body>
<h1 class="abs kr">방명록은 시작일 뿐 — 서식 종류만 바꾸면 됩니다</h1>
<div class="abs sub kr">계약서도, 동의서도, 신청서도 같은 이폼사인에서 쓰고 한곳에 모입니다</div>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${lines.map((d) => `<path d="${d}" fill="none" stroke="#1f74d4" stroke-width="5" stroke-linecap="round"/>`).join('\n')}
<circle cx="${FORK_X}" cy="${CY}" r="10" fill="#1f74d4"/><circle cx="${JOIN_X}" cy="${CY}" r="10" fill="#1f74d4"/>
<path d="M${BOX_X - 20},${CY - 13} L${BOX_X - 2},${CY} L${BOX_X - 20},${CY + 13} Z" fill="#1f74d4"/>
${docYs.map((y, i) => docSvg(y, docs[i].hl)).join('\n')}
</svg>
<div class="abs card"><img src="${pub(SHOT)}"></div>
<div class="abs cap kr">실제 방명록 화면(1장 N명)</div>
${docYs.map((y, i) => `<div class="abs dl nb${docs[i].hl ? ' hl' : ''}" data-chk style="top:${y}px">${docs[i].label}</div>`).join('\n')}
<div class="abs box"><div class="logo"><img src="${pub(LOGO)}"></div><div class="t nb" data-chk>이폼사인 문서함</div></div>
<script>
const bad=[];
document.querySelectorAll('[data-chk],h1,.sub,.cap').forEach(e=>{
  if(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)bad.push('ovf:'+(e.textContent||'').slice(0,12));
  const r=e.getBoundingClientRect();if(r.right>${W}||r.bottom>${H})bad.push('out:'+(e.textContent||'').slice(0,12));
});
const R=(q)=>document.querySelector(q).getBoundingClientRect();
const h=R('h1'),s=R('.sub'),c=R('.card'),d=R('.dl'),cp=R('.cap');
if(h.bottom>s.top)bad.push('h1/sub overlap');
if(s.bottom>Math.min(c.top,d.top))bad.push('sub/content overlap');
if(cp.bottom>${H})bad.push('cap out');
document.body.setAttribute('data-overflow',bad.join('|')||'none');
</script></body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb8-'));
const htmlPath = path.join(tmp, 's8.html');
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
