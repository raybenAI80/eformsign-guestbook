#!/usr/bin/env node
/**
 * 쉬운 말 게이트 — 화면에 보이는 글에서 개발자 용어를 찾아낸다.
 *
 *   node tools/check-plain-language.mjs setup.html
 *
 * 검사 1 (금칙어)   : HTML 의 **표시 텍스트 노드**만.
 * 검사 2 (조사 띄어쓰기): 숫자·로마자 뒤에 띄어 쓴 조사(「0 이면」·「Create 를」)를 FAIL 로 잡는다.
 *                     표시 텍스트 노드 + <script> 안의 한글 문자열까지 본다(주석은 뺀다).
 *                     규칙 = 숫자/로마자 + 조사는 붙여 쓰고 그 덩어리를 <span class="nb"> 로 묶는다.
 * 검사 제외 : <script> · <style> 안, 괄호 안의 원어, data-term-ok 속성이 붙은 요소와 그 자식
 *            (Vercel 화면에 실제로 보이는 영문 버튼 이름을 그대로 인용할 때 쓴다).
 * 종료 코드 : 검출 0 이면 0, 하나라도 있으면 1.
 */
import fs from 'node:fs';
import path from 'node:path';

/** 금칙어 — [정규식, 사람이 읽는 이름, 권하는 표현] */
const BANNED = [
  [/저장소/g, '저장소', '원본 파일 / 파일 보관함'],
  [/리포지토리/g, '리포지토리', '원본 파일'],
  [/복제/g, '복제', '내 계정으로 복사'],
  [/빌드/g, '빌드', '설치 준비'],
  [/환경\s*변수/g, '환경변수', '설정값(환경변수)'],
  [/재배포|리배포/g, '재배포', '다시 설치'],
  [/배포/g, '배포', '설치'],
  [/\bre-?deploy\b/gi, 'Redeploy', '다시 설치 (버튼 이름 인용이면 data-term-ok)'],
  [/\bdeploy(ment)?\b/gi, 'deploy', '설치 (버튼 이름 인용이면 data-term-ok)'],
  [/HTTPS/gi, 'HTTPS', '자물쇠 표시가 있는 주소'],
  [/도메인/g, '도메인', '인터넷 주소'],
  [/iframe|아이프레임/gi, 'iframe', '작성 화면 틀'],
  [/\bzip\b|집파일/gi, 'zip', '파일 묶음'],
  [/\bCLI\b/g, 'CLI', '명령 창'],
  [/터미널/g, '터미널', '명령 창'],
];

/** 조사 목록 — 긴 것부터 (앞의 대안이 먼저 맞는다) */
const JOSA = ['이라고','라고','이면','라면','에서','까지','부터','으로','은','는','이','가','을','를','에','로','와','과','도','만','의'];
/**
 * 문서 전체(줄바꿈 포함)에서 쓰는 검사 — <code>/<b>/<span> 같은 인라인 태그가
 * 용어와 조사 사이에 끼어 있어도, 태그를 지우고 이어붙이면 같은 문구다.
 * 구분자를 \s+ 로 잡아 개행·들여쓰기로 갈라진 경우도 잡는다.
 * (붙어 있으면, 즉 구분자가 전혀 없으면 이미 올바른 표기이므로 매치되지 않는다.)
 */
const JOSA_RE_WHOLE = new RegExp('([0-9A-Za-z%~][0-9A-Za-z%~.+_-]*)(\\s+)(' + JOSA.join('|') + ')(?![\\uac00-\\ud7a3])', 'g');

/**
 * 주석 줄을 빈 줄로 만든다 — 주석은 화면에 안 보이므로 조사 검사 대상이 아니다.
 * 줄 단위 상태기계로 본다(정규식 한 방으로 뭉텅이 제거하면 본문까지 함께 사라진다 — 실측 확인).
 */
function blankCommentLines(src) {
  let inBlock = false;   // CSS/JS 블록 주석
  let inHtml = false;    // HTML 주석
  return src.split('\n').map((ln) => {
    const t = ln.trim();
    let drop = false;
    if (inBlock) { drop = true; if (t.includes('*' + '/')) inBlock = false; return ''; }
    if (inHtml) { drop = true; if (t.includes('-->')) inHtml = false; return ''; }
    if (t.startsWith('<!--')) { if (!t.includes('-->')) inHtml = true; return ''; }
    if (t.startsWith('/*')) { if (!t.includes('*' + '/')) inBlock = true; return ''; }
    if (t.startsWith('*') || t.startsWith('//')) return '';
    return drop ? '' : ln;
  }).join('\n');
}

