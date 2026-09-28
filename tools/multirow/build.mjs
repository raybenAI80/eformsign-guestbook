// Build the multirow (one-document-many-visitors) probe OZR.
// PDF-backed OZR via eformsign-core buildPdfBackedOzr, then post-process:
//  - declare OZFormParam document_step / document_step_name
//  - inject OnBind step-scoping on every row input (own row editable, later rows disabled,
//    previous rows hidden by SetVisible(false) or covered by a mask label, per layout.hideMethodByRow)
//  - add mask labels ("작성 완료") and a printed debug label showing the step params
// Usage: EFORMSIGN_CORE_DIR=... node build.mjs --pdf <bg.pdf> --out <f.ozr> [--xml <f.xml>]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { core } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const lay = JSON.parse(fs.readFileSync(path.join(here, 'layout.json'), 'utf8'));
const pdfPath = arg('--pdf');
const outPath = arg('--out');
const xmlPath = arg('--xml');
if (!pdfPath || !outPath) throw new Error('--pdf and --out required');
if (!fs.existsSync(pdfPath)) execFileSync('python', [path.join(here, 'make-pdf.py'), path.join(here, 'layout.json'), pdfPath], { stdio: 'inherit' });
const m = await core();

const fid = (key, row) => `${key} ${row}`;
const rowTop = (i) => lay.headerTop + lay.headerH + (i - 1) * lay.rowH;
const fields = [];
for (let r = 1; r <= lay.rows; r++) {
  for (const c of lay.cols.filter((c) => c.type)) {
    const top = rowTop(r);
    const bbox = c.type === 'signature'
      ? [c.x0 + 6, top + 6, c.x1 - 6, top + lay.rowH - 6]
      : [c.x0 + 3, top + lay.rowH / 2 - 11, c.x1 - 3, top + lay.rowH / 2 + 11];
    fields.push({ id: fid(c.key, r), page: 1, bbox, type: c.type === 'signature' ? 'signature' : 'text' });
  }
}
const built = await m.buildPdfBackedOzr({
  pdf: fs.readFileSync(pdfPath), pageCount: 1, sectionName: '방명록', fields,
  participants: ['발송인'],
});
let xml = built.xml;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ev = (name, js) => `<EVENT NAME="${name}" EVENTTYPE="Any" EVENTVALUE="${esc(js.replace(/\r?\n/g, '~OZ#CRLF'))}"/>`;
// NOTE: strict gate forbids '<' '>' and '//' in scripts -> use Math.max for ordering.
const stepJs = `var _nm = ''; var _st = '';
try { _nm = String(ReportTemplate.GetDataSetValue('OZFormParam.document_step_name')); } catch (e) { _nm = ''; }
try { _st = String(ReportTemplate.GetDataSetValue('OZFormParam.document_step')); } catch (e) { _st = ''; }
if (_nm === 'null' || _nm === 'undefined') _nm = '';
var _pre = ${JSON.stringify(lay.stepNamePrefix)};
var _cur = 0;
if (_nm.indexOf(_pre) === 0) { _cur = parseInt(_nm.substring(_pre.length), 10); if (isNaN(_cur)) _cur = 0; }`;
const inputJs = (row, method) => `try {
${stepJs}
var _row = ${row};
if (_cur === _row) { This.SetEnable(true); This.SetVisible(true); }
else if (_cur !== 0 && Math.max(_row, _cur) === _cur) { This.SetEnable(false); ${method === 'visible' ? 'This.SetVisible(false);' : ''} }
else if (_cur !== 0) { This.SetEnable(false); }
} catch (e) {}`;
const maskJs = (row) => `try {
${stepJs}
var _row = ${row};
This.SetVisible(_cur !== 0 && _cur !== _row && Math.max(_row, _cur) === _cur);
} catch (e) {}`;
const debugJs = `try {
${stepJs}
This.SetText('step=' + _st + ' / name=' + _nm + ' / cur=' + _cur);
} catch (e) {}`;

