/**
 * 키오스크 래퍼 실기 검증 — (A) 즉시 복귀 / (B) 감사 화면 후 복귀 를 연속 2회 돌린다.
 * node verify-kiosk.mjs --port 9240 --mode immediate|thanks --rounds 2 --name 홍길동
 * 좌표는 768x1024 태블릿 뷰포트 기준.
 *
 * 🔴 서식 항목이 바뀌면 좌표가 어긋난다(2026-09-16).
 *    작성 프레임은 다른 도메인의 iframe 이고 그 안의 OZ 뷰어는 입력칸을 DOM 으로 노출하지
 *    않는다 — 즉 **입력칸 위치를 자동으로 찾아낼 방법이 없다**(실측 부정 결과).
 *    그래서 좌표를 코드에서 빼내 옵션으로 만든다. 서식을 고친 고객은 다음 중 하나를 쓴다.
 *      · 값 입력을 건너뛴다:            --notype        ← 항목 변경과 무관하게 항상 동작
 *      · 좌표를 직접 준다:              --name-x 480 --name-y 464 --org-x 520 --org-y 518
 *      · 좌표 묶음을 파일로 준다:        --coords <json>   (키: consent, continue, name, org, send, popup1, popup2)
 *    좌표 잡는 법은 README 「서식을 고친 뒤」 절.
 */
import fs from 'node:fs';
import { resolveCoords, passConsentGate, DEFAULT_ATTACH_CDP_PORT, warnReservedCdpPort } from './form-coords.mjs';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
// 🔴 이 도구는 **이미 떠 있는** 헤드리스 크롬에 붙는다(직접 띄우지 않는다).
//    CDP 포트 기본값은 9240 으로 통일한다 — 8099~8599 는 정적 서버·다른 워커 대역이라
//    그 대역을 --port 로 주면 기동 시 경고한다(2026-09-16).
const PORT = arg('port', String(DEFAULT_ATTACH_CDP_PORT));
warnReservedCdpPort(PORT, 'verify-kiosk');
const MODE = arg('mode', 'immediate');
const ROUNDS = Number(arg('rounds', '2'));
const BASE = arg('base', 'http://localhost:8099');
/** 🔴 제품 저장소의 config.js 는 회사·서식 ID 가 비어 있다.
 *  검증할 때만 URL 쿼리로 주입한다(저장소 파일에 고객/자사 ID 를 남기지 않기 위해서).
 *  --company <id> --template <id>  또는 환경변수 KIOSK_QUERY="company=..&template=.."
 */
const EXTRA = (() => {
  const parts = ['company', 'template'].map(k => {
    const v = arg(k, '');
    return v ? k + '=' + encodeURIComponent(v) : '';
  }).filter(Boolean);
  if (!parts.length && process.env.KIOSK_QUERY) parts.push(process.env.KIOSK_QUERY);
  return parts.length ? '&' + parts.join('&') : '';
})();
const EV = arg('ev', 'D:/pjt/eformsign/kiosk-product/evidence');

/** 클릭 좌표 — 해석 규칙은 form-coords.mjs 한 곳에 둔다(프로브들과 공용). */
const { coords: COORDS, sources: COORD_SRC, warnings: COORD_WARN } = resolveCoords({ argv: process.argv, env: process.env });
const TAG = MODE === 'immediate' ? 'A' : 'B';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const t = targets.find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise(r => ws.onopen = r);

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result.value;
};
const click = async (x, y, wait = 1200) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(wait);
};
/** OZ 뷰어의 입력칸은 insertText 만으로는 값이 들어가지 않는다 — 실제 키 이벤트까지 함께 보낸다.
 *  🔴 keyDown 에 text 를 실으면 char 이벤트와 함께 **두 번** 입력된다(2026-09-16 실측:
 *     "ORIGIN검증" → "OORRIIGGIINN검검증증"). keyDown 은 키만, 실제 문자는 char 로 보낸다. */
