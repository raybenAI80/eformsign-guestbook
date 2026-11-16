// 누적형 판정 로직 단위 검사(네트워크 없음): node tools/multirow-option/test-lib.mjs
import assert from 'node:assert/strict';
import { judgeDocument, currentStepToken, placeholderEmail, buildCreateBody, readTemplatePlan, stamp, headerFieldValues, visitDateText, sheetIndexToday, headerFromEnv,
  parseClock, sheetWindow, isSheetOfToday, shouldReuse, newSheetReason, sheetOptionsFromEnv, sheetOptionErrors, resolveMultirowStep } from '../../api/lib/eformsign-multirow.mjs';
import handler from '../../api/multirow.mjs';

const now = Date.UTC(2026, 8, 28, 5);
const doc = (cs, extra = {}) => ({ id: 'a'.repeat(32), template: { id: 't' }, current_status: { status_type: '060', step_type: '05', expired_date: now + 86400000, ...cs }, ...extra });
const cases = [
  ['진행 중', doc({}), true, 'in_progress'],
  ['완료 003', doc({ status_type: '003' }), false, 'complete'],
  ['완료 document_step', doc({ document_step: 'complete' }), false, 'complete'],
  ['취소 042', doc({ status_type: '042' }), false, 'status_042'],
  ['결재 취소 013', doc({ status_type: '013' }), false, 'status_013'],
  ['참여자 반려 061', doc({ status_type: '061' }), false, 'status_061'],
  ['삭제 049', doc({ status_type: '049' }), false, 'status_049'],
  ['기한 지남(_expired)', doc({ _expired: true }), false, 'expired'],
  ['기한 지남(expired_date)', doc({ expired_date: now - 1 }), false, 'expired'],
  ['다른 서식', doc({}, { template: { id: 'other' } }), false, 'other_template'],
  ['시작 단계(멤버)', doc({ step_type: '01' }), false, 'step_type_01'],
];
for (const [name, d, open, reason] of cases) {
  const j = judgeDocument(d, { templateId: 't', now });
  assert.equal(j.open, open, name); assert.equal(j.reason, reason, name);
}
const d2 = doc({ step_recipients: [{ email: 'Me+v2@x.com', name: '방문자 2' }] }, { recipients: [{ id: 'me+v1@x.com', name: '방문자 1', token_id: 'T1' }, { id: 'me+v2@x.com', name: '방문자 2', token_id: 'T2' }] });
assert.equal(currentStepToken(d2).token_id, 'T2');
assert.equal(currentStepToken(doc({ step_recipients: [{ email: 'm@x.com' }] }, { recipients: [{ id: 'm@x.com' }] })), null, 'no token = null');
assert.equal(placeholderEmail('me@x.com', 3), 'me+v3@x.com');
assert.throws(() => placeholderEmail('nope', 1));
const b = buildCreateBody({ rows: 2, email: 'me@x.com', documentName: 'n', stepNames: ['방문자 1', '방문자 2'] });
assert.equal(b.document.recipients.length, 2);
assert.deepEqual(b.document.recipients[1], { step_type: '05', use_mail: true, use_sms: false, is_noti_ignore: true, member: { id: 'me+v2@x.com', name: '방문자 2' }, auth: { valid: { day: 50, hour: 0 } } });
const plan = readTemplatePlan({ config: { step_settings: [{ type: 'write' }, { type: 'participant', name: '방문자 1', option: { use_before_view_auth: true } }, { type: 'participant', name: '방문자 2', option: { digital_signature_info: { use_sign: true } } }, { type: 'complete' }],
  notification: { processing_status: { mail: { sending_points: [{ sending_point: 'complete_outsider_document', is_step_recipients: true }] } } } } });
