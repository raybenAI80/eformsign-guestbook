// 누적형 옵션(api/multirow.mjs) 로컬 검증 도구 — 핸들러를 그대로 불러 쓴다(배포 없이).
//
//   node --env-file=.local/report.env tools/multirow-option/probe.mjs --template-name "<서식 이름>" [--rows 2] call [--last <id>]
//   node --env-file=.local/report.env tools/multirow-option/probe.mjs --template-name "<서식 이름>" [--rows 2] serve [--port 8699]
//
// - 서식 ID 는 이름으로 목록 조회해 런타임에만 쓴다(저장소에 남기지 않는다).
// - KIOSK_MULTIROW_EMAIL 이 없으면 EFORMSIGN_MEMBER_ID 를 자리표시 주소 바탕으로 쓴다(+v<k> 로 갈라짐).
// - 출력은 ID·토큰을 가린다. --save <file> 을 주면 가리지 않은 응답을 그 파일(.local 아래 권장)에 쓴다.
// - serve: 저장소 루트를 정적 서빙 + /api/multirow 를 이 핸들러로 연결, /config.js 는 docMode:'multirow' 로 대체.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueToken } from '../../api/lib/eformsign-report.mjs';
import handler from '../../api/multirow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const cmd = argv.find((a) => a === 'call' || a === 'serve' || a === 'plan' || a === 'doc' || a === 'create') || 'call';
const env = process.env;

env.KIOSK_MULTIROW_ENABLED = env.KIOSK_MULTIROW_ENABLED || 'true';
if (arg('--rows')) env.KIOSK_MULTIROW_ROWS = arg('--rows');
if (!env.KIOSK_MULTIROW_EMAIL) env.KIOSK_MULTIROW_EMAIL = env.EFORMSIGN_MEMBER_ID || '';
if (arg('--template-name')) {
  const { accessToken, apiUrl } = await issueToken({ apiKey: env.EFORMSIGN_API_KEY, privateKey: env.EFORMSIGN_PRIVATE_KEY, memberId: env.EFORMSIGN_MEMBER_ID });
  const r = await (await fetch(`${apiUrl}/v2.0/api/forms`, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
  const t = (r.templates || []).find((x) => x.name === arg('--template-name'));
  if (!t) { console.error('서식을 이름으로 찾지 못했습니다:', arg('--template-name')); process.exit(2); }
  env.KIOSK_MULTIROW_FORM_ID = t.form_id || t.id;
  console.log('template: found by name');
}

export const redact = (o) => JSON.stringify(o).replace(/[0-9a-f]{32}/gi, '<id>').replace(/"(token_id|external_token)":"[^"]+"/g, '"$1":"<present>"');

async function call(query = '', headers = {}) {
  return new Promise((resolve) => {
    const req = { method: 'GET', url: '/api/multirow' + query, headers: { host: 'localhost', ...headers } };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, headers: this.headers, body: JSON.parse(b) }); } };
    handler(req, res);
  });
}