// inject OnBind into every row input (OZIC* with FORMID "<key> <row>")
let injected = 0;
xml = xml.replace(/<(OZIC[A-Z]+) ([^>]*?)FORMID="([^"]+) (\d+)"([^>]*?)(\/?)>/g, (all, tag, a, key, row, b, selfClose) => {
  const method = lay.hideMethodByRow[row] ?? 'visible';
  injected++;
  const open = `<${tag} ${a}FORMID="${key} ${row}"${b}>`;
  return selfClose ? `${open}${ev('OnBind', inputJs(Number(row), method))}</${tag}>` : `${open}${ev('OnBind', inputJs(Number(row), method))}`;
});
// mask labels + debug label appended to page 1 children
const shape = (name, l, t, w, h, text, extra, js) => `<ONESHAPE NAME="${name}" LEFT="${l}" TOP="${t}" WIDTH="${w}" HEIGHT="${h}" BGCOLOR="${extra.bg}" TRANSPARENT="${extra.transparent}" BackgroundAlpha="255" DRAWLEFT="0" DRAWTOP="0" DRAWRIGHT="0" DRAWBOTTOM="0" FGCOLOR="${extra.fg}" FONTNAME="맑은 고딕" FONTSIZE="${extra.size}" FONTSTYLE="${extra.style}" HALIGN="${extra.halign}" VALIGN="1">${esc(text)}${ev('OnBind', js)}</ONESHAPE>`;
const extraKids = [];
for (const [row, method] of Object.entries(lay.hideMethodByRow)) {
  if (method !== 'mask') continue;
  const x0 = lay.cols[1].x0 + 1, x1 = lay.cols[lay.cols.length - 1].x1 - 1;
  extraKids.push(shape(`Mask${row}`, x0, rowTop(Number(row)) + 1, x1 - x0, lay.rowH - 2, '작성 완료',
    { bg: -1, transparent: 'false', fg: -10066330, size: 12, style: 1, halign: 1 }, maskJs(Number(row))));
}
const dbgTop = rowTop(lay.rows + 1) + 12;
extraKids.push(shape('StepDebug', 40, dbgTop, 515, 16, 'step=?', { bg: -1, transparent: 'true', fg: -8355712, size: 8, style: 0, halign: 0 }, debugJs));
const pageClose = xml.indexOf('</OZPDFPAGE>');
if (pageClose < 0) throw new Error('no </OZPDFPAGE>');
xml = xml.slice(0, pageClose) + extraKids.join('\r\n') + '\r\n' + xml.slice(pageClose);
xml = xml.replace(/(<OZPDFPAGE NAME="PDFPage1"[^>]*?COUNT=")(\d+)(")/, (a, p, n, s) => p + (Number(n) + extraKids.length) + s);
xml = xml.replace('<OZFORMPARAMS>\r\n</OZFORMPARAMS>', '<OZFORMPARAMS>\r\n<OZFORMPARAM FIELDNAME="document_step" VALUE=""/>\r\n<OZFORMPARAM FIELDNAME="document_step_name" VALUE=""/>\r\n</OZFORMPARAMS>');
if (!xml.includes('FIELDNAME="document_step_name"')) throw new Error('OZFORMPARAMS injection failed');

// gates
const wf = m.validateXmlWellFormedness(xml); if (!wf.ok) throw new Error('XML FAIL ' + wf.errors.join('\n'));
const es = m.validateEventScripts(xml); if (!es.ok) throw new Error('EVENT FAIL ' + JSON.stringify(es.errors));
const strict = m.validateEventScriptsStrict(xml); if (!strict.ok) throw new Error('STRICT FAIL ' + strict.errors.join('\n'));
const expected = fields.length;
if (injected !== expected) throw new Error(`OnBind injected ${injected} != fields ${expected}`);

const buf = m.wrapOzrWithResources(xml, [{ name: '1', data: fs.readFileSync(pdfPath) }]);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buf);
if (xmlPath) fs.writeFileSync(xmlPath, xml);
console.log(JSON.stringify({ out: outPath, bytes: buf.length, fields: expected, onBindInjected: injected, extraShapes: extraKids.length, formIds: m.extractOzrFormIds(buf).length, coverage: built.coverage.pass }));