assert.deepEqual(plan.stepNames, ['방문자 1', '방문자 2']);
assert.deepEqual(plan.warnings.sort(), ['cert_sign_on', 'outsider_complete_mail_on', 'view_auth_on']);
assert.equal(stamp(new Date(Date.UTC(2026, 8, 28, 15, 30)), 'Asia/Seoul'), '2026-09-29 00:30');
// 머리 칸(D안) — 설정 없으면 fields 자체를 안 보낸다(기존 서식·배포 보호)
assert.equal('fields' in b.document, false, 'no header -> no fields');
assert.deepEqual(headerFieldValues({}), []);
assert.equal(visitDateText(new Date(Date.UTC(2026, 8, 28, 15, 30)), 'Asia/Seoul'), '2026. 9. 29. (화)');
assert.equal(visitDateText(new Date(Date.UTC(2026, 8, 28, 3)), 'Asia/Seoul'), '2026. 9. 28. (월)');
const day = (h) => Date.UTC(2026, 8, 28, h);   // 서울 = UTC+9
assert.equal(sheetIndexToday([{ created_date: day(1) }, { created_date: day(2) }, { created_date: day(16) }], { now: day(5), timeZone: 'Asia/Seoul' }), 3, '16시 UTC = 다음 날(서울) 제외');
const hv = headerFieldValues({ orgName: ' 포시에스 본사 ', dept: '', date: true, sheetNo: true }, { now: day(3), sheetIndex: 2 });
assert.deepEqual(hv, [{ id: '기관명', value: '포시에스 본사' }, { id: '방문일', value: '2026. 9. 28. (월)' }, { id: '장번호', value: '2장' }]);
assert.deepEqual(buildCreateBody({ rows: 1, email: 'me@x.com', documentName: 'n', fields: hv }).document.fields, hv);
assert.deepEqual(headerFromEnv({ KIOSK_MULTIROW_ORG_NAME: 'A', KIOSK_MULTIROW_DATE: 'auto', KIOSK_MULTIROW_SHEET_NO: 'off' }), { orgName: 'A', dept: '', date: true, sheetNo: false });
assert.deepEqual(headerFromEnv({}), { orgName: '', dept: '', date: false, sheetNo: false });
let extra = 0;
const ok = (cond, name) => { assert.ok(cond, name); extra++; };
const eq = (a, b, name) => { assert.deepEqual(a, b, name); extra++; };

// ── 시간창·하루 단위 새 장(2026-09-29) ──
const kst = (h, m = 0, d = 28) => Date.UTC(2026, 8, d, h - 9, m);   // 서울 = UTC+9
const H = { tz: 'Asia/Seoul', openAt: '10:00', closeAt: '16:00' };
eq(parseClock('10:00'), 600, 'clock 10:00'); eq(parseClock('9:05'), 545, 'clock 9:05'); eq(parseClock(''), null, 'clock empty');
ok(Number.isNaN(parseClock('24:00')), 'clock 24:00 bad'); ok(Number.isNaN(parseClock('10시')), 'clock 10시 bad'); ok(Number.isNaN(parseClock('1000')), 'clock 1000 bad');
// 경계: 시작 정각 = 안, 종료 정각 = 마감
eq(sheetWindow(kst(9, 59), H), { dayKey: '2026-09-28', inWindow: false, beforeOpen: true, afterClose: false }, '09:59 before');
eq(sheetWindow(kst(10, 0), H).inWindow, true, '10:00 in');
eq(sheetWindow(kst(15, 59), H).inWindow, true, '15:59 in');
eq(sheetWindow(kst(16, 0), H), { dayKey: '2026-09-28', inWindow: false, beforeOpen: false, afterClose: true }, '16:00 after');
eq(sheetWindow(kst(12), {}).inWindow, true, 'no hours = always in');
// 시간대: 같은 순간이 KST 01:00(9/29) / UTC 16:00(9/28)
eq(sheetWindow(Date.UTC(2026, 8, 28, 16), { tz: 'Asia/Seoul' }).dayKey, '2026-09-29', 'KST dayKey');
eq(sheetWindow(Date.UTC(2026, 8, 28, 16), { tz: 'UTC', openAt: '10:00', closeAt: '16:00' }).afterClose, true, 'UTC 16:00 after');
eq(sheetWindow(Date.UTC(2026, 8, 28, 16), { tz: 'Asia/Seoul', openAt: '10:00', closeAt: '16:00' }).beforeOpen, true, 'KST 01:00 before');
// 잘못된 입력
eq(sheetOptionErrors({ openAt: '16:00', closeAt: '10:00' }), ['KIOSK_MULTIROW_OPEN_AT', 'KIOSK_MULTIROW_CLOSE_AT'], 'close<open');
eq(sheetOptionErrors({ openAt: '10:00', closeAt: '10:00' }).length, 2, 'close==open');
eq(sheetOptionErrors({ newSheet: 'weekly', afterClose: 'stop' }), ['KIOSK_MULTIROW_NEW_SHEET', 'KIOSK_MULTIROW_AFTER_CLOSE'], 'bad enums');
assert.throws(() => sheetWindow(kst(12), { openAt: '25:00' })); extra++;
eq(sheetOptionsFromEnv({}), { options: { newSheet: 'never', openAt: null, closeAt: null, afterClose: 'new' }, errors: [] }, 'env default = never');
eq(sheetOptionsFromEnv({ KIOSK_MULTIROW_NEW_SHEET: 'Daily', KIOSK_MULTIROW_OPEN_AT: '10:00', KIOSK_MULTIROW_CLOSE_AT: '16:00', KIOSK_MULTIROW_AFTER_CLOSE: 'closed' }).options,
  { newSheet: 'daily', openAt: '10:00', closeAt: '16:00', afterClose: 'closed' }, 'env daily');
