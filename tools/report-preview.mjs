#!/usr/bin/env node
/**
 * 리포트 화면(report.html) 로컬 미리보기 — 키 없이 4가지 상태를 그대로 띄운다.
 *
 *   node tools/report-preview.mjs                      실제 api/report.mjs 를 그대로 호출(설정값에 따라 404/401/500)
 *   node tools/report-preview.mjs --state ok           표본 응답으로 정상 화면 (이폼사인을 부르지 않는다)
 *   node tools/report-preview.mjs --state empty        정상이지만 문서 0건
 *   node tools/report-preview.mjs --state disabled     404 report_disabled
 *   node tools/report-preview.mjs --state unauthorized 401 unauthorized
 *   node tools/report-preview.mjs --state error        500 (연결 열쇠 없음)
 *   옵션: --port 5179 · --secret <값>(화면에 넣을 암호. 기본 preview)
 *         --env <파일>   KEY=VALUE 파일을 이 프로세스 환경에만 올린다(값은 어디에도 찍지 않는다)
 *
 * 🔴 --state 는 화면 확인용 표본이다. 실제 기록이 아니다.
 * 🔴 자격 증명을 묻지도, 저장하지도 않는다. 실데이터로 보려면 --state 없이 띄우고
 *    api/report.mjs 가 요구하는 설정값을 프로세스 환경에 직접 넣는다.
 * 의존성 0 — Node 내장 모듈만 쓴다.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PORT = Number(arg('port', 5179));
const STATE = arg('state', '');
const SECRET = arg('secret', 'preview');
const ENV_FILE = arg('env', '');

/** KEY=VALUE 파일을 process.env 로 올린다. 🔴 값은 반환하지도 출력하지도 않는다. */
function loadEnvFile(file) {
  const p = resolve(file);
  if (!existsSync(p)) { console.error(`설정 파일을 찾지 못했습니다: ${p}`); process.exit(3); }
  const names = [];
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || /^\s*#/.test(line)) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    // 예시 파일이 `KEY=<발급값>` 꼴이라 꺾쇠를 지우지 않고 붙여 넣는 일이 잦다. 감싼 꺾쇠만 벗긴다.
    let unwrapped = false;
    if (v.length > 1 && v.startsWith('<') && v.endsWith('>')) { v = v.slice(1, -1).trim(); unwrapped = true; }
    process.env[m[1]] = v;
    names.push(unwrapped ? `${m[1]}(꺾쇠 벗김)` : m[1]);
  }
  return names; // 이름만. 값은 절대 돌려주지 않는다.
}
const ENV_NAMES = ENV_FILE ? loadEnvFile(ENV_FILE) : [];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

/** 표본 응답 — api/report.mjs 의 응답과 **모양만** 같다. 값은 전부 지어낸 것이다. */
function sample({ empty = false } = {}) {
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const people = [
    ['홍길동', '한빛디자인', '미팅', 3], ['김영희', '미래로컨설팅', '자재 납품', 2],
    ['박민수', '대한물류', '정기 점검', 4], ['이수진', '세종테크', '면접', 2],
    ['정우성', '한울건설', '미팅', 3], ['최지훈', '나눔파트너스', '시설 점검', 2],
    ['서은채', '가온소프트', '미팅', 5],
  ];
  const rows = empty ? [] : people.map(([name, org, why, min], i) => ({
    month: day(i % 4).slice(0, 7),
    done_date: day(i % 4),
    doc_name: `방문자 기록 - ${name}`,
    template_name: '방문자 기록부',
    minutes: min,
    fields: { 성명: name, 소속: org, 방문목적: why, 연락처: '010-****-****', 서명: '있음' },
  }));
  const byDate = {}; const byMonth = {};
  for (const r of rows) {
    byDate[r.done_date] = (byDate[r.done_date] || 0) + 1;
    byMonth[r.month] = (byMonth[r.month] || 0) + 1;
  }
  return {
    ok: true, sample: true,
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

const CANNED = {
  ok: [200, () => sample()],
  empty: [200, () => sample({ empty: true })],
  disabled: [404, () => ({ ok: false, reason: 'report_disabled', message: '리포트 옵션이 꺼져 있습니다.' })],
  unauthorized: [401, () => ({ ok: false, reason: 'unauthorized', message: 'Vercel 크론이 아니거나 secret 이 맞지 않습니다.' })],
  error: [500, () => ({ ok: false, reason: 'error', message: 'EFORMSIGN_API_KEY 가 없습니다.' })],
};

let liveHandler = null;
if (!STATE) {
  const p = join(ROOT, 'api', 'report.mjs');
  if (!existsSync(p)) { console.error(`리포트 함수를 찾지 못했습니다: ${p}`); process.exit(1); }
  ({ default: liveHandler } = await import(pathToFileURL(p).href));
}
if (STATE && !CANNED[STATE]) {
  console.error(`--state 는 ${Object.keys(CANNED).join(' · ')} 중 하나여야 합니다.`);
  process.exit(2);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/api/report') {
    if (STATE) {
      const [status, make] = CANNED[STATE];
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify(make(), null, 2));
    }
    return liveHandler(req, res);
  }
  const rel = url.pathname === '/' ? '/report.html' : url.pathname;
  const file = join(ROOT, rel.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
  const ext = rel.slice(rel.lastIndexOf('.'));
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(readFileSync(file));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('리포트 화면 미리보기');
  console.log(`  화면   http://127.0.0.1:${PORT}/`);
  console.log(`  상태   ${STATE ? `${STATE} (표본 — 실제 기록 아님)` : '실제 api/report.mjs 호출'}`);
  if (ENV_NAMES.length) console.log(`  설정   ${ENV_NAMES.map((n) => `${n}: 설정됨`).join(' · ')}`);
  console.log(`  암호   ${SECRET}  ← 화면의 암호 칸에 넣으세요${STATE ? ' (표본 모드는 아무 값이나 통과합니다)' : ''}`);
});
