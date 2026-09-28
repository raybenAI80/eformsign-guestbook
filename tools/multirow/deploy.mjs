// Deploy the multirow probe OZR to the account in EFORMSIGN_ENV_FILE.
// Workflow = 시작 + 참여자 N (step names "방문자 1..N", recipient mode "문서 전송 시 지정 가능") + 완료.
// Step shape source = an existing template that has a participant step (--shape-name, looked up by name at runtime).
// Usage: node deploy.mjs --ozr <f.ozr> --name "<template name>" --shape-name "<source template name>" [--category 키오스크] [--skip-send-popup] [--dry-run]
// --skip-send-popup: form.quick_processing=true (콘솔 일반 설정 > 문서 설정 「문서 전송 시 팝업 생략」; 임베딩 가이드 template_option 표의 같은 이름 필드).
//   deployTemplateFile hardcodes quick_processing:false -> after create: GET form -> set flag -> save (create-shape auth) -> release again.
import fs from 'node:fs';
import { client, core } from './env.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const lay = JSON.parse(fs.readFileSync(new URL('./layout.json', import.meta.url), 'utf8'));
const c = await client();
const list = await c.templates.list();
const shape = list.templates.find((t) => t.name === arg('--shape-name'));
if (!shape) throw new Error('shape template not found by name');
const shapeId = shape.form_id ?? shape.id;
const src = (await c.templates.getManaged(shapeId)).result.form;
const steps = src.config.step_settings;
const w = steps.find((s) => s.type === 'write');
const p = steps.find((s) => s.type === 'participant');
const done = steps.find((s) => s.type === 'complete');
if (!w || !p || !done) throw new Error('shape needs write/participant/complete');
const clone = (o) => JSON.parse(JSON.stringify(o));
const n = lay.rows;
const stepSettings = [clone(w)];
// Unattended visitors cannot pass "문서 열람 전 본인확인"(email code + reCAPTCHA) -> switch it off on every participant step.
// (2026-09-28: the shape source had use_before_view_auth/use_email_auth=true and the member viewer stopped at a CAPTCHA page.)
const noViewAuth = (s) => { Object.assign(s.option, { use_before_view_auth: false, use_email_auth: false, use_before_send_email_auth: false, use_email_sms_auth_view: false, use_mobile_auth: false, use_login_auth: false,
  // shape source also forced 「인증서로 전자서명」(PASS/네이버/카카오) before 전송 -> off
  sign_type: '', digital_signature_info: { ...(s.option.digital_signature_info ?? {}), use_sign: false, sign_type: '', sign_type_value: 'none' } }); return s; };
for (let k = 1; k <= n; k++) stepSettings.push(noViewAuth({ ...clone(p), seq: k + 1, step_group: k + 2, name: lay.stepNamePrefix + k }));
stepSettings.push({ ...clone(done), seq: n + 2, step_group: 2 });
const spec = [{ type: 'write', accessibleAll: true, stepName: w.name }];
// v4: 자기 단계 행만 필수(성명·서명) = 플랫폼 step_settings[].input_control_option[].required (OZR REQUIRED 는 전송을 막지 않음 — vault ozr-ontology-pack)
const req = (k) => (lay.requiredCols ?? []).map((col) => `${col} ${k}`.normalize('NFC'));
for (let k = 1; k <= n; k++) spec.push({ type: 'participant', accessibleAll: true, recipientMode: '', stepName: lay.stepNamePrefix + k, ...(req(k).length ? { required: req(k) } : {}) });
spec.push({ type: 'complete' });
const res = await c.ozw.deployTemplateFile({
  fileBuffer: fs.readFileSync(arg('--ozr')), ext: 'ozr', name: arg('--name'), category: arg('--category'),
  description: '누적형 방명록 실측(한 문서 여러 방문자·이전 행 가림). 삭제는 사용자가 판단.',
  stepSettings, stepSettingsSpec: spec, stepSettingsDocTitle: arg('--name'),
  sourceFormId: shapeId, generateDisplaySettings: true,
  inputs: [{ name: 'document_step', value: '' }, { name: 'document_step_name', value: '' }],
  dryRun: process.argv.includes('--dry-run'),
});
const out = { ...res }; delete out.payload;
if (process.argv.includes('--skip-send-popup') && !process.argv.includes('--dry-run')) {
  // same save path as templates.repairConnectOutputs: POST members/{id}/forms/{formId} with create-shape auth, then release (save leaves is_release:false)
  const m = await core(); const http = c.templates.opts.http; const mid = c.templates.resolveMemberId(undefined, 'deploy'); const tk = c.templates.resolveMemberToken(undefined, 'deploy');
  const cid = (await http.getCompany()).id; const enc = encodeURIComponent(mid);
  const t = (await c.templates.list()).templates.find((x) => x.name === arg('--name')); const fid = t.form_id ?? t.id;
  const url = `/v1.0/companies/${cid}/members/${enc}/forms/${encodeURIComponent(fid)}`;
  const get = async () => (await http.requestService(url, { method: 'GET', tokenKind: tk, query: { lang: 'ko', include_config: 'Y' } }))?.result?.form;
  const f = await get(); const before = { quick_processing: f.quick_processing, version: f.version };
  const patched = JSON.parse(JSON.stringify(f)); patched.quick_processing = true;
  patched.auth = { ...(patched.auth ?? {}), ...m.toCreateShapeAuthFromForm(f) };
  await http.requestServiceMultipart(url, { method: 'POST', tokenKind: tk, query: { lang: 'ko' }, fields: { json: JSON.stringify({ idf: {}, input: { form: patched } }) }, files: [] });
  const start = new Date(); start.setHours(0, 0, 0, 0);
  await http.requestService(`/v1.0/companies/${cid}/forms/${encodeURIComponent(fid)}/release/request`, { method: 'POST', tokenKind: tk, body: { idf: {}, input: { target_date: start.getTime(), request_message: '팝업 생략 적용', responder: mid } } });
  const a = await get();
  out.skipSendPopup = { before, after: { quick_processing: a.quick_processing, version: a.version, is_release: a.is_release, form_member: Boolean(a.auth?.form_member) } };
}
if (process.argv.includes('--dry-run')) out.payloadSteps = res.payload?.config?.step_settings?.map((s) => `${s.type}:${s.name}:${s.option?.specified_recipient_type ?? '-'}`) ?? JSON.stringify(res.payload).slice(0, 400);
console.log(JSON.stringify(out, null, 1));
// --dump <file>: fresh GET of the managed template (step ico required / fields) -> .local only (contains IDs)
if (arg('--dump') && !process.argv.includes('--dry-run')) {
  const t = (await c.templates.list()).templates.find((x) => x.name === arg('--name'));
  const g = t ? await c.templates.getManaged(t.form_id ?? t.id) : { error: 'not found' };
  fs.writeFileSync(arg('--dump'), JSON.stringify(g, null, 1));
  const f = g?.result?.form;
  for (const st of f?.config?.step_settings ?? []) console.log('ico', st.type, st.name, (st.input_control_option ?? []).filter((x) => x.required).map((x) => x.name).join(',') || '-');
}