eq(sheetOptionsFromEnv({ KIOSK_MULTIROW_CLOSE_AT: '4pm' }).errors, ['KIOSK_MULTIROW_CLOSE_AT'], 'env bad close');
// 오늘 장 판정 — 자정 넘김
const sheet = (createdAt, cs = {}) => doc({ expired_date: kst(0, 0, 30), ...cs }, { created_date: createdAt });
ok(isSheetOfToday(sheet(kst(0, 5)), kst(23, 55), 'Asia/Seoul'), '00:05 vs 23:55 same day');
ok(!isSheetOfToday(sheet(kst(23, 50)), kst(0, 10, 29), 'Asia/Seoul'), '23:50 -> next 00:10 new day');
ok(!isSheetOfToday({ id: 'x' }, kst(12)), 'no created_date');
// 재사용 판정
const D = { templateId: 't', newSheet: 'daily', ...H };
ok(shouldReuse(sheet(kst(10, 30)), kst(15, 59), D), 'daily in-window reuse');
ok(!shouldReuse(sheet(kst(10, 30)), kst(16, 0), D), 'daily 16:00 = in-window sheet closed');
ok(shouldReuse(sheet(kst(16, 5)), kst(17, 0), D), 'after-close sheet reused by after-close visitors');
ok(!shouldReuse(sheet(kst(8, 0)), kst(10, 0), D), 'before-open sheet not reused at open');
ok(!shouldReuse(sheet(kst(15, 0, 27)), kst(11, 0), D), 'yesterday sheet not reused');
ok(!shouldReuse(sheet(kst(10, 30), { status_type: '003' }), kst(11), D), 'complete never reused');
ok(shouldReuse(sheet(kst(15, 0, 27)), kst(11, 0), { templateId: 't', newSheet: 'never', ...H }), 'never = reuse yesterday (회귀)');
ok(shouldReuse(sheet(kst(10, 30)), kst(17, 0), { templateId: 't', ...H }), 'default never ignores close');
ok(!shouldReuse(sheet(kst(15, 0, 27)), kst(11, 0), { templateId: 't', newSheet: 'daily' }), 'daily without hours: yesterday -> new');
ok(shouldReuse(sheet(kst(23, 0)), kst(23, 30), { templateId: 't', newSheet: 'daily' }), 'daily without hours: same day reuse');
// 새 장 이유
eq(newSheetReason(kst(16, 1), [], D), 'after_close', 'reason after_close');
eq(newSheetReason(kst(9, 0), [], D), 'before_open', 'reason before_open');
eq(newSheetReason(kst(11, 0), [sheet(kst(15, 0, 27))], D), 'new_day', 'reason new_day');
eq(newSheetReason(kst(11, 0), [], D), 'first', 'reason first');
eq(newSheetReason(kst(17, 0), [], { newSheet: 'never', ...H }), 'first', 'never -> first');
// 받지 않기: 운영 시간 밖이면 이폼사인을 부르지 않고 닫힘(네트워크 없음 = 여기서 끝나야 한다)
const base = { apiKey: 'k', privateKey: 'p', memberId: 'm', templateId: 't', email: 'me@x.com', timeZone: 'Asia/Seoul', openAt: '10:00', closeAt: '16:00', afterClose: 'closed' };
const cl = await resolveMultirowStep({ ...base, now: kst(16, 0) });
eq(cl, { closed: true, openAt: '10:00', closeAt: '16:00', sheet: { dayKey: '2026-09-28', inWindow: false, reason: 'after_close' }, log: ['closed'] }, 'closed after');
eq((await resolveMultirowStep({ ...base, now: kst(9, 59) })).sheet.reason, 'before_open', 'closed before');
// 핸들러: 시각 형식이 틀리면 400 + 이름(이폼사인 호출 전에 끝난다)
const call = async (env) => {
  const keep = { ...process.env }; Object.assign(process.env, env);
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  try { await handler({ method: 'GET', url: '/api/multirow', headers: {} }, res); } finally { for (const k of Object.keys(env)) { if (k in keep) process.env[k] = keep[k]; else delete process.env[k]; } }
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const envOk = { KIOSK_MULTIROW_ENABLED: 'true', EFORMSIGN_API_KEY: 'k', EFORMSIGN_PRIVATE_KEY: 'p', EFORMSIGN_MEMBER_ID: 'm', KIOSK_MULTIROW_FORM_ID: 't', KIOSK_MULTIROW_EMAIL: 'me@x.com' };
const r400 = await call({ ...envOk, KIOSK_MULTIROW_OPEN_AT: '16:00', KIOSK_MULTIROW_CLOSE_AT: '10:00' });
eq([r400.status, r400.body.reason, r400.body.invalid], [400, 'bad_env', ['KIOSK_MULTIROW_OPEN_AT', 'KIOSK_MULTIROW_CLOSE_AT']], 'handler 400 close<open');
const r400b = await call({ ...envOk, KIOSK_MULTIROW_NEW_SHEET: 'weekly' });
eq([r400b.status, r400b.body.invalid], [400, ['KIOSK_MULTIROW_NEW_SHEET']], 'handler 400 enum');
// ── 동시 요청·중복 생성 방지(2026-11-16 전시 데모: 같은 순간 문서 2건, 둘 다 「1장」) ──
// 가짜 이폼사인 서버. fetch 를 바꿔 끼우고, 생성 호출(POST /documents) 횟수와 선택된 문서를 본다.
const { generateKeyPairSync } = await import('node:crypto');
const ecHex = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('hex');
const API = 'https://api.test';
function fakeServer({ docs = [], createFail = false, holdFormsFor = 0 } = {}) {
  const st = { docs: docs.slice(), posts: 0, formsCalls: 0, seq: 0 };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const full = (d) => ({ id: d.id, created_date: d.created_date, template: { id: 't' },
    current_status: { status_type: '060', step_type: '05', step_index: 2, step_name: '방문자 1', expired_date: Date.now() + 86400000, step_recipients: [{ email: 'me+v1@x.com', name: '방문자 1' }] },
    recipients: [{ id: 'me+v1@x.com', name: '방문자 1', token_id: 'TOK-' + d.id }] });
  const fetchFake = async (url, init = {}) => {
    const u = String(url); const method = (init.method || 'GET').toUpperCase();
    const reply = (obj, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(obj) });
    await tick();
    if (u.includes('access_token')) return reply({ oauth_token: { access_token: 'AT' }, api_key: { company: { company_id: 'C', api_url: API } } });
    if (u.startsWith(API + '/v2.0/api/list_document')) return reply({ documents: st.docs.map(full) });
    if (u.startsWith(API + '/v2.0/api/forms/')) {
      st.formsCalls++;
      // holdFormsFor 번째 호출은 첫 생성이 끝날 때까지 늦춘다(= 두 번째 요청이 목록을 본 뒤 첫 요청이 문서를 만드는 순서를 결정적으로 만든다)
      if (holdFormsFor && st.formsCalls === holdFormsFor) {
        for (let i = 0; i < 200 && st.posts < 1; i++) await tick();
        for (let i = 0; i < 20; i++) await tick();   // 목록 반영 대기
      }
      return reply({ config: { step_settings: [{ type: 'participant', name: '방문자 1' }, { type: 'participant', name: '방문자 2' }] } });
    }
    if (u.startsWith(API + '/v2.0/api/documents') && method === 'POST') {
      st.posts++;
      await tick();
      if (createFail) return reply({ code: 'x' }, 500);
      const id = ('c' + (++st.seq)).padStart(32, '0');
      st.docs.push({ id, created_date: Date.now() + st.seq });
      return reply({ document: { id } });
    }
    const m = /\/v2\.0\/api\/documents\/([0-9a-f]{32})/.exec(u);
    if (m && method === 'GET') { const d = st.docs.find((x) => x.id === m[1]); return d ? reply(full(d)) : reply({}, 404); }
    return reply({}, 404);
  };
  return { st, fetchFake };
}
const realFetch = globalThis.fetch;
const withFake = async (srv, fn) => { globalThis.fetch = srv.fetchFake; try { return await fn(); } finally { globalThis.fetch = realFetch; } };
const rOpts = { apiKey: 'k', privateKey: ecHex, memberId: 'm', tokenUrl: 'https://auth.test/access_token', templateId: 't', email: 'me@x.com', timeZone: 'Asia/Seoul', now: Date.now() };
const mkDocs = (n, base) => Array.from({ length: n }, (_, i) => ({ id: (base + i).toString(16).padStart(32, '0'), created_date: rOpts.now - 5000 + i * 1000 }));

