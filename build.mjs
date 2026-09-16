/**
 * 정적 산출물 빌드 — 환경변수를 config.js 로 바꾸고 배포 디렉터리를 만든다.
 *
 * 왜 필요한가: Vercel 「Deploy」 버튼으로 설치하면 고객이 저장소 파일(config.js)을 직접 고칠 수
 * 없다. 그래서 프로젝트 설정 > Environment Variables 에 넣은 값으로 config.js 를 만들어 준다.
 *
 *   node build.mjs              → public/ 에 index.html · setup.html · config.js · assets/ 를 만든다
 *   KIOSK_CONFIG=<설정 마법사가 만든 한 줄> node build.mjs
 *
 * 우선순위 (위가 이긴다):
 *   1. KIOSK_CONFIG — 설정 마법사가 만든 한 줄(JSON 을 UTF-8 → base64url 로 인코딩한 값).
 *                     고객이 Vercel 화면에서 붙여 넣는 값이 바로 이것이다. 칸 하나만 채우면 된다.
 *   2. KIOSK_*      — 항목별 개별 환경변수. 고급(수동 설정) 경로이며 하위 호환으로 남긴다.
 *   3. 둘 다 없으면 저장소의 config.js 를 그대로 복사한다
 *      (정적 파일 묶음·직접 편집 경로를 깨지 않기 위해서).
 * 의존성 0 — Node 내장 모듈만 쓴다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(ROOT, process.env.KIOSK_OUT_DIR || 'public');

/** 환경변수 계약 — 이 표가 README 의 환경변수 표와 1:1 이다. */
const ENV_MAP = [
  // [환경변수, config 키, 형변환]
  ['KIOSK_PRODUCT_NAME',      'productName',        'string'],
  ['KIOSK_COMPANY_ID',        'companyId',          'string'],
  ['KIOSK_FORM_ID',           'templateId',         'string'],
  ['KIOSK_COUNTRY_CODE',      'countryCode',        'string'],
  ['KIOSK_LANG_CODE',         'langCode',           'string'],
  ['KIOSK_COMPANY_NAME',      'companyName',        'string'],
  ['KIOSK_LOGO_URL',          'logoUrl',            'string'],
  ['KIOSK_TITLE',             'title',              'string'],
  ['KIOSK_SUBTITLE',          'subtitle',           'string'],
  ['KIOSK_VISITOR_NAME',      'visitorName',        'string'],
  ['KIOSK_MODE',              'mode',               'mode'],
  ['KIOSK_THANKS_MESSAGE',    'thanksMessage',      'string'],
  ['KIOSK_THANKS_SUBMESSAGE', 'thanksSubMessage',   'string'],
  ['KIOSK_THANKS_SECONDS',    'thanksSeconds',      'number'],
  ['KIOSK_IDLE_SECONDS',      'idleResetSeconds',   'number'],
  ['KIOSK_ABANDON_SECONDS',   'abandonResetSeconds','number'],
  ['KIOSK_COUNTDOWN_SECONDS', 'countdownSeconds',   'number'],
  ['KIOSK_LOAD_WATCH_SECONDS','loadWatchSeconds',   'number'],
  ['KIOSK_SHOW_HEADER',       'showHeader',         'boolean'],
  ['KIOSK_HIDE_REQUEST_POPUP','hideRequestPopup',   'boolean'],
  ['KIOSK_DEBUG',             'debug',              'boolean'],
];

const DEFAULTS = {
  productName: '이폼사인 방명록',
  companyId: '', templateId: '', countryCode: 'kr', langCode: 'ko',
  companyName: '', logoUrl: '',
  title: '문서 작성',
  subtitle: '내용을 작성한 뒤 전송을 눌러 주세요.',
  visitorName: '작성자',
  mode: 'thanks', thanksSeconds: 5,
  thanksMessage: '작성해 주셔서 감사합니다.',
  thanksSubMessage: '잠시 후 처음 화면으로 돌아갑니다.',
  idleResetSeconds: 120, abandonResetSeconds: 180, countdownSeconds: 5,
  // 서식 로드 감시 시간(초). 이 시간 안에 작성 화면이 안 뜨면 담당자 확인 안내를 띄운다.
  loadWatchSeconds: 25,
  showHeader: true, hideRequestPopup: true, debug: false,
};

function coerce(kind, raw) {
  if (kind === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`숫자가 아닙니다: "${raw}"`);
    return n;
  }
  if (kind === 'boolean') return /^(1|true|yes|on)$/i.test(String(raw).trim());
  if (kind === 'mode') {
    const v = String(raw).trim();
    if (v !== 'immediate' && v !== 'thanks') throw new Error(`mode 는 immediate 또는 thanks 여야 합니다: "${raw}"`);
    return v;
  }
  return String(raw);
}

