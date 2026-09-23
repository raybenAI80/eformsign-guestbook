#!/usr/bin/env node
/**
 * 쉬운 말 게이트 (영상 원고용).
 *
 *   node tools/check-script.mjs
 *
 * 대상 = src/script.ts 의 **표시 텍스트**뿐이다.
 *   · captions[] · footnote · narration · tts · CUT15[].captions
 *   · label / note 는 작업용 메모라 화면에 나오지 않으므로 검사하지 않는다.
 *
 * 금칙어 두 묶음:
 *   (가) 방명록 상품판 고객 문서와 같은 개발자 용어 집합
 *        (상품 저장소 루트 ../tools/check-plain-language.mjs 에서 가져왔다)
 *   (나) 이 영상 전용 추가 금칙 — 기획서 10절
 *        · 자막 헤드라인의 「태블릿」 「설치」 「무인 키오스크」 (주인공은 이폼사인)
 *        · 가격 숫자·「무료」 (가격 정책은 유동)
 *
 * 추가 검사:
 *   · 조사 띄어쓰기 — 숫자·로마자 뒤에 띄어 쓴 조사(「PDF 를」)를 잡는다.
 *     이 영상은 자막이 곧 화면이라 붙여 쓰고 nowrap 으로 묶어야 한다.
 *   · 자막 한 줄 길이 — 디스플레이형 권장 15~25자. 넘으면 경고(FAIL 아님).
 *
 * 종료 코드: 위반 0 이면 0, 하나라도 있으면 1.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "src", "script.ts");

/** (가) 개발자 용어 — [정규식, 이름, 권하는 표현] */
const BANNED_DEV = [
  [/저장소/g, "저장소", "원본 파일 / 파일 보관함"],
  [/리포지토리/g, "리포지토리", "원본 파일"],
  [/복제/g, "복제", "내 계정으로 복사"],
  [/빌드/g, "빌드", "설치 준비"],
  [/환경\s*변수/g, "환경변수", "설정값"],
  [/재배포|리배포/g, "재배포", "다시 설치"],
  [/배포/g, "배포", "설치"],
  [/\bre-?deploy\b/gi, "Redeploy", "다시 설치"],
  [/\bdeploy(ment)?\b/gi, "deploy", "설치"],
  [/HTTPS/gi, "HTTPS", "자물쇠 표시가 있는 주소"],
  [/도메인/g, "도메인", "인터넷 주소"],
  [/iframe|아이프레임/gi, "iframe", "작성 화면 틀"],
  [/\bzip\b|집파일/gi, "zip", "파일 묶음"],
  [/\bCLI\b/g, "CLI", "명령 창"],
  [/터미널/g, "터미널", "명령 창"],
  [/커밋/g, "커밋", "고친 내용 저장"],
  [/푸시/g, "푸시", "고친 파일 올리기"],
  [/엔드포인트/g, "엔드포인트", "주소"],
  [/API\s*키/gi, "API 키", "연결 열쇠"],
  [/콜백|callback/gi, "콜백", "끝나면 돌아오는 화면"],
  [/임베[드딩]/g, "임베드", "화면 안에 넣기"],
  [/템플릿\s*ID|회사\s*ID/gi, "ID 노출", "화면에 쓰지 않는다"],
];

/** (나) 이 영상 전용 금칙 — 기획서 10절 */
const BANNED_PROMO = [
  [/태블릿/g, "태블릿", "장비는 화면에 보일 뿐 말로 팔지 않는다"],
  [/무인\s*키오스크|키오스크/g, "키오스크", "장비 이름을 쓰지 않는다"],
  [/설치/g, "설치", "주인공은 이폼사인이다"],
  [/무료/g, "무료", "가격 표현 금지"],
  [/\b\d[\d,]*\s*원\b/g, "가격 숫자", "가격 숫자·암시 금지"],
  [/월\s*\d/g, "월 요금", "가격 숫자·암시 금지"],
  [/공짜|할인|특가/g, "가격 암시", "가격 표현 금지"],
];

const JOSA = [
  "이라고", "라고", "이면", "라면", "에서", "까지", "부터", "으로",
  "은", "는", "이", "가", "을", "를", "에", "로", "와", "과", "도", "만", "의",
];
const JOSA_RE = new RegExp(
  "([0-9A-Za-z%~][0-9A-Za-z%~.+_-]*)(\\s+)(" + JOSA.join("|") + ")(?![\\uac00-\\ud7a3])",
  "g",
);

