// Open a MEMBER participant step of a multirow document without a logged-in browser session:
// embedding (efs_embedded_v2) with user.type "01" + the API member's access/refresh token (issued at request time,
// never written to disk) and mode.type "02" (process an existing document). Serves the page on http://localhost:<port>/
// so a scratch headless Chrome (own profile) can load it — replaces the dead logged-in capture Chrome (9223) path.
// node embed-member.mjs --doc <.local/.../doc.json> [--port 8766]
// Env: EFORMSIGN_ENV_FILE, EFORMSIGN_CORE_DIR (tools/multirow/env.mjs). The HTML (with tokens) lives only in memory.
import fs from 'node:fs';
import http from 'node:http';
import { client } from './env.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const port = Number(arg('--port', '8766'));
const c = await client();
const company = await c.http.getCompany();
const page = async () => {
  const d = JSON.parse(fs.readFileSync(arg('--doc'), 'utf8'));
  const tok = await c.tokens.getOAuthToken({ member: process.env.EFORMSIGN_MEMBER_ID });
  const opt = {
    company: { id: company.id, country_code: 'kr' },
    user: { type: '01', id: process.env.EFORMSIGN_MEMBER_ID, access_token: tok.access_token, refresh_token: tok.refresh_token },
    mode: { type: '02', template_id: d.templateId, document_id: d.documentId },
    layout: { lang_code: 'ko', header: true },
  };
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>embed member</title>
<style>html,body{margin:0;height:100%}#eformsign_iframe{width:100%;height:100%;border:0}</style>
<iframe id="eformsign_iframe" allow="camera; microphone; clipboard-write"></iframe>
<script src="https://www.eformsign.com/plugins/jquery/jquery.min.js"></script>
<script src="https://www.eformsign.com/lib/js/efs_embedded_v2.js"></script>
<script>
window.__ev=[];function log(k,v){var s=k+' '+(function(){try{return JSON.stringify(v)}catch(e){return String(v)}})();window.__ev.push(s.slice(0,400));}
addEventListener('message',function(e){if(String(e.origin).indexOf('eformsign')<0)return;log('msg',String(typeof e.data==='string'?e.data:JSON.stringify(e.data)).slice(0,300));});
var efs=new EformSignDocument();
efs.document(${JSON.stringify(opt)},'eformsign_iframe',function(r){log('success',r)},function(r){log('error',r)},function(r){log('action',r)});
efs.open();
</script>`;
};
http.createServer(async (q, s) => {
  if (q.url !== '/') { s.writeHead(404); return s.end(); }
  try { const h = await page(); s.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); s.end(h); }
  catch (e) { s.writeHead(500); s.end(String(e.message).slice(0, 200)); }
}).listen(port, '127.0.0.1');
console.log(`serving http://localhost:${port}/ (pid ${process.pid})`);
