#!/usr/bin/env node
/**
 * 쉬운 말 게이트 — 화면에 보이는 글에서 개발자 용어를 찾아낸다.
 *
 *   node tools/check-plain-language.mjs setup.html
 *
 * 검사 대상 : HTML 의 **표시 텍스트 노드**만.
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
    console.log(`쉬운 말 게이트 통과 — 금칙어 0건 (${targets.join(', ')})`);
    process.exit(0);
  }
  console.log(`\n금칙어 ${hits}건 검출 — 화면 문안을 고치세요.`);
  process.exit(1);
}

main();