const type = async (s) => {
  for (const ch of s) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch });
    await send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch, key: ch });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(60);
  }
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(EV, { recursive: true });
  fs.writeFileSync(`${EV}/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log('  shot ' + name);
};
const waitFor = async (expr, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evalJs(expr)) return true; await sleep(500); }
  throw new Error('TIMEOUT waiting ' + (label || expr));
};

await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
await send('Page.enable', {});
await send('Page.navigate', { url: `${BASE}/?idle=0&mode=${MODE}&sec=4${EXTRA}` });
await sleep(3000);

console.log('COORDS ' + JSON.stringify(COORDS) + ' via ' + COORD_SRC.join(','));
COORD_WARN.forEach(w => console.warn('⚠️  ' + w));
const results = [];
for (let round = 1; round <= ROUNDS; round++) {
  const visitor = arg('name', '방문객') + round;
  console.log(`\n== ${TAG} round ${round} (${visitor}) ==`);

  await waitFor("window.__kioskState && window.__kioskState.phase === 'form'", 40000, 'phase=form');
  await sleep(1000);
  // 작성 화면이 완전히 뜰 때까지: 동의 게이트가 보이면 통과
  await sleep(9000);
  await shot(`${TAG}-r${round}-1-blank-form`);

  // 이전 회차의 입력값이 남아 있지 않은지: 성명 칸을 캡처로 남긴다(위 스크린샷)
  // 동의 게이트(동의 체크 → 계속) 통과는 프로브와 공용 절차다 — form-coords.mjs 한 곳에 있다.
  const gate = await passConsentGate({ click: (x, y) => click(x, y, 0), sleep, coords: COORDS, consentWait: 1200, continueWait: 9000, cdpPort: PORT });
  console.log('  CONSENT gate=' + gate.gate + ' clicked=' + gate.clicked + (gate.detail ? ' (' + gate.detail.reason + ')' : ''));
  await shot(`${TAG}-r${round}-2-editable`);

  if (!process.argv.includes('--notype')) {
    await click(COORDS.name[0], COORDS.name[1], 1500);   // 첫 번째 텍스트 입력칸
    await type(visitor);
    await sleep(800);
    await click(COORDS.org[0], COORDS.org[1], 1200);     // 두 번째 텍스트 입력칸
    await type('검증팀');
    await sleep(1200);
  }
  await shot(`${TAG}-r${round}-3-filled`);

  const before = await evalJs('window.__kioskState.submits');
  await click(COORDS.send[0], COORDS.send[1], 6000);     // 전송
  await shot(`${TAG}-r${round}-4-send-clicked`);

  // 확인 팝업(문서 전송)의 전송 버튼. reCAPTCHA 유무로 팝업 높이가 달라지므로 두 위치를 모두 누른다.
  await click(COORDS.popup1[0], COORDS.popup1[1], 3000);
  if (!(await evalJs(`window.__kioskState.submits > ${before}`))) await click(COORDS.popup2[0], COORDS.popup2[1], 4000);

  await waitFor(`window.__kioskState.submits > ${before}`, 60000, '제출 감지');
  const docs = await evalJs('JSON.stringify(window.__kioskState.docs)');
  console.log('  document_id:', docs);

  if (MODE === 'thanks') {
    await waitFor("window.__kioskState.phase === 'thanks'", 8000, 'phase=thanks');
    await shot(`${TAG}-r${round}-5-thanks`);
    const t0 = Date.now();
    await waitFor("window.__kioskState.phase !== 'thanks'", 15000, 'thanks 종료');
    console.log('  감사 화면 노출:', ((Date.now() - t0) / 1000).toFixed(1) + '초 (설정 4초)');
  }
  await waitFor("window.__kioskState.phase === 'form'", 40000, '새 작성 화면');
  await sleep(9000);
  await shot(`${TAG}-r${round}-6-next-visitor-blank`);
  results.push({ round, docs: JSON.parse(docs) });
}

console.log('\nLOG TAIL:\n' + (await evalJs('window.__kioskLog.slice(-25).join("\\n")')));
console.log('\nRESULT ' + JSON.stringify(results));
ws.close();
