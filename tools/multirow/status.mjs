// Print a probe document status + non-empty field values (IDs never printed). node status.mjs <.local/multirow/docN.json>
import fs from 'node:fs';
import { client } from './env.mjs';
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = await client();
const g = await c.documents.get(d.documentId, { includeFields: true });
const cs = g.current_status ?? {};
console.log(JSON.stringify({ status_type: cs.status_type, step_name: cs.step_name, step_index: cs.step_index, fields: (g.fields ?? []).filter((f) => f.value).map((f) => f.id + '=' + String(f.value).slice(0, 12)) }));
