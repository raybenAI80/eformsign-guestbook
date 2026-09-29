// Build the multirow (one-document-many-visitors) probe OZR.
// PDF-backed OZR via eformsign-core buildPdfBackedOzr, then post-process:
//  - declare OZFormParam document_step / document_step_name
//  - inject OnBind step-scoping on every row input (own row editable, later rows disabled,
//    previous rows hidden by SetVisible(false) or covered by a mask label, per layout.hideMethodByRow)
//  - add mask labels ("작성 완료") and a printed debug label showing the step params
// Usage: EFORMSIGN_CORE_DIR=... node build.mjs --pdf <bg.pdf> --out <f.ozr> [--xml <f.xml>]
// Product design (2026-09-28): --layout tools/multirow/layout-product.json --variant A|B|P
//   -> background from make-pdf-product.py (always regenerated, embedded 맑은 고딕 TTF), N pages (rowsPerPage),
//      text inputs resized to fill the cell (core builder caps text boxes at 15pt), signpad ICONSIZE per row,
//      own-row highlight = border-colour box + per-cell fills (both NOPRINT), themed 「작성 완료」 cover, no StepDebug.
//   The 3-row probe (default layout.json) output is unchanged.
//   Customer logo (variant with logoSlot, e.g. D): --logo <png|jpg|svg> -> top-right of the background PDF (make-pdf-product.py).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { core } from './env.mjs';
import { loadLayout, rowPage, rowTop as rowTopOf, purposeItems } from './layout.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const lay = loadLayout();
const pdfPath = arg('--pdf');
const outPath = arg('--out');
const xmlPath = arg('--xml');
if (!pdfPath || !outPath) throw new Error('--pdf and --out required');
if (lay.design) {
  const resolved = outPath.replace(/\.ozr$/i, '') + '.layout.json';
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(lay, null, 1));
  execFileSync('python', [path.join(here, 'make-pdf-product.py'), resolved, pdfPath], { stdio: 'inherit' });
  // make-pdf-product.py writes back headerFields moved around the customer logo (logoSlot) + measured page count
  const back = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (lay.logoSlot) lay.headerFields = back.headerFields;
  lay.bgPages = back.bgPages; lay.logoPlaced = back.logoPlaced ?? null;
  if (lay.bgPages !== lay.pages) throw new Error(`background PDF pages ${lay.bgPages} != layout pages ${lay.pages}`);
} else if (!fs.existsSync(pdfPath)) execFileSync('python', [path.join(here, 'make-pdf.py'), path.join(here, 'layout.json'), pdfPath], { stdio: 'inherit' });
const m = await core();