// ① 동시 2요청: 첫 요청이 문서를 만든 뒤 두 번째 요청이 생성 직전 목록을 다시 보면 생성하지 않고 그 문서를 쓴다
{
  const srv = fakeServer({ holdFormsFor: 2 });
  const [a, b] = await withFake(srv, () => Promise.all([resolveMultirowStep({ ...rOpts }), resolveMultirowStep({ ...rOpts })]));
  eq(srv.st.posts, 1, '동시 2요청 = 생성 호출 1회');
  eq(a.document_id, b.document_id, '동시 2요청 = 같은 문서');
  eq([a.created, b.created].sort(), [false, true], '한 요청만 created');
}
// ② 같은 날 열린 장 2건: 두 요청 모두 가장 먼저 만든 장으로 수렴하고, 생성도 삭제도 하지 않는다
{
  const docs = mkDocs(2, 1);
  const srv = fakeServer({ docs });
  const [a, b] = await withFake(srv, () => Promise.all([resolveMultirowStep({ ...rOpts }), resolveMultirowStep({ ...rOpts })]));
  eq(a.document_id, docs[0].id, '같은 날 다건 = 가장 오래된 장');
  eq(b.document_id, docs[0].id, '두 요청이 같은 문서');
  eq(srv.st.posts, 0, '다건이어도 생성 0회'); ok(a.log.some((s) => s === 'extra_open:1'), 'extra_open 로그');
  eq(srv.st.docs.length, 2, '자동 삭제 없음');
}
// ③ 생성 실패: 자동 재시도 0회(호출 1회, 오류로 끝)
{
  const srv = fakeServer({ createFail: true });
  await withFake(srv, async () => { await assert.rejects(() => resolveMultirowStep({ ...rOpts }), /HTTP 500/); }); extra++;
  eq(srv.st.posts, 1, '생성 실패 시 재시도 없음(호출 1회)');
}
console.log(`PASS ${cases.length + 18 + extra} checks`);