const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

/** 아주 작은 HTML 워커 — 텍스트 노드를 (줄번호, 글) 로 뽑는다. */
function textNodes(html) {
  const out = [];
  const stack = [];       // { tag, skip }
  let skipDepth = 0;      // data-term-ok / script / style 안이면 > 0
  let i = 0;
  let line = 1;
  const bump = (s) => { for (let k = 0; k < s.length; k++) if (s[k] === '\n') line++; };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      if (!skipDepth) out.push([line, html.slice(i)]);
      break;
    }
    if (lt > i) {
      const t = html.slice(i, lt);
      if (!skipDepth && t.trim()) out.push([line, t]);
      bump(t);
    }
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      const seg = html.slice(lt, end === -1 ? html.length : end + 3);
      bump(seg);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt === -1) break;
    const raw = html.slice(lt, gt + 1);
    const m = /^<\s*(\/?)\s*([a-zA-Z][\w-]*)/.exec(raw);
    if (m) {
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      const selfClose = /\/\s*>$/.test(raw) || VOID.has(tag);
      if (closing) {
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].tag === tag) {
            for (let j = stack.length - 1; j >= k; j--) {
              if (stack[j].skip) skipDepth--;
              stack.pop();
            }
            break;
          }
        }
      } else if (!selfClose) {
        const skip = tag === 'script' || tag === 'style' || /\sdata-term-ok(\s|=|>|\/)/.test(raw);
        stack.push({ tag, skip });
        if (skip) skipDepth++;
      }
    }
    bump(raw);
    i = gt + 1;
  }
  return out;
}

/** 괄호 안(원어 병기)은 검사에서 뺀다. */
function stripParens(s) {
  return s.replace(/\([^()]*\)/g, ' ').replace(/（[^（）]*）/g, ' ');
}

function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

function main() {
  const targets = process.argv.slice(2);
  if (!targets.length) {
    console.error('사용법: node tools/check-plain-language.mjs <파일.html> [...]');
    process.exit(2);
  }
  let hits = 0;
  for (const rel of targets) {
    const file = path.resolve(rel);
    if (!fs.existsSync(file)) {
      console.error(`파일이 없습니다: ${file}`);
      process.exit(2);
    }
    const html = fs.readFileSync(file, 'utf8');

    // ── 검사 2: 숫자·로마자(코드 용어 포함) 뒤에 띄어 쓴 조사 ──
    // 태그를 지우고 문서 전체를 이어붙여 스캔한다 — <code>KIOSK_CONFIG</code> 라고
    // 처럼 인라인 태그가 용어와 조사 사이에 끼어도, 줄이 바뀌어도 놓치지 않는다.
    const blanked = blankCommentLines(html);
    const stripped = decodeEntities(blanked.replace(/<[^>]*>/g, ''));
    JOSA_RE_WHOLE.lastIndex = 0;
    let jm;
    while ((jm = JOSA_RE_WHOLE.exec(stripped))) {
      hits++;
      const lineNo = stripped.slice(0, jm.index).split('\n').length;
      const term = jm[1];
      const josa = jm[3];
      const ctxStart = Math.max(0, jm.index - 30);
      const ctxEnd = Math.min(stripped.length, jm.index + jm[0].length + 20);
      const snippet = stripped.slice(ctxStart, ctxEnd).replace(/\s+/g, ' ').trim();
      console.log(`${rel}:${lineNo}  조사 띄어쓰기 「${term} ${josa}」 → 「${term}${josa}」 로 붙여 쓰고 <span class="nb"> 로 묶으세요`);
      console.log(`    … ${snippet}`);
    }

    // ── 검사 1: 금칙어 ──
    for (const [line, raw] of textNodes(html)) {
      const text = stripParens(decodeEntities(raw));
      for (const [re, name, better] of BANNED) {
        re.lastIndex = 0;
        if (re.test(text)) {
          hits++;
          const near = raw.trim().replace(/\s+/g, ' ').slice(0, 70);
          console.log(`${rel}:${line}  금칙어 「${name}」 → 「${better}」 로 바꾸세요`);
          console.log(`    … ${near}`);
        }
      }
    }
  }
  if (hits === 0) {
    console.log(`쉬운 말 게이트 통과 — 금칙어 0건 · 조사 띄어쓰기 0건 (${targets.join(', ')})`);
    process.exit(0);
  }
  console.log(`\n금칙어·조사 띄어쓰기 합계 ${hits}건 검출 — 화면 문안을 고치세요.`);
  process.exit(1);
}

main();