if (cmd === 'plan') {
  // 읽기 전용: 서식에서 방문자 단계 수·설정 경고를 읽는다(문서를 만들지 않는다).
  const { readTemplatePlan } = await import('../../api/lib/eformsign-multirow.mjs');
  const { accessToken, apiUrl } = await issueToken({ apiKey: env.EFORMSIGN_API_KEY, privateKey: env.EFORMSIGN_PRIVATE_KEY, memberId: env.EFORMSIGN_MEMBER_ID });
  const t = await (await fetch(`${apiUrl}/v2.0/api/forms/${env.KIOSK_MULTIROW_FORM_ID}?is_include_config=true`, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
  const p = readTemplatePlan(t);
  console.log(JSON.stringify({ rows: p.stepNames.length, stepNames: p.stepNames, warnings: p.warnings }));
} else if (cmd === 'doc') {
  // 읽기 전용: 문서 한 건의 상태·수신자 수(이름만)를 본다. --id 또는 --from <저장된 응답 json>
  const id = arg('--id') || JSON.parse(fs.readFileSync(arg('--from'), 'utf8')).document_id;
  const { accessToken, apiUrl } = await issueToken({ apiKey: env.EFORMSIGN_API_KEY, privateKey: env.EFORMSIGN_PRIVATE_KEY, memberId: env.EFORMSIGN_MEMBER_ID });
  const d = await (await fetch(`${apiUrl}/v2.0/api/documents/${id}?include_external_token=true`, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
  const cs = d.current_status || {};
  console.log(JSON.stringify({ status_type: cs.status_type, step_name: cs.step_name, recipients: (d.recipients || []).map((r) => r.name), expired_date: cs.expired_date ? new Date(cs.expired_date).toISOString() : null }));
} else if (cmd === 'create') {
  // 새 장을 강제로 하나 만든다(진행 중 문서가 있어도). 핸들러와 같은 lib 경로.
  const { resolveMultirowStep, headerFromEnv } = await import('../../api/lib/eformsign-multirow.mjs');
  const r = await resolveMultirowStep({ apiKey: env.EFORMSIGN_API_KEY, privateKey: env.EFORMSIGN_PRIVATE_KEY, memberId: env.EFORMSIGN_MEMBER_ID,
    templateId: env.KIOSK_MULTIROW_FORM_ID, email: env.KIOSK_MULTIROW_EMAIL, rows: Number(env.KIOSK_MULTIROW_ROWS) || 20, forceNew: true,
    validDays: Number(env.KIOSK_MULTIROW_VALID_DAYS) || 50, header: headerFromEnv(env) });
  console.log(redact({ created: r.created, rows: r.rows, warnings: r.warnings, trace: r.log }));
  if (arg('--save')) fs.writeFileSync(arg('--save'), JSON.stringify(r, null, 1));
} else if (cmd === 'call') {
  const q = arg('--last') ? `?last=${arg('--last')}` : '';
  const r = await call(q, argv.includes('--cross') ? { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } : {});
  console.log('HTTP', r.status, 'cors', r.headers['access-control-allow-origin'] ?? '(none)');
  console.log(redact(r.body));
  const leaked = ['EFORMSIGN_API_KEY', 'EFORMSIGN_PRIVATE_KEY'].filter((k) => env[k] && JSON.stringify(r.body).includes(env[k]));
  console.log('secret-leak-check', leaked.length ? 'FAIL ' + leaked.join(',') : 'PASS');
  if (arg('--save')) fs.writeFileSync(arg('--save'), JSON.stringify(r.body, null, 1));
} else {
  const port = Number(arg('--port', '8699'));
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const cfgExtra = { docMode: 'multirow', debug: argv.includes('--debug'), title: '방명록', subtitle: '차례대로 한 줄씩 적어 주세요.' };
  http.createServer(async (q, s) => {
    const u = new URL(q.url, `http://${q.headers.host}`);
    if (u.pathname === '/api/multirow') {
      const r = await new Promise((resolve) => {
        const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k] = v; }, end(b) { resolve({ st: this.statusCode, h: this.h, b }); } };
        handler({ method: q.method, url: q.url, headers: q.headers }, res);
      });
      s.writeHead(r.st, r.h); s.end(r.b);
      console.log('api', r.st, redact(JSON.parse(r.b).trace || JSON.parse(r.b).reason));
      return;
    }
    if (u.pathname === '/config.js') {
      const base = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
      s.writeHead(200, { 'content-type': types['.js'] });
      s.end(base + `\nObject.assign(window.KIOSK_CONFIG, ${JSON.stringify(cfgExtra)});\n`);
      return;
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end('not found'); return; }
    s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    s.end(fs.readFileSync(f));
  }).listen(port, '127.0.0.1', () => console.log(`serving http://localhost:${port}/ (pid ${process.pid})`));
}
