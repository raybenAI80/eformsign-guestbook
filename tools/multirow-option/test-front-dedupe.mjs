// 화면(index.html)의 /api/multirow 중복 요청 방지 검사(브라우저 없음): node tools/multirow-option/test-front-dedupe.mjs
// index.html 에서 fetchMultirow 부분만 잘라 가짜 fetchMultirowOnce 와 함께 실행한다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const a = html.indexOf('var mrInflight = null;');
const b = html.indexOf('function fetchMultirowOnce(url)');
assert.ok(a > 0 && b > a, 'index.html 에서 fetchMultirow 를 찾지 못함');
const src = html.slice(a, b);
const make = () => {
  const calls = []; const pending = [];
  const state = { submits: 0 };
  const fetchMultirowOnce = (url) => { calls.push(url); return new Promise((res, rej) => pending.push({ res, rej })); };
  const fetchMultirow = new Function('state', 'fetchMultirowOnce', src + '\nreturn fetchMultirow;')(state, fetchMultirowOnce);
  return { calls, pending, state, fetchMultirow };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

// ① 진행 중에 또 불러도 요청은 1개, 같은 결과
{ const t = make(); const p1 = t.fetchMultirow(''); const p2 = t.fetchMultirow('x'); assert.equal(t.calls.length, 1); assert.equal(p1, p2); t.pending[0].res({ ok: 1 }); await p1; }
// ② 끝난 뒤에는 새 요청
{ const t = make(); const p1 = t.fetchMultirow(''); t.pending[0].res({}); await p1; await tick(); t.fetchMultirow(''); assert.equal(t.calls.length, 2); }
// ③ 실패 재시도는 이전 요청이 끝난 뒤에만(끝나기 전엔 같은 요청을 공유, 실패 뒤엔 새 요청)
{ const t = make(); const p1 = t.fetchMultirow(''); const p2 = t.fetchMultirow(''); assert.equal(t.calls.length, 1); t.pending[0].rej(new Error('x')); await p1.catch(() => {}); await p2.catch(() => {}); await tick(); t.fetchMultirow(''); assert.equal(t.calls.length, 2); }
// ④ 제출 뒤에는 제출 전에 시작한 요청을 재사용하지 않는다
{ const t = make(); t.fetchMultirow(''); t.state.submits = 1; t.fetchMultirow('doc'); assert.equal(t.calls.length, 2); }
console.log('PASS front dedupe 4 checks');
