// Open an EXTERNAL recipient's step of a probe document through embedding (mode.type "02").
// Generates a local HTML (values injected; written under .local only, never committed) and serves it on
// http://localhost:<port>/ so the capture Chrome can open it. Company/token come from the API at run time.
// node embed-probe.mjs --doc <.local/multirow/doc3-external.json> --visitor <N> --out <.local/...html> [--port 8765] [--serve]
import fs from 'node:fs';
import http from 'node:http';
import { client } from './env.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const d = JSON.parse(fs.readFileSync(arg('--doc'), 'utf8'));
const c = await client();
const company = await c.http.getCompany();
const g = await c.documents.get(d.documentId, { includeExternalToken: true });
const n = Number(arg('--visitor', '1'));
const r = (g.recipients ?? []).find((x) => String(x.id).startsWith(`visitor${n}@`));
if (!r?.token_id) throw new Error(`no external token for visitor${n} (current step: ${g.current_status?.step_name})`);
console.log('current step', g.current_status?.step_name, '| token for', `visitor${n}`, 'present');
const opt = {
  company: { id: company.id, country_code: 'kr' },
  user: { type: '02', external_token: r.token_id, external_user_info: { name: r.name } },
  mode: { type: '02', template_id: d.templateId, document_id: d.documentId },
  layout: { lang_code: 'ko', header: true },
};
const html = `<!doctype html><meta charset="utf-8"><title>embed probe</title>
<style>html,body{margin:0;height:100%}#eformsign_iframe{width:100%;height:100%;border:0}#log{position:fixed;left:0;bottom:0;font:11px monospace;background:#ffe;max-height:30%;overflow:auto;margin:0}</style>
<iframe id="eformsign_iframe" allow="camera; microphone; clipboard-write"></iframe><pre id="log"></pre>
<script src="https://www.eformsign.com/plugins/jquery/jquery.min.js"></script>
<script src="https://www.eformsign.com/lib/js/efs_embedded_v2.js"></script>
<script>
window.__ev=[];function log(k,v){var s=k+' '+(function(){try{return JSON.stringify(v)}catch(e){return String(v)}})();window.__ev.push(s);document.getElementById('log').textContent+=s.slice(0,300)+String.fromCharCode(10);}
window.completeWriteDocument=function(data,src){log('completeWriteDocument',data);try{src&&src.postMessage&&src.postMessage(JSON.stringify({type:'document',fn:'completeWriteDocumentCallback',message:{}}),'*')}catch(e){}};
addEventListener('message',function(e){if(String(e.origin).indexOf('eformsign')<0)return;log('msg',String(typeof e.data==='string'?e.data:JSON.stringify(e.data)).slice(0,300));});
var efs=new EformSignDocument();
efs.document(${JSON.stringify(opt)},'eformsign_iframe',function(r){log('success',r)},function(r){log('error',r)},function(r){log('action',r)});
efs.open();
</script>`;
fs.writeFileSync(arg('--out'), html);
console.log('wrote', arg('--out'));
if (process.argv.includes('--serve')) {
  const port = Number(arg('--port', '8765'));
  http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(fs.readFileSync(arg('--out'))); }).listen(port, '127.0.0.1');
  console.log(`serving http://localhost:${port}/ (pid ${process.pid})`);
}