/** script.ts 에서 표시 텍스트만 뽑는다 — 검사 대상 키를 화이트리스트로 둔다 */
const DISPLAY_KEYS = ["captions", "footnote", "narration", "tts"];

function extractDisplayText(src) {
  const items = [];
  const lines = src.split("\n");

  let inCaptions = false;
  lines.forEach((raw, idx) => {
    const ln = idx + 1;
    const line = raw.trim();

    // 주석 줄은 화면에 안 나온다
    if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) return;

    // captions 배열이 여러 줄로 펼쳐진 경우
    if (/^captions:\s*\[\s*$/.test(line)) { inCaptions = true; return; }
    if (inCaptions) {
      if (/^\],?$/.test(line)) { inCaptions = false; return; }
      for (const m of line.matchAll(/"([^"]*)"/g)) {
        items.push({ ln, key: "captions", text: m[1] });
      }
      return;
    }

    // 한 줄짜리 captions: ["…", "…"]
    const one = line.match(/^captions:\s*\[(.*)\],?$/);
    if (one) {
      for (const m of one[1].matchAll(/"([^"]*)"/g)) {
        items.push({ ln, key: "captions", text: m[1] });
      }
      return;
    }

    // footnote / narration / tts (다음 줄로 이어지는 문자열 포함)
    const kv = line.match(/^(footnote|narration|tts):\s*(.*)$/);
    if (kv) {
      const rest = kv[2];
      const strs = [...rest.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      if (strs.length) {
        strs.forEach((t) => items.push({ ln, key: kv[1], text: t }));
      }
      return;
    }

    // 값이 다음 줄로 내려간 문자열 (narration: \n  "…")
    if (/^"[^"]*",?$/.test(line)) {
      const prev = (lines[idx - 1] || "").trim();
      if (/^(footnote|narration|tts):\s*$/.test(prev)) {
        items.push({ ln, key: prev.replace(":", "").trim(), text: line.replace(/^"|",?$/g, "") });
      }
    }
  });

  return items.filter((i) => DISPLAY_KEYS.includes(i.key));
}

function main() {
  const src = fs.readFileSync(SCRIPT, "utf8");
  const items = extractDisplayText(src);

  if (items.length === 0) {
    console.error("FAIL: 표시 텍스트를 하나도 못 뽑았다 — 추출기가 script.ts 형식과 어긋난다");
    process.exit(1);
  }

  const fails = [];
  const warns = [];

  for (const it of items) {
    // 나레이션에는 태블릿/설치 금칙이 자막 헤드라인 기준보다 느슨할 수 있으나,
    // 기획서 10절이 "말로 팔지 않는다"이므로 나레이션에도 똑같이 적용한다.
    for (const [re, name, fix] of [...BANNED_DEV, ...BANNED_PROMO]) {
      re.lastIndex = 0;
      const m = re.exec(it.text);
      if (m) fails.push({ ...it, kind: "금칙어", name, fix, hit: m[0] });
    }

    JOSA_RE.lastIndex = 0;
    let jm;
    while ((jm = JOSA_RE.exec(it.text)) !== null) {
      fails.push({
        ...it,
        kind: "조사 띄어쓰기",
        name: `${jm[1]} ${jm[3]}`,
        fix: `${jm[1]}${jm[3]} 으로 붙여 쓰고 nowrap 으로 묶는다`,
        hit: jm[0],
      });
    }

    if (it.key === "captions") {
      const len = [...it.text].length;
      if (len > 25) warns.push({ ...it, why: `자막 한 줄 ${len}자 — 디스플레이형 권장 15~25자` });
    }
  }

  console.log(`검사 대상 표시 텍스트 ${items.length}개 (captions/footnote/narration/tts)`);

  for (const w of warns) {
    console.log(`  WARN  script.ts:${w.ln}  ${w.why}\n        "${w.text}"`);
  }

  if (fails.length === 0) {
    console.log(`PASS  금칙어 0건 · 조사 띄어쓰기 0건 · 경고 ${warns.length}건`);
    process.exit(0);
  }

  for (const f of fails) {
    console.log(`  FAIL  script.ts:${f.ln}  [${f.kind}] ${f.name}  → ${f.fix}`);
    console.log(`        "${f.text}"`);
  }
  console.log(`FAIL  ${fails.length}건`);
  process.exit(1);
}

main();
