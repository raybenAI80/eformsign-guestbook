#!/usr/bin/env node
// Extract the full 「모션그래픽 주문 사전」 catalog (https://nondev-thinking.web.app/motion/) into JSON.
// Sources: index HTML (cards rendered statically), compose.js (prompt assembly), dx.json (detail-level data).
// Usage: node tools/extract-motion-dictionary.mjs [--out docs/marketing/motion-dictionary/catalog.json] [--html local.html]
// Personal study use; prompt templates are stored verbatim with source attribution.
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://nondev-thinking.web.app/motion/';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('--out', 'docs/marketing/motion-dictionary/catalog.json');

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  return r.text();
}

const dec = (s) => String(s ?? '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const strip = (h) => dec(String(h ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? dec(m[1]) : null; };
const sectionText = (h) => dec(h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<(br|\/p|\/li|\/h\d|\/summary|\/div|\/pre)[^>]*>/g, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();

const html = opt('--html') ? fs.readFileSync(opt('--html'), 'utf8') : await get(BASE);
const composeSrc = await get(BASE + 'compose.js');
const dx = JSON.parse(await get(BASE + 'dx.json'));
const C = await import('data:text/javascript;base64,' + Buffer.from(composeSrc).toString('base64'));

// tool prefixes as defined in previews.js TOOLS
const TOOLS = {
  auto: '하이퍼프레임(HyperFrames)으로',
  claude: '/hyperframes 로',
  codex: '$hyperframes 로',
};
const G = { ratio: '가로 16:9', color: '', file: '' }; // site default 공통 설정

// categories
const cats = {};
for (const m of html.matchAll(/<section class="sec" id="cat-([^"]+)"[^>]*><h2[^>]*>([^<]*)<\/h2>(?:<p class="sec-desc">([\s\S]*?)<\/p>)?/g)) {
  cats[m[1]] = { key: m[1], label: strip(m[2]), desc: strip(m[3] || '') };
}

const items = [];
const re = /<article class="mcard"((?:\s+[\w-]+="[^"]*")*)\s*>([\s\S]*?)<\/article>/g;
let m;
while ((m = re.exec(html))) {
  const tag = m[1], body = m[2];
  const id = attr(tag, 'id');
  const cat = attr(tag, 'data-cat');
  const tpl = attr(tag, 'data-tpl');
  const plain = strip((/<p class="plain">([\s\S]*?)<\/p>/.exec(body) || [])[1]);
  const metaSpans = [...((/<div class="meta">([\s\S]*?)<\/div>/.exec(body) || [])[1] || '').matchAll(/<span>([\s\S]*?)<\/span>/g)].map((x) => strip(x[1]));
  const inputs = metaSpans.find((s) => !s.startsWith('⏱') && !s.startsWith('이럴 때')) || '';
  const duration = (metaSpans.find((s) => s.startsWith('⏱')) || '').replace(/^⏱\s*/, '');
  const use = (metaSpans.find((s) => s.startsWith('이럴 때')) || '').replace(/^이럴 때\s*·\s*/, '');
  const warn = strip((/<p class="warn">([\s\S]*?)<\/p>/.exec(body) || [])[1] || '');
  const htmlSimple = strip((/<p class="ask-txt" data-lvl="s">([\s\S]*?)<\/p>/.exec(body) || [])[1] || '');
  const fields = [...body.matchAll(/<label class="fld"><span class="lab">([\s\S]*?)<\/span><input((?:\s+[\w-]+="[^"]*")*)\s*\/?>/g)].map((x) => ({
    k: attr(x[2], 'data-f'), label: strip(x[1]).replace(/\s*선택$/, ''), ex: attr(x[2], 'data-ex'), opt: attr(x[2], 'data-opt') === '1',
  }));
  const inds = [...((/<div class="inds"[^>]*>([\s\S]*?)<\/div>/.exec(body) || [])[1] || '').matchAll(/<span>#?([\s\S]*?)<\/span>/g)].map((x) => strip(x[1]));

  const r = C.makeResolve(fields, {}, G);
  const bodyTxt = C.partsText([...C.composeParts(tpl, r), ...C.composeParts(C.TAIL, r)]);
  const simpleFor = (pre) => C.partsText(C.simpleParts(pre, tpl, r));
  const d = dx[id];
  const detailFor = (pre) => (d && d.dx ? C.partsText(C.detailParts(pre, { tpl, len: d.len, dx: d.dx }, fields, {}, G)) : null);

  items.push({
    id,
    code_prefix: id.replace(/\d+$/, ''),
    category: cat,
    category_label: cats[cat]?.label || null,
    name_ko: attr(tag, 'data-name'),
    name_en: attr(tag, 'data-en'),
    description: plain,
    inputs,
    duration,
    use_cases: use,
    warn: warn || null,
    is_3d: attr(tag, 'data-d3') === '1',
    tags: inds,
    prompt_template: tpl,
    fields,
    prompt_common: simpleFor(TOOLS.auto),
    prompt_simple: bodyTxt,
    prompt_claude: simpleFor(TOOLS.claude),
    prompt_codex: simpleFor(TOOLS.codex),
    prompt_detailed: detailFor(TOOLS.auto),
    detail_data: d ? d.dx : null,
    _html_simple_matches: strip(htmlSimple) === simpleFor(TOOLS.auto).replace(/\s+/g, ' ').trim(),
  });
}

// formula (#how) + setup (#start)
const sec = (id) => { const i = html.indexOf(`id="${id}"`); if (i < 0) return null; const st = html.lastIndexOf('<', i); return sectionText(html.slice(st, html.indexOf('</section>', i))); };
const heroCounts = sectionText((/<header[\s\S]*?<\/header>/.exec(html) || [''])[0]).slice(0, 400);

const out = {
  source: BASE,
  title: '모션그래픽 주문 사전',
  collected_at: new Date().toISOString(),
  usage_note: '개인 학습 자료 — 프롬프트 원문은 출처(nondev-thinking.web.app/motion, 모두의 AI 교실) 그대로 보존',
  data_sources: [BASE, BASE + 'compose.js', BASE + 'dx.json', BASE + 'previews.js'],
  tool_prefixes: TOOLS,
  default_settings: G,
  compose_rules: {
    tail: C.TAIL,
    move_preamble: C.MOVE,
    avoid_common: C.AVOID,
    note: '간단 = 부르는 말 + 카드 tpl + 꼬리(비율·색). 자세히 = 간단 + [길이·크기][장면 순서][볼거리 한 번][모양][움직임][하지 말 것]. {칸} 비면 필수=예시값, 선택칸 [[…]] 구절은 통째로 빠짐.',
  },
  categories: Object.values(cats).map((c) => ({ ...c, count: items.filter((x) => x.category === c.key).length })),
  counts: { total: items.length, is_3d: items.filter((x) => x.is_3d).length, hero: heroCounts },
  formula_section: sec('how'),
  setup_section: sec('start'),
  items,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`wrote ${OUT}: ${items.length} items, ${out.categories.length} categories, 3D ${out.counts.is_3d}, html-simple mismatch ${items.filter((x) => !x._html_simple_matches).length}`);
