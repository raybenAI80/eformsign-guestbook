// Complete an `eformsign templates copy-to-company <id> --copy-config --json` result (cross-company template copy).
// Usage: EFORMSIGN_CORE_DIR=<core> node tools/multirow/copy-finish.mjs --source-env <src.env> --target-env <dst.env> --copy-out <copy json> [--dump <f>]
// Steps (vault claim cross-company-template-copy-with-kiosk-config-2026-09-23): GET source (read-only) -> copy config.notification +
//   config.external_access (source member/company id -> target) + auth.form_external_user from source, create-shape auth,
//   form_manager.members=[target member] (2026-09-29: server returned [] — source v6 is [] too) -> save -> release.
// Why: copyToCompany copies only display/input params/parameters/step_settings and leaves the copy UNRELEASED (not in /v2.0/api/forms,
//   verify-template cannot find it). quick_processing is form top-level and is not copied either -> run afterwards:
//   node deploy.mjs --apply-to "<name>" --skip-send-popup --outsider-complete-mail-off   (target env), then verify-template.
// Prints only booleans / key names (no IDs). Measured 2026-09-29 (efstest v6 -> test company): all 5 config keys same as source.
import fs from 'node:fs';
import { core } from './env.mjs';
const m = await core();
const parse = (f) => Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/).map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2].replace(/^["']|["']$/g, '')]));
const mk = (e) => new m.EformsignClient({ apiKey: e.EFORMSIGN_API_KEY, privateKey: e.EFORMSIGN_PRIVATE_KEY, defaultMemberId: e.EFORMSIGN_MEMBER_ID });
const arg = (k) => { const i = process.argv.indexOf(k); if (i < 0) throw new Error('usage: node copy-finish.mjs --source-env <f> --target-env <f> --copy-out <copy-to-company json> [--dump <f>]'); return process.argv[i + 1]; };
const se = parse(arg('--source-env')), te = parse(arg('--target-env'));
const S = mk(se), T = mk(te);
const out = JSON.parse(fs.readFileSync(arg('--copy-out'), 'utf8'));
const ctx = async (c) => ({ http: c.templates.opts.http, mid: c.templates.resolveMemberId(undefined, 'x'), tk: c.templates.resolveMemberToken(undefined, 'x'), cid: (await c.templates.opts.http.getCompany()).id });
const s = await ctx(S), t = await ctx(T);
const url = (x, fid) => `/v1.0/companies/${x.cid}/members/${encodeURIComponent(x.mid)}/forms/${encodeURIComponent(fid)}`;
const get = async (x, fid) => (await x.http.requestService(url(x, fid), { method: 'GET', tokenKind: x.tk, query: { lang: 'ko', include_config: 'Y' } })).result.form;
const src = await get(s, out.sourceFormId); const nf = await get(t, out.newFormId);
const sw = (v) => JSON.parse(JSON.stringify(v).split(s.mid).join(t.mid).split(s.cid).join(t.cid));
const p = JSON.parse(JSON.stringify(nf));
for (const k of ['notification', 'external_access']) if (src.config?.[k] !== undefined) p.config[k] = sw(src.config[k]);
p.auth = { ...(p.auth ?? {}), ...m.toCreateShapeAuthFromForm(nf) };
if (src.auth?.form_external_user !== undefined) p.auth.form_external_user = sw(src.auth.form_external_user);
p.auth.form_manager = { ...(p.auth.form_manager ?? {}), members: [t.mid] };
const leak = JSON.stringify(p).includes(s.cid) || JSON.stringify(p).includes(s.mid);
await t.http.requestServiceMultipart(url(t, out.newFormId), { method: 'POST', tokenKind: t.tk, query: { lang: 'ko' }, fields: { json: JSON.stringify({ idf: {}, input: { form: p } }) }, files: [] });
const start = new Date(); start.setHours(0, 0, 0, 0);
await t.http.requestService(`/v1.0/companies/${t.cid}/forms/${encodeURIComponent(out.newFormId)}/release/request`, { method: 'POST', tokenKind: t.tk, body: { idf: {}, input: { target_date: start.getTime(), request_message: '회사 간 복제 보완(notification·external_access·관리자)', responder: t.mid } } });
const g = await get(t, out.newFormId);
const diff = ['step_settings', 'display_settings', 'notification', 'external_access', 'parameters'].map((k) => `${k}:${JSON.stringify(sw(src.config?.[k])) === JSON.stringify(g.config?.[k]) ? 'same' : 'DIFF'}`);
console.log(JSON.stringify({ sourceIdsLeftInPayload: leak, release: g.is_release, quick: g.quick_processing, srcQuick: src.quick_processing, diff, authKeys: Object.keys(g.auth ?? {}), managerCount: g.auth?.form_manager?.members?.length, extUser: JSON.stringify(g.auth?.form_external_user) === JSON.stringify(sw(src.auth?.form_external_user)) }));
if (process.argv.includes('--dump')) fs.writeFileSync(arg('--dump'), JSON.stringify({ result: { form: g } }, null, 1));
