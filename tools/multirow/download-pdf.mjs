// Download the completed PDF of a probe document and print status + include_fields values.
// node download-pdf.mjs --doc <.local/multirow/docN.json> --out <file.pdf>
import fs from 'node:fs';
import { client } from './env.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const d = JSON.parse(fs.readFileSync(arg('--doc'), 'utf8'));
const c = await client();
const g = await c.documents.get(d.documentId, { includeFields: true });
console.log('status', g.current_status?.status_type, g.current_status?.step_name);
for (const f of g.fields ?? []) if (f.type === 'string') console.log(' field', f.id, '=', f.value);
const pdf = await c.documents.downloadFiles(d.documentId, { fileType: arg('--file-type', 'document') });
fs.writeFileSync(arg('--out'), pdf.buffer);
console.log('pdf', pdf.contentType, pdf.buffer.length, 'bytes ->', arg('--out'));
