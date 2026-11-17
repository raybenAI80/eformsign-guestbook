// Save the newest document of a template (found by name) as a doc.json that download-pdf.mjs / embed-member.mjs read.
// EFORMSIGN_ENV_FILE=.local/report.env node tools/multirow/save-open-doc.mjs --template-name "<name>" --save .local/<dir>/doc.json
// Needs EFORMSIGN_CORE_DIR + EFORMSIGN_ENV_FILE (tools/multirow/env.mjs). Read-only (list + get). IDs go only to the --save file (keep it under .local).
import fs from 'node:fs';
import { client } from './env.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const c = await client();
const t = (await c.templates.list()).templates.find((x) => x.name === arg('--template-name'));
if (!t) throw new Error('template not found');
const tid = t.form_id ?? t.id;
const r = await c.documents.list({ type: '04', limit: 20, templateIds: [tid], startCreateDate: Date.now() - 2 * 86400000, endCreateDate: Date.now() + 60000 });
const docs = (r.documents ?? []).sort((a, b) => Number(b.created_date) - Number(a.created_date));
if (!docs.length) throw new Error('no document for this template');
const g = await c.documents.get(docs[0].id, { includeFields: true });
if (arg('--save')) fs.writeFileSync(arg('--save'), JSON.stringify({ templateId: tid, documentId: docs[0].id, doc: g }, null, 1));
console.log(JSON.stringify({ documents: docs.length, status: g.current_status?.status_type, step: g.current_status?.step_name, stepIndex: g.current_status?.step_index }));
