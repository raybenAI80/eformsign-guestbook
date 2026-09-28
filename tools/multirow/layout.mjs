// Layout loader shared by build.mjs / deploy.mjs.
// Default = layout.json (3-row probe, unchanged). Product = --layout layout-product.json --variant A|B|P
// (common + variants[id], shallow merge; nested "colors" merged too). Derived geometry for design layouts:
// column x0/x1 from widths, per-page row tops.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
export function loadLayout() {
  const file = arg('--layout') ? path.resolve(arg('--layout')) : path.join(here, 'layout.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw.common) return { ...raw, file, pages: 1, rowsPerPage: raw.rows };
  const v = arg('--variant');
  if (!v || !raw.variants?.[v]) throw new Error(`--variant required (${Object.keys(raw.variants ?? {}).join('|')})`);
  const lay = { ...raw.common, ...raw.variants[v], colors: { ...raw.common.colors, ...(raw.variants[v].colors ?? {}) }, file, variant: v };
  let x = lay.marginX;
  lay.cols = lay.cols.map((c) => { const o = { ...c, x0: x, x1: x + c.w }; x += c.w; return o; });
  lay.rowsPerPage = lay.rowsPerPage ?? lay.rows;
  lay.pages = Math.ceil(lay.rows / lay.rowsPerPage);
  return lay;
}
// page (1-based) and top y of row r (1-based)
export const rowPage = (lay, r) => Math.ceil(r / lay.rowsPerPage);
export const rowTop = (lay, r) => lay.headerTop + lay.headerH + ((r - 1) % lay.rowsPerPage) * lay.rowH;
