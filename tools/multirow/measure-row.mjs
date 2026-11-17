// Live measurement of the eformsign multirow viewer (방문자 기록부) for tablet capture drivers.
// 2026-10-07 lane D4a — replaces the scratch probes m2.js / v.js / bt.js of the visitor-1 run.
// All coordinates returned are TOP-PAGE CSS px (what Input.dispatch* expects):
//   top page -> OOPIF m_external_view_service (offset measured, ~0,73) -> iframe#viewer_frame (~0,56 inside the OOPIF).
// Row N is located by its row-number SVG text in the left column, so nothing is a fixed coordinate.
//   import { measureRow, measureChrome, rowValues, consentState, oopifOffset } from './measure-row.mjs'
// CLI (read-only): node tools/multirow/measure-row.mjs --port 9242 --tab <id> --row N
import { connect } from './cdp-lib.mjs';

export async function oopifOffset(c) {
  const r = await c.evalTop(`(()=>{const f=[...document.querySelectorAll('iframe')].find(f=>/m_external_(user_)?view_service/.test(f.src));if(!f)return null;const q=f.getBoundingClientRect();return [q.left+f.clientLeft,q.top+f.clientTop]})()`);
  return Array.isArray(r) ? r : [0, 73];
}

const ROW_JS = (n, ox, oy) => `(()=>{
const N=${Number(n)},OX=${ox},OY=${oy};
const vf=document.getElementById('viewer_frame');if(!vf||!vf.contentDocument)return {error:'no viewer_frame'};
const o=vf.getBoundingClientRect(),d=vf.contentDocument;
const R=e=>{const q=e.getBoundingClientRect();return [Math.round(OX+o.left+q.left),Math.round(OY+o.top+q.top),Math.round(q.width),Math.round(q.height)]};
const C=r=>[Math.round(r[0]+r[2]/2),Math.round(r[1]+r[3]/2)];
const vis=e=>{const q=e.getBoundingClientRect();return q.width>0&&q.height>0&&getComputedStyle(e).visibility!=='hidden'};
// Only the OPEN row draws its number as SVG text (done rows show a 「✓ 작성 완료」 band, later rows' numbers are not text),
// so cy of row N = cy of the numbered (open) row + (N - open) * pitch, pitch = spacing of the name-column inputs.
const nums={};[...d.querySelectorAll('text')].filter(vis).forEach(t=>{const k=t.textContent.trim();if(/^[0-9]{1,2}$/.test(k)){const r=R(t);if(r[0]<OX+o.left+95)nums[k]=r[1]+r[3]/2;}});
const ks=Object.keys(nums).map(Number);if(!ks.length)return {error:'no numbered (open) row found'};
let cy=nums[N],cyFrom='number';
if(cy===undefined){const tops=[...d.querySelectorAll('input')].filter(e=>e.type==='text'&&vis(e)).map(R).filter(r=>r[0]>OX+o.left+120&&r[0]<OX+o.left+200&&r[2]>60).map(r=>r[1]).sort((x,y)=>x-y);
 const diffs=tops.slice(1).map((t,i)=>t-tops[i]).filter(x=>x>40).sort((x,y)=>x-y);if(!diffs.length)return {error:'no pitch',tops};
 const pitch=diffs[Math.floor(diffs.length/2)];cy=nums[ks[0]]+(N-ks[0])*pitch;cyFrom='open row '+ks[0]+' + pitch '+pitch;}
const inRow=r=>r[1]<=cy&&cy<=r[1]+r[3];
const inputs=[...d.querySelectorAll('input')].filter(e=>e.type!=='hidden'&&vis(e)).map(e=>({e,r:R(e)})).filter(x=>inRow(x.r)).sort((a,b)=>a.r[0]-b.r[0]);
const texts=inputs.filter(x=>x.e.type==='text');
const time=texts[0],name=texts[1],phone=texts[2],staff=texts.find(x=>x.r[0]>500),sign=inputs.find(x=>x.e.type==='button');
const checks=[...d.querySelectorAll('canvas')].filter(vis).map(R).filter(r=>inRow(r)&&r[2]>=36&&r[2]<=60&&r[0]>330&&r[0]<580).sort((a,b)=>a[0]-b[0]);
const done=[...d.querySelectorAll('text')].filter(t=>/작성 완료/.test(t.textContent)&&vis(t)).map(R).some(r=>Math.abs(r[1]+r[3]/2-cy)<40);
const en=x=>!!x&&!x.e.disabled&&!x.e.readOnly;
const P=x=>x?{rect:x.r,center:C(x.r),value:x.e.value,enabled:en(x)}:null;
return {row:N,cy:Math.round(cy),cyFrom,done,open:en(name),time:time&&time.e.value,name:P(name),phone:P(phone),staff:P(staff),sign:P(sign),
 checks:checks.map(r=>({rect:r,click:[r[0]+6,r[1]+24]})),purposeOrder:['단순 문의','도입 상담','기타']};
})()`;

const CHROME_JS = (ox, oy) => `(()=>{const OX=${ox},OY=${oy};
const R=e=>{const q=e.getBoundingClientRect();return [Math.round(OX+q.left),Math.round(OY+q.top),Math.round(q.width),Math.round(q.height)]};
const C=r=>[Math.round(r[0]+r[2]/2),Math.round(r[1]+r[3]/2)];
const vis=e=>{const q=e.getBoundingClientRect();return q.width>0&&q.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'};
const btn=t=>[...document.querySelectorAll('button,a')].filter(e=>vis(e)&&e.innerText.trim()===t).map(e=>({rect:R(e),center:C(R(e)),cls:String(e.className)})).sort((a,b)=>a.rect[1]-b.rect[1]);
const pad=document.querySelector('canvas.signpad');const padOn=!!pad&&vis(pad);
const txt=document.body.innerText;
return {title:txt.split(String.fromCharCode(10))[0].trim(),start:btn('입력 시작'),send:btn('전송'),ok:btn('확인'),pad:padOn?R(pad):null,
 padInk:padOn?pad.toDataURL().length:0,prog:(txt.match(/필수 입력 항목[(][0-9]+[/][0-9]+[)]/)||[''])[0],
 dialog:/저장|PDF/.test(txt.slice(0,400))};
})()`;

const CONSENT_JS = `(()=>{const t=document.querySelector('#terms_agree');const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='계속');
return {present:!!t,checked:t?t.checked:null,continueDisabled:b?(b.disabled||/disabled/.test(b.className)):null,head:document.body.innerText.slice(0,80)}})()`;

export async function measureRow(c, n) { const [ox, oy] = await oopifOffset(c); return c.evalView(ROW_JS(n, ox, oy)); }
export async function measureChrome(c) { const [ox, oy] = await oopifOffset(c); return c.evalView(CHROME_JS(ox, oy)); }
export async function consentState(c) { return c.evalView(CONSENT_JS); }
export async function rowValues(c, n) {
  const m = await measureRow(c, n); if (!m || m.error) return m;
  return { name: m.name?.value, phone: m.phone?.value, staff: m.staff?.value, done: m.done, open: m.open };
}

if (/measure-row[.]mjs$/.test(process.argv[1] || '')) {
  const argv = process.argv.slice(2); const arg = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
  const c = await connect({ port: arg('--port', '9242'), tab: arg('--tab', ''), metrics: false });
  const out = { offset: await oopifOffset(c), chrome: await measureChrome(c), consent: await consentState(c) };
  if (arg('--row')) out.row = await measureRow(c, Number(arg('--row')));
  console.log(JSON.stringify(out, null, 1)); c.close(); process.exit(0);
}
