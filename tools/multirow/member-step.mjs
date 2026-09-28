// Generate a drive.mjs steps file that opens a member-variant doc from 진행 중 문서함 (logged-in session),
// captures viewer network bodies, fills row <row> and sends (confirming the 문서 전송 dialog).
// node member-step.mjs --doc <doc.json> --row N --ev <evidence dir> [--no-send] [--confirm x,y] > steps.json
// --confirm: 문서 전송 dialog 의 전송 버튼. 기본 861,636; 다음 단계 수신자 입력칸이 있는 창(전송 시 지정 가능 단계가 남음)은 862,693 (2026-09-28 실측)
import fs from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const d = JSON.parse(fs.readFileSync(arg('--doc'), 'utf8'));
const row = Number(arg('--row')); const E = arg('--ev'); const tag = arg('--tag', 'a');
const y = 355 + (row - 1) * 85;
const steps = [
  { size: [1280, 900] },
  { nav: 'https://www.eformsign.com/eform/document/document_list.html?mode=ip' }, { wait: 6000 },
  { net: { dir: `${E}/net-${tag}-step${row}`, filter: 'eformsign' } },
  { eval: `(()=>{const u=documentUtil.getOpenDocUrl("${d.documentId}");location.href=u;return 'ok'})()` }, { wait: 16000 },
  { shot: `${E}/${tag}-step${row}-open.png` },
  { click: [418, y] }, { wait: 600 }, { type: `방문자${row}이름` },
  { click: [570, y] }, { wait: 600 }, { type: `010-000${row}-000${row}` },
  { click: [744, y] }, { wait: 600 }, { type: `목적${row}` },
  { click: [600, 760] }, { wait: 800 }, { shot: `${E}/${tag}-step${row}-filled.png` },
];
if (!process.argv.includes('--no-send')) steps.push({ click: [815, 865] }, { wait: 4000 }, { shot: `${E}/${tag}-step${row}-dialog.png` }, { click: (arg('--confirm', '861,636')).split(',').map(Number) }, { wait: 8000 }, { shot: `${E}/${tag}-step${row}-after-send.png` }, { eval: "document.body.innerText.slice(0,200)" });
console.log(JSON.stringify(steps));
