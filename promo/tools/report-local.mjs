#!/usr/bin/env node
/**
 * 리포트(유료 옵션) 로컬 뷰어 — 홍보영상 실화면 E 촬영용
 *
 * 왜 필요한가
 *   상품 「이폼사인 방명록」의 리포트 옵션은 **JSON 을 돌려주는 서버리스 함수 하나**(`api/report.mjs`)다.
 *   사람이 보는 리포트 **화면(HTML)은 상품에 없다** — 결과는 웹훅·메일로 나간다.
 *   영상 35–46초 구간의 「리포트」 컷을 찍으려면 볼 화면이 필요하므로,
 *   이 도구가 **상품 코드를 그대로 호출**해서 그 JSON 을 표로 그려 준다.
 *   🔴 표의 숫자·열은 전부 상품 함수의 응답 그대로다. 목업이 아니다.
 *   🔴 반대로 이 뷰어의 **디자인은 상품 화면이 아니다.** 영상 자막에 「리포트(옵션)」 각주가 필요하다.
 *
 * 쓰는 법
 *   1) `.local/report.env.example` 을 `.local/report.env` 로 복사한다.
 *   2) 🔴 **값은 사람이 직접 넣는다.** (API 키·개인키는 이폼사인 회사 관리 > API 관리에서 발급)
 *   3) node tools/report-local.mjs            → http://127.0.0.1:5178
 *      node tools/report-local.mjs --port 5200 --env .local/report.env
 *      node tools/report-local.mjs --product D:/pjt/eformsign-guestbook
 *
 * 키가 없어도 뜬다 — 상품이 돌려주는 `404 report_disabled` / `401 unauthorized` 를
 * 그대로 빈 상태로 보여 준다(그 화면도 촬영 소재가 된다).
 *
 * 이 파일은 로컬 촬영 보조 도구다. 상품 저장소(eformsign-guestbook)는 건드리지 않는다.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ── 인자 ──
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PORT = Number(arg('port', 5178));
const ENV_FILE = resolve(arg('env', '.local/report.env'));
const PRODUCT_DIR = resolve(arg('product', process.env.KIOSK_PRODUCT_DIR || 'D:/pjt/eformsign-guestbook'));
// --demo : 이폼사인을 부르지 않고 **표본 데이터**로 표만 그린다(레이아웃 검토·자리잡기용).
// 🔴 이 화면은 영상에 쓰지 않는다. 영상용 실화면은 키를 넣고 --demo 없이 찍는다.
const DEMO = argv.includes('--demo');

// ── .env 읽기 (의존성 0) ──
function loadEnv(file) {
  if (!existsSync(file)) return { loaded: false, keys: [] };
  const keys = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!k || v === '') continue;          // 값이 빈 줄은 안 넣는다(example 파일을 그대로 써도 되게)
    process.env[k] = v;
    keys.push(k);
  }
  return { loaded: true, keys };
}

const envInfo = loadEnv(ENV_FILE);

// ── 상품의 리포트 함수를 그대로 불러온다 ──
const HANDLER_PATH = join(PRODUCT_DIR, 'api', 'report.mjs');
if (!existsSync(HANDLER_PATH)) {
  console.error(`상품의 리포트 함수를 찾지 못했습니다: ${HANDLER_PATH}`);
  console.error('--product <상품 저장소 경로> 로 알려 주세요.');
  process.exit(1);
}
const { default: reportHandler } = await import(pathToFileURL(HANDLER_PATH).href);

const SECRET = process.env.REPORT_SECRET || '';
const ENABLED = String(process.env.KIOSK_REPORT_ENABLED || '').toLowerCase() === 'true';

/** --demo 용 표본 — 상품 응답과 **모양만** 같다. 값은 전부 지어낸 것이다. */
function demoReport() {
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const people = [
    ['홍길동', '한빛디자인', 3], ['김영희', '미래로컨설팅', 2], ['박민수', '대한물류', 4],
    ['이수진', '세종테크', 2], ['정우성', '한울건설', 3], ['최지훈', '나눔파트너스', 2],
  ];
  const rows = people.map(([name, org, min], i) => ({
    month: day(i % 3).slice(0, 7),
    done_date: day(i % 3),
    doc_name: `방문자 기록 - ${name}`,
    template_name: '방문자 기록(영상용)',
    minutes: min,
    fields: { 성명: name, 소속: org, 방문목적: '미팅', 연락처: '010-****-****', 서명: '있음' },
  }));
  const byDate = {}; const byMonth = {};
  for (const r of rows) { byDate[r.done_date] = (byDate[r.done_date] || 0) + 1; byMonth[r.month] = (byMonth[r.month] || 0) + 1; }
  return {
    ok: true, demo: true,
    generated_at: new Date().toISOString(),
    period: { days: 7, start: day(6), end: day(0) },
    scanned: rows.length, pages: 1, truncated: false,
    columns: [
      { key: 'done_date', label: '완료일' }, { key: 'doc_name', label: '문서 이름' },
      { key: 'template_name', label: '서식 이름' }, { key: 'minutes', label: '처리시간(분)' },
      ...['성명', '소속', '방문목적', '연락처', '서명'].map((id) => ({ key: `fields.${id}`, label: id, source: 'form' })),
    ],
    summary: { total: rows.length, byDate, byMonth },
    rows,
  };
}

