// 「작성 중 이탈」 상태 6종 매트릭스 — 헤드리스 CDP
//
// 🔴 이탈은 "텍스트를 치다 떠나는" 한 경로가 아니다. 방문자가 남기고 갈 수 있는 상태마다
//    (a) abandon 시간 뒤 흐림 + 카운트다운이 오고
//    (b) 카운트다운 만료 시 프레임이 통째로 다시 만들어져 **완전히 빈 서식**이 열리는지
//    를 확인한다. 케이스마다 리셋 전/후 스크린샷 2장을 남긴다.
//
// 사용:
//   CDP_PORT=9240 KIOSK_BASE=http://127.0.0.1:8699 \
//   KIOSK_QUERY='company=<id>&template=<id>' node tools/probe-abandon-matrix.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import { resolveCoords, passConsentGate, DEFAULT_ATTACH_CDP_PORT, warnReservedCdpPort } from './form-coords.mjs';
// 🔴 이 도구는 **이미 떠 있는** 헤드리스 크롬에 붙는다(직접 띄우지 않는다).
//    CDP 포트 기본값은 9240 으로 통일한다 — 8099~8599 는 정적 서버·다른 워커 대역이라
//    그 대역을 CDP_PORT 로 주면 기동 시 경고한다(2026-09-16).
const PORT = process.env.CDP_PORT || String(DEFAULT_ATTACH_CDP_PORT);
warnReservedCdpPort(PORT, 'probe-abandon-matrix');
const BASE = process.env.KIOSK_BASE || 'http://localhost:8099';
const OUT = process.env.KIOSK_OUT || 'D:/pjt/eformsign/kiosk-product/evidence/abandon-matrix';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const t = targets.find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise(r => ws.onopen = r);
const evalJs = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval fail');
  return r.result.value;
};
const shot = async (name, clip) => {
  const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip: { ...clip, scale: 1 } } : { format: 'png' });
  const buf = Buffer.from(r.data, 'base64');
  if (name) { fs.writeFileSync(`${OUT}/${name}.png`, buf); console.log('SHOT ' + name); }
  return buf;
};
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const drag = async (x0, y0, pts) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
  for (const [x, y] of pts) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' }); await sleep(40); }
  const [lx, ly] = pts[pts.length - 1];
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: lx, y: ly, button: 'left', clickCount: 1 });
};
const st = () => evalJs('JSON.stringify({session:__kioskState.session,phase:__kioskState.phase,engaged:__kioskIdle.engaged,src:__kioskIdle.source,warn:!document.getElementById("ovIdle").hidden})').then(JSON.parse);
const logs = () => evalJs('JSON.stringify(__kioskLog.slice(-60))').then(JSON.parse);
const waitFor = async (fn, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await st(); if (fn(v)) return v; await sleep(500); } return null; };
const sha = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

/** 🔴 제품 저장소의 config.js 는 회사·서식 ID 가 비어 있다 — 검증 때만 주입한다. */
const EXTRA = process.env.KIOSK_QUERY ? '&' + process.env.KIOSK_QUERY : '';
// abandon 20s / countdown 5s. debug 패널은 프레임 클릭을 가로채므로 쓰지 않는다.
const URL = `${BASE}/?idle=20&abandon=20&countdown=5`;

// 화면 좌표(768×1024 에뮬레이션 기준) — 서식마다 다르므로 해석기를 거친다.
//   기본값 → tools/form-profiles/<서식ID>.json → --coords <파일> → --<키>-x/-y → 환경변수
// 🔴 서식 중립: 이 파일에 좌표를 다시 하드코딩하지 않는다. 다른 서식을 검증하려면
//    프로필 파일을 하나 만들거나 KIOSK_COORDS 환경변수로 덮어쓴다.
const { coords: C, sources: COORD_SRC, templateId: FORM_ID, warnings: COORD_WARN } =
  resolveCoords({ argv: process.argv, env: process.env });
