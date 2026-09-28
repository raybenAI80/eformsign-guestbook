// 누적형 판정 로직 단위 검사(네트워크 없음): node tools/multirow-option/test-lib.mjs
import assert from 'node:assert/strict';
import { judgeDocument, currentStepToken, placeholderEmail, buildCreateBody, readTemplatePlan, stamp, headerFieldValues, visitDateText, sheetIndexToday, headerFromEnv } from '../../api/lib/eformsign-multirow.mjs';

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
console.log(`PASS ${cases.length + 18} checks`);