// ── 촬영용 화면 ──
const PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>완료 문서 리포트</title>
<style>
  :root { --bg:#f5f7fa; --card:#fff; --line:#e3e8ef; --ink:#1b2430; --dim:#667085; --accent:#1f6feb; }
  * { box-sizing: border-box; }
  html, body { margin:0; background:var(--bg); color:var(--ink);
    font-family: Pretendard, "Malgun Gothic", system-ui, sans-serif;
    word-break: keep-all; overflow-wrap: break-word; line-break: strict; }
  .wrap { max-width: 1280px; margin: 0 auto; padding: 40px 24px 64px; }
  header { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:24px; }
  h1 { font-size:28px; margin:0; letter-spacing:-.01em; }
  .period { color:var(--dim); font-size:15px; white-space:nowrap; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; margin-bottom:28px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px 22px; }
  .card .k { color:var(--dim); font-size:14px; margin-bottom:8px; }
  .card .v { font-size:34px; font-weight:700; letter-spacing:-.02em; }
  .card .v small { font-size:16px; font-weight:500; color:var(--dim); margin-left:4px; }
  .panel { background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; margin-bottom:24px; }
  .panel h2 { font-size:16px; margin:0; padding:16px 22px; border-bottom:1px solid var(--line); }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { padding:12px 16px; text-align:left; border-bottom:1px solid var(--line); white-space:nowrap; }
  th { color:var(--dim); font-weight:600; background:#fafbfc; }
  tr:last-child td { border-bottom:0; }
  .bars { padding:18px 22px; display:grid; gap:10px; }
  .bar { display:grid; grid-template-columns:110px 1fr 56px; align-items:center; gap:12px; font-size:14px; }
  .bar i { display:block; height:14px; border-radius:7px; background:var(--accent); min-width:4px; }
  .bar b { text-align:right; font-weight:600; }
  .note { color:var(--dim); font-size:13px; margin-top:8px; }
  .empty { padding:56px 22px; text-align:center; color:var(--dim); }
  .empty strong { display:block; color:var(--ink); font-size:18px; margin-bottom:10px; }
  .demoBar { background:#fff4d6; border:1px solid #e6c65c; color:#7a5a00; border-radius:10px;
    padding:12px 18px; margin-bottom:20px; font-size:14px; font-weight:600; }
  code { background:#eef1f5; border-radius:5px; padding:2px 6px; font-size:13px; }
</style>
</head>
<body>
<div class="wrap" id="app"><div class="panel"><div class="empty">불러오는 중…</div></div></div>
<script>
const SECRET = ${JSON.stringify(SECRET)};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function barBlock(title, obj) {
  const rows = Object.entries(obj || {}).sort();
  if (!rows.length) return '';
  const max = Math.max(...rows.map(([, n]) => n), 1);
  return '<section class="panel"><h2>' + title + '</h2><div class="bars">' +
    rows.map(([k, n]) =>
      '<div class="bar"><span>' + esc(k) + '</span><i style="width:' +
      Math.round((n / max) * 100) + '%"></i><b>' + n + '건</b></div>').join('') +
    '</div></section>';
}

function cellOf(row, col) {
  if (col.key.indexOf('fields.') === 0) return (row.fields || {})[col.key.slice(7)] ?? '';
  return row[col.key] ?? '';
}

function render(r) {
  const app = document.getElementById('app');
  if (!r || r.ok !== true) {
    const reason = r && r.reason;
    const guide = reason === 'report_disabled'
      ? '<code>.local/report.env</code> 에 <code>KIOSK_REPORT_ENABLED=true</code> 를 넣으세요.'
      : reason === 'unauthorized'
      ? '<code>REPORT_SECRET</code> 값이 필요합니다.'
      : esc((r && r.message) || '알 수 없는 오류');
    app.innerHTML = '<header><h1>완료 문서 리포트</h1></header>' +
      '<div class="panel"><div class="empty"><strong>아직 볼 기록이 없습니다</strong>' + guide + '</div></div>';
    return;
  }
  const cols = r.columns || [];
  const rows = r.rows || [];
  const days = Object.keys(r.summary.byDate || {}).length;
  const avg = rows.length ? Math.round(rows.reduce((a, x) => a + (x.minutes || 0), 0) / rows.length) : 0;
  app.innerHTML =
    (r.demo ? '<div class="demoBar">표본 데이터입니다 — 레이아웃 확인용. 영상에 쓰지 마세요.</div>' : '') +
    '<header><h1>완료 문서 리포트</h1><span class="period">' +
      esc(r.period.start) + ' ~ ' + esc(r.period.end) + ' (' + r.period.days + '일)</span></header>' +
    '<div class="cards">' +
      '<div class="card"><div class="k">완료 문서</div><div class="v">' + r.summary.total + '<small>건</small></div></div>' +
      '<div class="card"><div class="k">기록이 있는 날</div><div class="v">' + days + '<small>일</small></div></div>' +
      '<div class="card"><div class="k">평균 작성 시간</div><div class="v">' + avg + '<small>분</small></div></div>' +
      '<div class="card"><div class="k">표 열</div><div class="v">' + cols.length + '<small>개</small></div></div>' +
    '</div>' +
    barBlock('일자별', r.summary.byDate) +
    barBlock('월별', r.summary.byMonth) +
    (rows.length
      ? '<section class="panel"><h2>문서별</h2><table><thead><tr>' +
          cols.map((c) => '<th>' + esc(c.label) + '</th>').join('') +
        '</tr></thead><tbody>' +
          rows.map((row) => '<tr>' + cols.map((c) => '<td>' + esc(cellOf(row, c)) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></section>'
      : '<div class="panel"><div class="empty"><strong>기간 안에 완료된 문서가 없습니다</strong>조회 기간(<code>KIOSK_REPORT_DAYS</code>)을 늘려 보세요.</div></div>') +
    '<p class="note">열 구성은 서식 항목에서 그때그때 만들어집니다. ' +
      '항목 값은 <code>KIOSK_REPORT_FIELD_VALUES=on</code> 일 때만 실립니다.</p>';
}

fetch('/api/report' + (SECRET ? '?secret=' + encodeURIComponent(SECRET) : ''))
  .then((res) => res.json())
  .then(render)
  .catch((e) => render({ ok: false, message: String(e) }));
</script>
</body>
</html>`;

// ── 서버 ──
const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/api/report') {
    if (DEMO) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify(demoReport(), null, 2));
    }
    return reportHandler(req, res);
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(PAGE);
  }
  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const mask = (k) => (process.env[k] ? '설정됨' : '없음');
  console.log('리포트 로컬 뷰어');
  console.log(`  화면      http://127.0.0.1:${PORT}/`);
  console.log(`  원본 JSON http://127.0.0.1:${PORT}/api/report${SECRET ? '?secret=<REPORT_SECRET>' : ''}`);
  console.log(`  상품 코드 ${HANDLER_PATH}`);
  console.log(`  설정 파일 ${ENV_FILE} ${envInfo.loaded ? `(변수 ${envInfo.keys.length}개)` : '(없음 — 키 없이 빈 상태로 뜹니다)'}`);
  console.log(`  옵션 켜짐 ${ENABLED ? '예' : '아니오 (KIOSK_REPORT_ENABLED=true 아님)'}`);
  console.log(`  API 키 ${mask('EFORMSIGN_API_KEY')} · 개인키 ${mask('EFORMSIGN_PRIVATE_KEY')} · 시크릿 ${mask('REPORT_SECRET')}`);
  console.log('  (값 자체는 출력하지 않습니다)');
  if (DEMO) console.log('  🔴 --demo — 표본 데이터. 이폼사인을 부르지 않습니다. 영상에 쓰지 마세요.');
});