console.log('FORM ' + (FORM_ID || '(미지정)'));
console.log('COORDS ' + JSON.stringify(C) + ' ← ' + COORD_SRC.join(' → '));
COORD_WARN.forEach(w => console.warn('⚠️  ' + w));
const C_CONSENT = C.consent;      // 동의 체크박스 (프레임 안 첫 화면)
const C_CONTINUE = C.continue;    // 「계속」
const C_NAME = C.name;            // 첫 번째 입력칸
const C_PURPOSE = C.purpose;      // 아무 체크박스 하나
const C_SEND = C.send;            // 「전송」
const C_ZOOM_OUT = C.zoomOut;     // 뷰어 축소(−) — 휠 스크롤이 안 되므로 이것으로 아래쪽을 올린다
const C_SIGN_FIELD = C.signField; // 최소 배율(20%) 상태의 서명 칸
const [bcx, bcy, bcw, bch] = C.blankClip;
const CLIP_NAME = { x: bcx, y: bcy, width: bcw, height: bch };   // 첫 입력칸만 잘라 빈 서식 판정

const report = {};
await send('Page.enable', {});
await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });

/** 세션을 처음부터 열고, 필요하면 동의 화면을 통과시킨다. */
async function open({ passConsent = true } = {}) {
  await send('Page.navigate', { url: URL + EXTRA });
  await sleep(9000);
  // 동의 게이트 통과는 프로브 공용 절차다(form-coords.mjs) — 여기에 다시 적지 않는다.
  if (passConsent) {
    const g = await passConsentGate({ click, sleep, coords: C, cdpPort: PORT });
    console.log('  CONSENT gate=' + g.gate + ' clicked=' + g.clicked + (g.detail ? ' (' + g.detail.reason + ')' : ''));
  }
}

/** 일부 케이스만 돌리고 싶을 때: KIOSK_CASES=ab3,ab6 */
const ONLY = (process.env.KIOSK_CASES || '').split(',').map(x => x.trim()).filter(Boolean);

/** 이탈 상태를 만든 뒤 카운트다운 → 리셋 → 빈 서식까지 한 번에 검증한다. */
async function runCase(key, label, setup, opts = {}) {
  if (ONLY.length && !ONLY.includes(key)) return null;
  console.log(`\n── ${key}: ${label}`);
  await open({ passConsent: opts.passConsent !== false });
  // 이탈 직전의 "빈 서식" 기준선 — 아무 입력도 하기 전 첫 입력칸
  const blank = opts.passConsent === false ? null : sha(await shot(null, CLIP_NAME));
  await setup();
  await sleep(1200);
  const before = await st();
  await shot(`${key}-1-before`);
  const warn = await waitFor(v => v.warn === true, 40000);
  const warnShot = warn ? await shot(`${key}-2-countdown`) : null;
  const after = warn ? await waitFor(v => v.session > before.session, 20000) : null;
  if (after) await sleep(9000);                       // 새 프레임이 뜰 때까지
  await shot(`${key}-3-after-reset`);
  // 빈 서식 판정: 리셋 뒤 성명 칸 픽셀이 최초 빈 화면과 같은가
  let cleared = null;
  if (after && opts.passConsent !== false) {
    // 리셋 직후 화면은 동의 화면이므로 동일 절차로 본문까지 들어간 뒤 비교한다
    await passConsentGate({ click, sleep, coords: C, cdpPort: PORT });
    const now = sha(await shot(null, CLIP_NAME));
    cleared = now === blank;
    await shot(`${key}-4-next-visitor-blank`);
  } else if (after) {
    cleared = true;   // 동의 화면 자체가 초기 상태
  }
  const resetLog = (await logs()).filter(l => /무응답 리셋 실행/.test(l));
  report[key] = {
    label, before, warn, after, blankSha: blank, cleared,
    resetLogCount: resetLog.length, resetLog,
    pass: !!warn && !!after && cleared !== false && resetLog.length >= 1,
  };
  console.log(`   warn=${!!warn} reset=${!!after} blank=${cleared} pass=${report[key].pass}`);
  return report[key];
}