/** config 객체에서 실제로 인정하는 키 — 설정 마법사가 만드는 것과 같다. */
const CONFIG_KEYS = new Set([
  ...ENV_MAP.map(([, key]) => key),
  'thanksMessage', 'thanksSubMessage', 'prefill',
]);

/**
 * KIOSK_CONFIG 한 줄을 풀어 config 객체로 만든다.
 * 실패하면 왜 실패했는지 한국어로 알려 주고 빌드를 멈춘다(exit 1).
 */
export function decodeKioskConfig(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let json = '';
  try {
    json = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch (e) {
    json = '';
  }
  if (!json || json.indexOf('{') === -1) {
    throw new Error('값을 풀지 못했습니다. 설정 마법사의 「설정값 복사」 버튼으로 복사한 값을 그대로 붙여 넣었는지 확인하세요.');
  }
  let obj;
  try {
    obj = JSON.parse(json);
  } catch (e) {
    throw new Error('안에 든 내용이 설정값 형식이 아닙니다(JSON 아님). 값이 중간에 잘리지 않았는지 확인하세요.');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('안에 든 내용이 설정값 형식이 아닙니다. 설정 마법사에서 값을 다시 복사해 주세요.');
  }
  const missing = [];
  if (!obj.companyId) missing.push('회사 ID(companyId)');
  if (!obj.templateId) missing.push('서식 ID(templateId)');
  if (missing.length) {
    throw new Error(missing.join(' · ') + ' 이(가) 없습니다. 설정 마법사 1단계에서 서식 주소를 다시 읽어 주세요.');
  }
  const picked = {};
  for (const [k, v] of Object.entries(obj)) if (CONFIG_KEYS.has(k)) picked[k] = v;
  return picked;
}

/** 환경변수에서 읽은 값만 모은다(빈 문자열은 "지정하지 않음"으로 본다). */
export function readEnvConfig(env = process.env) {
  const found = {};
  const problems = [];
  for (const [envName, key, kind] of ENV_MAP) {
    const raw = env[envName];
    if (raw === undefined || String(raw).trim() === '') continue;
    try { found[key] = coerce(kind, raw); }
    catch (e) { problems.push(`${envName}: ${e.message}`); }
  }
  return { found, problems };
}

export function renderConfigJs(values) {
  const merged = { ...DEFAULTS, ...values, prefill: [] };
  return [
    '/* 이 파일은 build.mjs 가 설정값(환경변수)으로 생성했습니다 — 직접 고치지 마세요.',
    ' * 값을 바꾸려면 Vercel 프로젝트 설정 > Environment Variables 의 KIOSK_CONFIG 를 고치고',
    ' * 다시 설치(Redeploy)합니다. 새 값은 설정 마법사(setup.html)에서 만듭니다.',
    ` * 생성 시각: ${new Date().toISOString()}`,
    ' */',
    'window.KIOSK_CONFIG = ' + JSON.stringify(merged, null, 2) + ';',
    '',
  ].join('\n');
}

function copyFile(rel) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) return false;
  const dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}

function copyDir(rel) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const childRel = path.join(rel, entry.name);
    if (entry.isDirectory()) n += copyDir(childRel);
    else if (copyFile(childRel)) n += 1;
  }
  return n;
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const f of ['index.html', 'setup.html']) {
    if (!copyFile(f)) throw new Error(`필수 파일이 없습니다: ${f}`);
  }
  const assets = copyDir('assets');
  copyDir('docs/img');

  let bundled = null;
  try {
    bundled = decodeKioskConfig(process.env.KIOSK_CONFIG);
  } catch (e) {
    console.error('설정값(KIOSK_CONFIG)이 잘못되었습니다:\n  - ' + e.message);
    process.exit(1);
  }
  if (bundled) {
    fs.writeFileSync(path.join(OUT, 'config.js'), renderConfigJs(bundled), 'utf8');
    console.log('config.js: KIOSK_CONFIG 한 줄에서 생성 — 항목 ' + Object.keys(bundled).length + '개');
    console.log(`출력: ${OUT} (assets ${assets}개)`);
    return;
  }

  const { found, problems } = readEnvConfig();
  if (problems.length) {
    console.error('환경변수 값이 잘못되었습니다:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }

  if (Object.keys(found).length === 0) {
    if (!copyFile('config.js')) throw new Error('config.js 가 없습니다.');
    console.log('config.js: 저장소 파일을 그대로 사용 (KIOSK_* 환경변수 없음)');
  } else {
    fs.writeFileSync(path.join(OUT, 'config.js'), renderConfigJs(found), 'utf8');
    console.log('config.js: 환경변수로 생성 — ' + Object.keys(found).join(', '));
    if (!found.companyId || !found.templateId) {
      console.warn('⚠ KIOSK_COMPANY_ID / KIOSK_FORM_ID 가 비어 있으면 작성 화면이 열리지 않습니다.');
    }
  }
  console.log(`출력: ${OUT} (assets ${assets}개)`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