const fid = (key, row) => `${key} ${row}`;
const rowTop = (i) => rowTopOf(lay, i);
const fields = [];
// D안(style reception): explicit geometry per FORMID (time / purpose sub-fields / header value fields)
const geoByFid = new Map(); const colTypeByKey = new Map();
if (lay.style === 'reception') {
  const g = lay.purposeGeo;
  for (let r = 1; r <= lay.rows; r++) {
    const top = rowTop(r);
    for (const c of lay.cols.filter((c) => c.type)) {
      colTypeByKey.set(c.key, c.type);
      if (c.type === 'purpose') {
        for (const [lab, cx, cy] of purposeItems(lay, c, top)) {
          colTypeByKey.set(`${c.key}_${lab}`, 'check');
          fields.push({ id: fid(`${c.key}_${lab}`, r), page: rowPage(lay, r), type: 'checkbox', bbox: [cx - g.touch / 2, cy - g.touch / 2, cx + g.touch / 2, cy + g.touch / 2] });
        }
        const ot = g.otherText; const k2 = `${c.key}_${c.otherLabel}내용`; colTypeByKey.set(k2, 'text');
        fields.push({ id: fid(k2, r), page: rowPage(lay, r), type: 'text', bbox: [c.x0 + ot[0], top + ot[1], c.x0 + ot[2], top + ot[3]] });
        geoByFid.set(fid(k2, r), { LEFT: c.x0 + ot[0], TOP: top + ot[1], WIDTH: ot[2] - ot[0], HEIGHT: ot[3] - ot[1], FONTSIZE: 11 });
        continue;
      }
      const si = lay.signInset ?? 6;
      const bbox = c.type === 'signature' ? [c.x0 + si, top + si, c.x1 - si, top + lay.rowH - si] : [c.x0 + 3, top + lay.rowH / 2 - 11, c.x1 - 3, top + lay.rowH / 2 + 11];
      fields.push({ id: fid(c.key, r), page: rowPage(lay, r), bbox, type: c.type === 'signature' ? 'signature' : 'text' });
      if (c.type !== 'signature') geoByFid.set(fid(c.key, r), { LEFT: c.x0 + lay.textInsetX, TOP: top + lay.textInsetY, WIDTH: c.w - 2 * lay.textInsetX, HEIGHT: lay.rowH - 2 * lay.textInsetY, FONTSIZE: c.type === 'time' ? 11 : lay.inputSize });
    }
  }
  for (const hf of lay.headerFields ?? []) fields.push({ id: hf.id, page: 1, type: 'text', bbox: hf.box });
}
for (let r = 1; r <= (lay.style === 'reception' ? 0 : lay.rows); r++) {
  for (const c of lay.cols.filter((c) => c.type)) {
    const top = rowTop(r);
    const si = lay.signInset ?? 6;
    const bbox = c.type === 'signature'
      ? [c.x0 + si, top + si, c.x1 - si, top + lay.rowH - si]
      : [c.x0 + 3, top + lay.rowH / 2 - 11, c.x1 - 3, top + lay.rowH / 2 + 11];
    fields.push({ id: fid(c.key, r), page: rowPage(lay, r), bbox, type: c.type === 'signature' ? 'signature' : 'text' });
  }
}
const built = await m.buildPdfBackedOzr({
  pdf: fs.readFileSync(pdfPath), pageCount: lay.pages, sectionName: '방명록', fields,
  ...(lay.ozFont ? { fontName: lay.ozFont } : {}),
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
const inputJs = (row, method, req) => `try {
${stepJs}
var _row = ${row};
${req ? "This.SetRequired(_cur === _row);" : ""}
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

// D안: 방문 시각 = own row only, only while empty (the completed-PDF render re-binds with _cur 0 -> never overwrites)
const nowHm = `var _d = new Date(); var _hm = String(_d.getHours() + 100).substring(1) + ':' + String(_d.getMinutes() + 100).substring(1);`;
const timeJs = (row) => `try {
${stepJs}
var _v = ''; try { _v = String(This.GetText()); } catch (e) { _v = ''; }
if (_v === 'null' || _v === 'undefined') _v = '';
if (_cur === ${row} && _st !== 'complete') {
  var _me = This;
  var _f = function () { try { var _x = String(_me.GetText()); if (_x === 'null' || _x === 'undefined') _x = ''; if (_x === '') { ${nowHm} _me.SetText(_hm); } } catch (e2) {} };
  _f(); setTimeout(_f, 800); setTimeout(_f, 2500); setTimeout(_f, 6000);
}
} catch (e) {}`;
// D안: 방문일 fallback = step 1 (first visitor) only, only while empty (document.fields injection wins when given)
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const todayJs = `try {
${stepJs}
var _v = ''; try { _v = String(This.GetText()); } catch (e) { _v = ''; }
if (_v === 'null' || _v === 'undefined') _v = '';
if (_cur === 1 && _st !== 'complete') {
  var _me = This;
  var _f = function () { try { var _x = String(_me.GetText()); if (_x === 'null' || _x === 'undefined') _x = ''; if (_x === '') { var _d = new Date(); var _w = ${JSON.stringify(WEEK)}; _me.SetText(_d.getFullYear() + '. ' + (_d.getMonth() + 1) + '. ' + _d.getDate() + '. (' + _w[_d.getDay()] + ')'); } } catch (e2) {} };
  _f(); setTimeout(_f, 800); setTimeout(_f, 2500); setTimeout(_f, 6000);
}
} catch (e) {}`;
// header fixed-text fallback (same guard/timing as todayJs): used only when document.fields injection gave no value
const fixedJs = (txt) => `try {
${stepJs}
if (_cur === 1 && _st !== 'complete') {
  var _me = This;
  var _f = function () { try { var _x = String(_me.GetText()); if (_x === 'null' || _x === 'undefined') _x = ''; if (_x === '') { _me.SetText(${JSON.stringify(txt)}); } } catch (e2) {} };
  _f(); setTimeout(_f, 800); setTimeout(_f, 2500); setTimeout(_f, 6000);
}
} catch (e) {}`;
// inject OnBind into every row input (OZIC* with FORMID "<key> <row>")
let injected = 0;
xml = xml.replace(/<(OZIC[A-Z]+) ([^>]*?)FORMID="([^"]+) (\d+)"([^>]*?)(\/?)>/g, (all, tag, a, key, row, b, selfClose) => {
  const method = lay.hideMethodByRow[row] ?? 'visible';
  injected++;
  // v5: ozrRequired "static" -> REQUIRED="true" on requiredCols of every row (b1 probe); "own-row" (D v7) -> same static attr (send blocking needs it)
  //     plus OnBind SetRequired(_cur === _row) on every bind, also when _cur 0 (editor / completed PDF) -> only the own row keeps the required badge
  const reqAttr = lay.ozrRequired && (lay.requiredCols ?? []).includes(key) ? ' REQUIRED="true"' : '';
  const open = `<${tag} ${a}FORMID="${key} ${row}"${b}${reqAttr}>`;
  if (colTypeByKey.get(key) === 'time') {
    const vis = `try {
${stepJs}
var _row = ${Number(row)};
This.SetEnable(false);
if (_cur !== 0 && _cur !== _row && Math.max(_row, _cur) === _cur) This.SetVisible(false);
} catch (e) {}`;
    const evs = ev('OnBind', vis + '\n' + timeJs(Number(row)));
    return selfClose ? `${open}${evs}</${tag}>` : `${open}${evs}`;
  }
  return selfClose ? `${open}${ev('OnBind', inputJs(Number(row), method, reqAttr !== '' && lay.ozrRequired === 'own-row'))}</${tag}>` : `${open}${ev('OnBind', inputJs(Number(row), method, reqAttr !== '' && lay.ozrRequired === 'own-row'))}`;
});
// v4 (2026-09-28): cover labels 「작성 완료」 over previous rows + own-row highlight.
// Completed PDF = print/export: it ignores display flags (script SetVisible AND static VISIBLE="false", both measured v3/v5)
// but honours print flags -> cover/highlight shapes carry static NOPRINT="True" (never in the PDF); OnBind SetVisible drives the viewer.
//   coverStyleByRow "opaque"     : grey filled box + text (PDF-safe via NOPRINT)
//   ONESHAPE HALIGN/VALIGN are integer codes 0=center, 1=left/top, 2=right/bottom (v5/v6 used 1/1 -> text stuck top-left)
//   coverStyleByRow "text-guard" : transparent, empty default text; OnBind SetText only while not complete (also PDF-safe without NOPRINT)
const shape = (name, l, t, w, h, text, extra, js) => `<ONESHAPE NAME="${name}" LEFT="${l}" TOP="${t}" WIDTH="${w}" HEIGHT="${h}" BGCOLOR="${extra.bg}" TRANSPARENT="${extra.transparent}" BackgroundAlpha="255" DRAWLEFT="0" DRAWTOP="0" DRAWRIGHT="0" DRAWBOTTOM="0" FGCOLOR="${extra.fg}" FONTNAME="맑은 고딕" FONTSIZE="${extra.size}" FONTSTYLE="${extra.style}" HALIGN="${extra.halign}" VALIGN="${extra.valign ?? 1}"${extra.hidden ? ' NOPRINT="True"' : ''}>${esc(text)}${ev('OnBind', js)}</ONESHAPE>`;
const coverJs = (row, guard) => `try {
${stepJs}
var _row = ${row};
var _show = _cur !== 0 && _cur !== _row && Math.max(_row, _cur) === _cur && _st !== 'complete';
${guard ? "This.SetText(_show ? '작성 완료' : '');" : ''}
This.SetVisible(_show);
} catch (e) {}`;
const hiJs = (row) => `try {
${stepJs}
This.SetVisible(_cur === ${row} && _st !== 'complete');
} catch (e) {}`;
// shapes per page (1-based). Old probe = page 1 only.
const extraByPage = new Map(); const backByPage = new Map();
const put = (map, pg, x) => { if (!map.has(pg)) map.set(pg, []); map.get(pg).push(x); };
const extraKids = { push: (x, pg = 1) => put(extraByPage, pg, x) };
const backKids = { push: (x, pg = 1) => put(backByPage, pg, x) };
// #RRGGBB -> OZ signed ARGB int (opaque)
const ozc = (h) => (0xff000000 | parseInt(h.slice(1), 16)) | 0;
const rx0 = lay.cols[1].x0 + 1, rx1 = lay.cols[lay.cols.length - 1].x1 - 1;
if (!lay.design) {
  for (const [row, method] of Object.entries(lay.hideMethodByRow)) {
    if (method !== 'mask') continue; // v3 mask-label method (discarded: covers values in completed PDF)
    extraKids.push(shape(`Mask${row}`, rx0, rowTop(Number(row)) + 1, rx1 - rx0, lay.rowH - 2, '작성 완료',
      { bg: -1, transparent: 'false', fg: -10066330, size: 12, style: 1, halign: 1 }, maskJs(Number(row))));
  }
  if (lay.coverLabel) {
    for (let r = 1; r < lay.rows; r++) {
      const guard = (lay.coverStyleByRow?.[r] ?? 'opaque') === 'text-guard';
      extraKids.push(shape(`Cover${r}`, rx0, rowTop(r) + 1, rx1 - rx0, lay.rowH - 2, guard ? '' : '작성 완료',
        { bg: guard ? -1 : -1118482, transparent: guard ? 'true' : 'false', fg: -10066330, size: 12, style: 1, halign: 0, valign: 0, hidden: true }, coverJs(r, guard)));
    }
  }
  if (lay.highlightOwnRow) {
    // light-yellow box behind the (transparent) inputs -> inserted as the first children of the page
    for (let r = 1; r <= lay.rows; r++) backKids.push(shape(`Own${r}`, rx0, rowTop(r) + 1, rx1 - rx0, lay.rowH - 2, '',
      { bg: -2878, transparent: 'false', fg: -16777216, size: 9, style: 0, halign: 0, hidden: true }, hiJs(r)));
  }
  const dbgTop = lay.headerTop + lay.headerH + lay.rows * lay.rowH + 12;
  extraKids.push(shape('StepDebug', 40, dbgTop, 515, 16, 'step=?', { bg: -1, transparent: 'true', fg: -8355712, size: 8, style: 0, halign: 0 }, debugJs));
} else {
  const C = lay.colors; const X0 = lay.cols[0].x0, X1 = lay.cols[lay.cols.length - 1].x1;
  for (let r = 1; r <= lay.rows; r++) {
    const pg = rowPage(lay, r); const t = rowTop(r);
    if (lay.coverLabel && r < lay.rows) extraKids.push(shape(`Cover${r}`, rx0, t + 1, rx1 - rx0, lay.rowH - 2, lay.coverText ?? '작성 완료',
      { bg: ozc(C.coverBg), transparent: 'false', fg: ozc(C.coverText), size: lay.coverSize, style: 1, halign: 0, valign: 0, hidden: true }, coverJs(r, false)), pg);
    if (lay.highlightOwnRow) {
      // bold outline = accent box under the whole row; per-cell light fills leave 1.6pt outer / 0.8pt inner gaps showing it
      backKids.push(shape(`OwnB${r}`, X0, t, X1 - X0, lay.rowH, '', { bg: ozc(C.ownBorder), transparent: 'false', fg: -16777216, size: 9, style: 0, halign: 0, hidden: true }, hiJs(r)), pg);
      lay.cols.forEach((c, i) => {
        const l = c.x0 + (i === 0 ? 1.8 : 0.4), rr = c.x1 - (i === lay.cols.length - 1 ? 1.8 : 0.4);
        backKids.push(shape(`Own${r}c${i}`, +l.toFixed(2), t + 1.8, +(rr - l).toFixed(2), lay.rowH - 3.6, '', { bg: ozc(i === 0 && lay.ownNoInverse ? C.ownBorder : C.ownFill), transparent: 'false', fg: -16777216, size: 9, style: 0, halign: 0, hidden: true }, hiJs(r)), pg);
      });
    }
  }
  const pcol = lay.cols.find((c) => c.type === 'purpose');
  if (lay.highlightOwnRow && pcol && lay.purposeGeo) {
    const g = lay.purposeGeo;
    for (let r = 1; r <= lay.rows; r++) {
      const t = rowTop(r);
      // v5 (inline): label shape ends where the next option's checkbox component starts (cx + itemDX - touch/2)
      purposeItems(lay, pcol, t).forEach(([lab, cx, cy], k) => extraKids.push(shape(`OwnOpt${r}_${k}`, +(cx + g.box / 2 + g.labelGap - 5).toFixed(2), +(cy - 8).toFixed(2), g.inline ? +(g.itemDX - g.touch / 2 - g.box / 2 - g.labelGap + 5).toFixed(2) : 26, 16, lab,
        { bg: -1, transparent: 'true', fg: ozc(C.optLabel), size: g.labelSize, style: 0, halign: 1, valign: 0, hidden: true }, hiJs(r)), rowPage(lay, r)));
    }
  }
  if (lay.highlightOwnRow) {
    // own-row number is drawn in the PDF background and would be covered by the fills -> NOPRINT accent number on top
    for (let r = 1; r <= lay.rows; r++) extraKids.push(shape(`OwnNo${r}`, lay.cols[0].x0 + 2, rowTop(r) + 2, lay.cols[0].w - 4, lay.rowH - 4, String(r),
      { bg: -1, transparent: 'true', fg: lay.ownNoInverse ? -1 : ozc(C.ownBorder), size: lay.numberSize, style: 1, halign: 0, valign: 0, hidden: true }, hiJs(r)), rowPage(lay, r));
  }
}
// design: text inputs fill the cell (core caps height at 15pt / font 10); signpad ICONSIZE per row
if (lay.design) {
  xml = xml.replace(/<OZICTEXTBOX ([^>]*?)FORMID="([^"]+) (\d+)"([^>]*)>/g, (all, a, key, row, b) => {
    const c = lay.cols.find((x) => x.key === key); const t = rowTop(Number(row));
    const geo = geoByFid.get(`${key} ${row}`) ?? { LEFT: c.x0 + lay.textInsetX, TOP: t + lay.textInsetY, WIDTH: c.w - 2 * lay.textInsetX, HEIGHT: lay.rowH - 2 * lay.textInsetY, FONTSIZE: lay.inputSize };
    let tag = `<OZICTEXTBOX ${a}FORMID="${key} ${row}"${b}>`;
    for (const [k, v] of Object.entries(geo)) tag = tag.replace(new RegExp(` ${k}="[^"]*"`), ` ${k}="${+Number(v).toFixed(2)}"`);
    // time column: read-only, centred, muted (value written by OnBind)
    if (colTypeByKey.get(key) === 'time') tag = tag.replace(/ HALIGN="\d+"/, ' HALIGN="0"').replace(/ FGCOLOR="-?\d+"/, ` FGCOLOR="${ozc(lay.colors.time)}"`);
    return tag;
  });
  // header value fields (no row number): read-only, fixed box, colour/bold/align from layout; 방문일 fallback OnBind
  for (const hf of lay.headerFields ?? []) {
    const re = new RegExp(`<OZICTEXTBOX ([^>]*?)FORMID="${hf.id}"([^>]*)>`);
    const mm = re.exec(xml); if (!mm) throw new Error('header field not emitted: ' + hf.id);
    const [a, b, cc, d] = hf.box;
    let tag = mm[0];
    const geo = { LEFT: a, TOP: b, WIDTH: cc - a, HEIGHT: d - b, FONTSIZE: hf.size };
    for (const [k, v] of Object.entries(geo)) tag = tag.replace(new RegExp(` ${k}="[^"]*"`), ` ${k}="${+Number(v).toFixed(2)}"`);
    tag = tag.replace(' EDITABLE="true"', ' EDITABLE="false"').replace(/ HALIGN="\d+"/, ` HALIGN="${hf.align === 'right' ? 2 : hf.align === 'center' ? 0 : 1}"`)
      .replace(/ FGCOLOR="-?\d+"/, ` FGCOLOR="${ozc(hf.color)}"`).replace(/ FONTSTYLE="\d+"/, ` FONTSTYLE="${hf.bold ? 1 : 0}"`).replace(' AUTOSIZE="true"', ' AUTOSIZE="false"');
    if (hf.todayFallback) tag = tag + ev('OnBind', todayJs);
    else if (hf.fallback) tag = tag + ev('OnBind', fixedJs(hf.fallback));
    xml = xml.replace(mm[0], tag);
  }
  xml = xml.replace(/<OZICSIGNPAD ([^>]*?)FORMID="([^"]+) (\d+)"([^>]*?)ICONSIZE="\d+"/g, (all, a, key, row, b) =>
    `<OZICSIGNPAD ${a}FORMID="${key} ${row}"${b}ICONSIZE="${lay.signIconSizeByRow?.[row] ?? lay.signIconSize}"`);
}
let nExtra = 0;
for (let pg = 1; pg <= lay.pages; pg++) {
  const ex = extraByPage.get(pg) ?? []; const bk = backByPage.get(pg) ?? [];
  if (!ex.length && !bk.length) continue;
  const openRe = new RegExp(`<OZPDFPAGE NAME="PDFPage${pg}"[^>]*>\r?\n`);
  const om = openRe.exec(xml); if (!om) throw new Error('no PDFPage' + pg);
  const close = xml.indexOf('</OZPDFPAGE>', om.index); if (close < 0) throw new Error('no </OZPDFPAGE> for page ' + pg);
  xml = xml.slice(0, close) + ex.join('\r\n') + (ex.length ? '\r\n' : '') + xml.slice(close);
  if (bk.length) xml = xml.slice(0, om.index + om[0].length) + bk.join('\r\n') + '\r\n' + xml.slice(om.index + om[0].length);
  xml = xml.replace(new RegExp(`(<OZPDFPAGE NAME="PDFPage${pg}"[^>]*?COUNT=")(\\d+)(")`), (a, p, n, s) => p + (Number(n) + ex.length + bk.length) + s);
  nExtra += ex.length + bk.length;
}
xml = xml.replace('<OZFORMPARAMS>\r\n</OZFORMPARAMS>', '<OZFORMPARAMS>\r\n<OZFORMPARAM FIELDNAME="document_step" VALUE=""/>\r\n<OZFORMPARAM FIELDNAME="document_step_name" VALUE=""/>\r\n</OZFORMPARAMS>');
if (!xml.includes('FIELDNAME="document_step_name"')) throw new Error('OZFORMPARAMS injection failed');

// gates
const wf = m.validateXmlWellFormedness(xml); if (!wf.ok) throw new Error('XML FAIL ' + wf.errors.join('\n'));
const es = m.validateEventScripts(xml); if (!es.ok) throw new Error('EVENT FAIL ' + JSON.stringify(es.errors));
const strict = m.validateEventScriptsStrict(xml); if (!strict.ok) throw new Error('STRICT FAIL ' + strict.errors.join('\n'));
const expected = fields.length - (lay.headerFields?.length ?? 0) * (lay.style === 'reception' ? 1 : 0);
if (injected !== expected) throw new Error(`OnBind injected ${injected} != fields ${expected}`);

const buf = m.wrapOzrWithResources(xml, [{ name: '1', data: fs.readFileSync(pdfPath) }]);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buf);
if (xmlPath) fs.writeFileSync(xmlPath, xml);
console.log(JSON.stringify({ out: outPath, bytes: buf.length, fields: expected, onBindInjected: injected, extraShapes: nExtra, pages: lay.pages, ...(lay.design ? { bgPages: lay.bgPages, logo: lay.logoPlaced?.rect ?? (lay.logoSlot ? 'none' : undefined) } : {}), formIds: m.extractOzrFormIds(buf).length, coverage: built.coverage.pass }));
