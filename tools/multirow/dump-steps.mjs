// Dump step_settings shape of every template in the account (names/types only; no IDs printed unless --ids).
import { client } from './env.mjs';
const c = await client();
const ids = process.argv.includes('--ids');
const r = await c.templates.list();
for (const t of r.templates) {
  const fid = t.form_id ?? t.id;
  let m; try { m = await c.templates.getManaged(fid); } catch (e) { console.log(t.name, 'ERR', e.message); continue; }
  const form = m?.form ?? m;
  const steps = form?.config?.step_settings ?? form?.step_settings ?? [];
  console.log((ids ? fid + ' ' : '') + t.name, '|', steps.map(s => `${s.type}:${s.name}`).join(' > '));
}