// ── 1. 글자 몇 개만 치고 이탈
await runCase('ab1', '글자 몇 개만 치고 이탈', async () => {
  await click(...C_NAME); await sleep(800);
  await send('Input.insertText', { text: 'ㄱ' });
});

// ── 2. 체크박스 하나만 누르고 이탈
await runCase('ab2', '체크박스 하나만 누르고 이탈', async () => {
  await click(...C_PURPOSE);
});

// ── 3. 서명 패드에 선 하나만 그리고 이탈 (모달을 연 채로 둔다)
//    🔴 OZ 뷰어는 마우스 휠로 스크롤되지 않는다. 서명 칸을 화면에 올리려면 **축소 버튼**을 쓴다
//       (최소 배율 20% 에서 한 페이지가 통째로 보인다).
await runCase('ab3', '서명 패드에 선 하나 그리고 이탈(모달 열린 채)', async () => {
  // 🔴 뷰어는 재렌더 중의 축소 클릭을 조용히 삼킨다 — "n번 누르면 n단계"가 성립하지 않는다.
  //    그래서 **최소 배율(20%)까지 충분히 눌러** 좌표를 결정론적으로 만든다(몇 번 삼켜져도 결과 동일).
  //    축소 클릭은 부모 pointerdown 이므로 이 동안 무응답 타이머는 리셋된다.
  await sleep(4000);
  for (let i = 0; i < 20; i++) { await click(...C_ZOOM_OUT); await sleep(1500); }
  await click(...C_SIGN_FIELD); await sleep(4000);                // 「서명」 모달
  await drag(160, 560, [[260, 480], [360, 620], [460, 500], [560, 590]]);   // 모달 캔버스 안
  await sleep(1200);
});

// ── 4. 동의 체크만 하고 「계속」을 안 누르고 이탈 (프레임 첫 화면)
await runCase('ab4', '동의 체크만 하고 계속 안 누르고 이탈', async () => {
  await click(...C_CONSENT);
}, { passConsent: false });

// ── 5. 전송 확인 팝업이 열린 상태로 이탈 (제약 5 — 팝업은 프레임 안)
//    리셋 뒤 문서가 실제로 만들어졌는지는 이 프로브 밖에서 문서함으로 확인한다.
await runCase('ab5', '전송 확인 팝업이 열린 채 이탈', async () => {
  await click(...C_NAME); await sleep(800);
  for (const ch of '이탈팝업') { await send('Input.insertText', { text: ch }); await sleep(120); }
  await click(...C_PURPOSE); await sleep(600);
  await click(...C_SEND); await sleep(3000);                      // 전송 확인 팝업
});

// ── 6. 입력 없이 화면만 움직이고 이탈
//    🔴 OZ 뷰어는 마우스 휠에 반응하지 않는다(실측). 방문자가 실제로 화면을 움직이는 수단인
//       축소 버튼과 뷰어 오른쪽 스크롤바 드래그를 함께 쓴다.
await runCase('ab6', '입력 없이 화면만 움직이고 이탈(축소·스크롤바)', async () => {
  await click(...C_ZOOM_OUT); await sleep(1500);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 600, deltaX: 0, deltaY: 600 });
  await sleep(600);
  await drag(760, 400, [[760, 520], [760, 640]]);   // 뷰어 오른쪽 스크롤바
  await sleep(800);
});

const summary = Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.pass]));
console.log('\n' + JSON.stringify(summary));
fs.writeFileSync(`${OUT}/abandon-matrix-report.json`, JSON.stringify(report, null, 1));
const allPass = Object.keys(report).length > 0 && Object.values(report).every(v => v.pass);
console.log('ALL_PASS=' + allPass);
ws.close();
process.exit(allPass ? 0 : 1);
