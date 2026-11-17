// Server-only latency of the multirow endpoint (no browser). Alternates plain and ?last=<doc> calls.
// node tools/perf/api-latency.mjs --url https://<deployment>/api/multirow [--n 6]
// Prints one JSON line per call (ms, status, x-vercel-id, trace) and a summary (median/min/max).
// Note: the call reuses the open sheet; it creates a new document only if none is open, so check the document list before and after.
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url');
const n = Number(arg('n', 6));
if (!url) { console.error('usage: node tools/perf/api-latency.mjs --url <https://host/api/multirow> [--n 6]'); process.exit(2); }

async function one(u) {
  const t0 = performance.now();
  const res = await fetch(u, { headers: { 'cache-control': 'no-cache' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let j = {}; try { j = JSON.parse(text); } catch { /* not json */ }
  return { ms, status: res.status, vercelId: res.headers.get('x-vercel-id'), documentId: j.document_id, created: j.created, log: j.log };
}
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, median: s[Math.floor((s.length - 1) / 2)], min: s[0], max: s[s.length - 1] }; };

const plain = [], last = [];
let docId = null;
for (let i = 0; i < n; i++) {
  const a = await one(url);
  console.log(JSON.stringify({ kind: 'plain', i, ...a }));
  plain.push(a.ms); docId = docId || a.documentId;
  if (docId) {
    const b = await one(url + (url.includes('?') ? '&' : '?') + 'last=' + docId);
    console.log(JSON.stringify({ kind: 'last', i, ...b }));
    last.push(b.ms);
  }
}
console.log(JSON.stringify({ summary: { plain: stat(plain), last: last.length ? stat(last) : null, plainFirst: plain[0], plainRest: plain.length > 1 ? stat(plain.slice(1)) : null } }));
