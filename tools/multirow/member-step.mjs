// Generate a drive.mjs steps file that opens a member-variant doc from 진행 중 문서함 (logged-in session),
// captures viewer network bodies, fills row <row> (+ signature with --sign) and sends.
// node member-step.mjs --doc <doc.json> --row N --ev <evidence dir> [--tag a] [--sign] [--send x,y] [--confirm auto|none|x,y] [--no-send] > steps.json
// --send   : 헤더/하단 전송 버튼. 기본 815,865 (v3); OZR REQUIRED 트래커가 있는 v5+ 는 하단 793,865.
// --confirm: 「문서 전송」 확인창의 전송 버튼.
//   auto (기본) = 확인창 문구가 보일 때만 클릭(drive clickIf). 템플릿 quick_processing=true(「문서 전송 시 팝업 생략」)면
//          확인창 없이 바로 「문서가 전송되었습니다」 → 클릭 안 함(2026-09-28 v7 실측). 좌표: 수신자 입력칸 없는 창 861,636 /
//          다음 수신자 입력칸이 있는 창(수신자 미정 단계가 남음) 862,693 / 마지막 단계 862,543 (--confirm-at 로 지정).
//   none = 클릭 안 함, x,y = 무조건 그 좌표 클릭(v6 이전 방식).
import fs from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const xy = (s) => s.split(',').map(Number);
const d = JSON.parse(fs.readFileSync(arg('--doc'), 'utf8'));
const row = Number(arg('--row')); const E = arg('--ev'); const tag = arg('--tag', 'a');
const y = 355 + (row - 1) * 85;
const text = "document.body.innerText.split(String.fromCharCode(10)).join(' | ').slice(0,300)";
const steps = [
  { size: [1280, 900] },
  { nav: 'https://www.eformsign.com/eform/document/document_list.html?mode=ip' }, { wait: 6000 },
  { net: { dir: `${E}/net-${tag}-step${row}`, filter: 'eformsign' } },
  { eval: `(()=>{const u=documentUtil.getOpenDocUrl("${d.documentId}");location.href=u;return 'ok'})()` }, { wait: 16000 },
  { shot: `${E}/${tag}-step${row}-open.png` },
  { click: [418, y] }, { wait: 600 }, { type: `방문자${row}이름` },
  { click: [570, y] }, { wait: 600 }, { type: `010-000${row}-000${row}` },
  { click: [744, y] }, { wait: 600 }, { type: `목적${row}` },
];
// signature pad: open, draw, confirm (1087,788) — measured on v6
if (process.argv.includes('--sign')) steps.push({ click: [905, y] }, { wait: 2000 }, { drag: [[300, 450], [350, 380], [400, 500], [450, 400], [520, 480], [600, 420], [680, 470]] }, { wait: 500 }, { click: [1087, 788] }, { wait: 1500 });
else steps.push({ click: [600, 760] }, { wait: 800 });
steps.push({ shot: `${E}/${tag}-step${row}-filled.png` }, { eval: text });
if (!process.argv.includes('--no-send')) {
  steps.push({ click: xy(arg('--send', '815,865')) }, { wait: 3500 }, { shot: `${E}/${tag}-step${row}-dialog.png` }, { eval: text });
  const cf = arg('--confirm', 'auto');
  if (cf === 'auto') steps.push({ clickIf: { re: '메시지|수신자 정보 미입력|건너뛰게', at: xy(arg('--confirm-at', '861,636')) } });
  else if (cf !== 'none') steps.push({ click: xy(cf) });
  steps.push({ wait: 8000 }, { shot: `${E}/${tag}-step${row}-after-send.png` });
}
console.log(JSON.stringify(steps));
