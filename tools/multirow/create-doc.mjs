// Create a probe document from the multirow template (looked up by name) and print its status.
// --variant member   : every participant step -> the API member (EFORMSIGN_MEMBER_ID), no notification
// --variant external : participant steps 1..--fill -> external recipients (--email-domain), use_mail=true + is_noti_ignore=true
//   (use_mail=false AND use_sms=false is rejected: HTTP 400 [4000001], measured 2026-09-28);
//                      remaining steps left blank (tests "전송 시 지정 가능" skip)
// --fields '{"방문일":"2026. 9. 28. (월)",...}' : document.fields[{id,value}] 값 주입(API 레퍼런스 「새 문서 작성」 document.fields, 2026-09-28 D안 실측).
//   --parameters '{"id":"value"}' : document.parameters[{id,value}](폼 파라미터).
// Document/template IDs are written only to .local (gitignored) via --save <file>.
import fs from 'node:fs';
import { client } from './env.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const c = await client();
const t = (await c.templates.list()).templates.find((x) => x.name === arg('--template-name'));
if (!t) throw new Error('template not found');
const tid = t.form_id ?? t.id;
const variant = arg('--variant', 'member');
const fill = Number(arg('--fill', '3'));
const recipients = [];
for (let k = 1; k <= fill; k++) {
  const member = variant === 'member'
    ? { id: process.env.EFORMSIGN_MEMBER_ID, name: `방문자${k}` }
    : { id: `visitor${k}@${arg('--email-domain', 'example.com')}`, name: `외부방문자${k}` };
  recipients.push({ step_type: '05', use_mail: process.argv.includes('--mail-false') ? false : true, use_sms: false, is_noti_ignore: !process.argv.includes('--notify'), member });
}
const kv = (k) => (arg(k) ? Object.entries(JSON.parse(arg(k))).map(([id, value]) => ({ id, value: String(value) })) : undefined);
const fields = kv('--fields'); const parameters = kv('--parameters');
const res = await c.documents.create(tid, { document: { document_name: arg('--doc-name', `방명록 누적형 실측 ${variant} ${new Date().toISOString().slice(0, 16)}`), recipients, ...(fields ? { fields } : {}), ...(parameters ? { parameters } : {}) } });
const did = res.document.id;
const doc = await c.documents.get(did, { includeExternalToken: true, includeFields: true, includeNextStatus: true });
const redact = (s) => JSON.stringify(s).replace(/[0-9a-f]{32}/g, '<id>').replace(/"(token|external_token)":"[^"]+"/g, '"$1":"<present>"');
console.log(redact({ current_status: doc.current_status, next_status: doc.next_status, keys: Object.keys(doc), injectedFieldsReadBack: fields ? (doc.fields ?? []).filter((x) => fields.some((y) => y.id === x.id)) : undefined }));
if (arg('--save')) fs.writeFileSync(arg('--save'), JSON.stringify({ templateId: tid, documentId: did, variant, doc }, null, 1));
