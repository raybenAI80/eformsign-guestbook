/**
 * 완료 문서 리포트 — 최소 구현 (리포트 옵션 전용)
 *
 * 🔴 출처: 사내 SDK `eformsign-core` 에서 필요한 부분만 옮겨 왔습니다.
 *   - 토큰 발급(EC 서명)        ← eformsign-core/src/auth/signature.ts · auth/token-manager.ts
 *   - 문서 목록 조회             ← eformsign-core/src/resources/documents.ts (`list`, POST /v2.0/api/list_document)
 *   - 완료 문서 행 파생 공식     ← eformsign-core/src/resources/reports.ts (`fetchCompletedDocumentReportRows`)
 * SDK 는 사내 워크스페이스 패키지라 고객 Vercel 프로젝트에서 설치할 수 없습니다. 그래서 복사했습니다.
 * SDK 쪽 로직이 바뀌면 이 파일도 같이 고쳐야 합니다(중복 구현임을 알고 둡니다).
 *
 * 의존성 0 — Node 내장 모듈(node:crypto)과 전역 fetch 만 씁니다.
 */
import { Buffer } from 'node:buffer';
import { createPrivateKey, createSign } from 'node:crypto';

const DEFAULT_TOKEN_URL = 'https://api.eformsign.com/v2.0/api_auth/access_token';

/** eformsign_signature 헤더 값 생성 (SHA256 over execution_time, EC 개인키). */
export function createSignature(privateKeyHex) {
  const executionTime = Date.now();
  const keyBuffer = Buffer.from(privateKeyHex, 'hex');
  let privateKey;
  try {
    privateKey = createPrivateKey({ key: keyBuffer, format: 'der', type: 'pkcs8' });
  } catch (pkcs8Err) {
    try {
      privateKey = createPrivateKey({ key: keyBuffer, format: 'der', type: 'sec1' });
    } catch (sec1Err) {
      throw new Error(
        'EC 개인키를 읽지 못했습니다(PKCS#8·SEC1 모두 실패). ' +
        `PKCS#8: ${pkcs8Err.message} / SEC1: ${sec1Err.message}`,
      );
    }
  }
  const signer = createSign('SHA256');
  signer.update(String(executionTime));
  signer.end();
  return { executionTime, signature: signer.sign(privateKey).toString('hex') };
}

/** 액세스 토큰 발급. memberId 를 주면 멤버 토큰, 없으면 회사 토큰. */
export async function issueToken({ apiKey, privateKey, memberId, tokenUrl = DEFAULT_TOKEN_URL }) {
  if (!apiKey) throw new Error('EFORMSIGN_API_KEY 가 없습니다.');
  if (!privateKey) throw new Error('EFORMSIGN_PRIVATE_KEY 가 없습니다.');
  const { executionTime, signature } = createSignature(privateKey);
  const body = { execution_time: executionTime };
  if (memberId) body.member_id = memberId;

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      eformsign_signature: signature,
      Authorization: `Bearer ${Buffer.from(apiKey).toString('base64')}`,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`토큰 발급 실패 HTTP ${res.status}: ${raw.slice(0, 300)}`);
  const parsed = JSON.parse(raw);
  const accessToken = parsed?.oauth_token?.access_token;
  // 🔴 응답 필드는 snake_case `api_url` 이다(2026-09-16 실측). 과거 코드가 `apiUrl` 만 읽어
  //    토큰 발급 단계에서 항상 예외로 죽었다. 두 이름을 모두 받는다.
  const apiUrl = parsed?.api_key?.company?.api_url || parsed?.api_key?.company?.apiUrl;
  if (!accessToken || !apiUrl) throw new Error('토큰 응답에 access_token 또는 company.apiUrl 이 없습니다.');
  return { accessToken, apiUrl, company: parsed.api_key.company };
}

/**
 * 문서 목록 조회 (type=04 = 문서 관리 = 회사 전체).
 * 🔴 페이징은 limit/skip 이다 — pageSize/page 는 조용히 무시된다.
 * 🔴 항목 값은 `include_fields=true` 를 **쿼리스트링**으로 붙여야 온다. 본문(body)에 넣으면
 *    조용히 무시되고 `fields` 가 빈 배열로 돌아온다(2026-09-16 실측). 이 한 개 차이 때문에
 *    "이 API 로는 항목 값을 못 받는다"는 오판이 한 번 있었다.
 *    쿼리를 붙이면 **문서당 추가 호출 없이** 한 페이지 응답에 그 페이지 전 문서의 항목이 실려 온다.
 */
export async function listDocuments({
  apiUrl, accessToken, limit = 100, skip = 0, startUpdateDate, endUpdateDate, templateIds, includeFields = false,
}) {
  const body = { type: '04', limit: String(limit), skip: String(skip) };
  if (startUpdateDate !== undefined) body.start_update_date = startUpdateDate;
  if (endUpdateDate !== undefined) body.end_update_date = endUpdateDate;
  if (templateIds && templateIds.length) body.template_ids = templateIds;

  const qs = includeFields ? '?include_fields=true' : '';
  const res = await fetch(`${apiUrl}/v2.0/api/list_document${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`문서 목록 조회 실패 HTTP ${res.status}: ${raw.slice(0, 300)}`);
  return JSON.parse(raw);
}

const pad = (n) => String(n).padStart(2, '0');
const startOfDayMs = (v) => { const d = new Date(v); d.setHours(0, 0, 0, 0); return d.getTime(); };
const endOfDayMs = (v) => { const d = new Date(v); d.setHours(23, 59, 59, 999); return d.getTime(); };

/** 서식이 정해져 있지 않으므로 항상 있는 열만 고정으로 둔다. */
export const FIXED_COLUMNS = [
  { key: 'done_date', label: '완료일' },
  { key: 'doc_name', label: '문서 이름' },
  { key: 'template_name', label: '서식 이름' },
  { key: 'minutes', label: '처리시간(분)' },
];

const MAX_FIELD_COLUMNS = 40;   // 항목이 아주 많은 서식에서 표가 무한정 넓어지지 않게 한다.
const MAX_VALUE_CHARS = 60;

/**
 * 항목 하나를 표에 넣을 문자열로 바꾼다.
 * - 서명·도장 같은 `binary` 는 값 자체를 싣지 않는다(용량·개인정보). 있음/없음만.
 * - 나머지는 문자열로 자르기만 한다. 값 해석(체크박스 Y/N 등)은 서식마다 달라 건드리지 않는다.
 */
function renderFieldValue(f) {
  const v = f?.value;
  if (String(f?.type || '').toLowerCase() === 'binary') return v ? '있음' : '없음';
  if (v === null || v === undefined) return '';
  return String(v).slice(0, MAX_VALUE_CHARS);
}

/**
 * 완료 문서(status_type === '003') 행을 모은다.
 *
 * 🔴 **열은 서식 항목에서 동적으로 만든다.** 이 상품은 고객이 어떤 서식이든 붙이는 화면이라
 *    항목 이름·개수를 코드가 알 수 없다. 그래서
 *      · 고정 열 = 완료일·문서 이름·서식 이름·처리시간(분) — 어떤 서식에도 있다
 *      · 항목 열 = 조회된 문서들의 `fields[].id` **합집합**(처음 나타난 순서 유지)
 *    항목이 0개인 서식(예: 서명만 있는 동의서)이면 항목 열이 0개로 나오고 고정 열만 남는다.
 *    항목을 더하거나 지우거나 이름을 바꾸면 다음 리포트부터 열이 저절로 따라온다.
 *
 * 🔴 호출 수: 항목 값은 목록 조회에 `include_fields=true` 쿼리를 붙여 받는다 — **문서당 추가
 *    호출은 없다.** 한 페이지(최대 100건)에 1콜, 상한 `maxPages`(기본 50) = 최대 5,000건·50콜.
 *    하루 1회 크론 기준으로 부담이 없다. 더 필요하면 조회 기간을 줄이는 쪽이 맞다.
 *
 * 🔴 개인정보: 항목 값에는 이름·연락처가 들어 있을 수 있고 이 리포트는 웹훅·메일로 회사 밖으로
 *    나갈 수 있다. 그래서 **항목 값은 기본으로 싣지 않는다**(건수·날짜만). 값이 필요하면
 *    `fieldValues: true`(환경변수 `KIOSK_REPORT_FIELD_VALUES=on`)로 켠다.
 *    값을 끈 상태에서도 **어떤 항목이 있는지(열 구성)는 그대로 서식에서 자동으로 온다**.
 * (eformsign-core/src/resources/reports.ts 의 파생 공식과 동일)
 */
export async function fetchCompletedDocumentRows(opts) {
  const { apiKey, privateKey, memberId, tokenUrl, templateIds } = opts;
  const pageSize = Math.min(Number(opts.pageSize) || 100, 100);
  const maxPages = Number(opts.maxPages) || 50;
  // 🔴 기본은 **끔**(개인정보). 값을 실으려면 `fieldValues: true`(환경변수 KIOSK_REPORT_FIELD_VALUES=on).
  const fieldValues = opts.fieldValues === true;
  const startUpdateDate = opts.startDate === undefined ? undefined : startOfDayMs(opts.startDate);
  const endUpdateDate = opts.endDate === undefined ? undefined : endOfDayMs(opts.endDate);

  const { accessToken, apiUrl } = await issueToken({ apiKey, privateKey, memberId, tokenUrl });

  const all = [];
  let pages = 0;
  let truncated = false;
  for (let page = 0; page < maxPages; page++) {
    pages = page + 1;
    const res = await listDocuments({
      apiUrl, accessToken, limit: pageSize, skip: page * pageSize,
      startUpdateDate, endUpdateDate, templateIds, includeFields: true,
    });
    const docs = res?.documents ?? [];
    all.push(...docs);
    if (docs.length < pageSize) break;
    if (page === maxPages - 1) truncated = true;   // 상한에 걸려 뒤가 잘렸다
  }

  const done = all.filter((d) => d?.current_status?.status_type === '003');

  // ── 항목 열: 합집합, 처음 나타난 순서 유지 ──
  const fieldColumns = [];
  for (const d of done) {
    for (const f of (d.fields ?? [])) {
      const id = String(f?.id ?? '');
      if (!id || fieldColumns.includes(id)) continue;
      if (fieldColumns.length >= MAX_FIELD_COLUMNS) break;
      fieldColumns.push(id);
    }
  }

  const rows = done.map((d) => {
    const updated = d.updated_date ?? Date.now();
    const created = d.created_date ?? updated;
    const t = new Date(updated);
    const row = {
      month: `${t.getFullYear()}-${pad(t.getMonth() + 1)}`,
      done_date: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`,
      doc_name: String(d.document_name ?? '').slice(0, 30),
      template_name: String(d.template?.name ?? '').slice(0, 26),
      minutes: Math.max(0, Math.round((updated - created) / 60000)),
    };
    if (fieldValues && fieldColumns.length) {
      const map = {};
      for (const f of (d.fields ?? [])) {
        const id = String(f?.id ?? '');
        if (id && fieldColumns.includes(id)) map[id] = renderFieldValue(f);
      }
      row.fields = map;
    }
    return row;
  });

  const columns = [
    ...FIXED_COLUMNS,
    ...(fieldValues ? fieldColumns.map((id) => ({ key: `fields.${id}`, label: id, source: 'form' })) : []),
  ];

  return { rows, columns, fieldColumns, fieldValues, scannedCount: all.length, pages, truncated };
}

/** 열 정의 하나로 행에서 값을 꺼낸다(`fields.<항목이름>` 경로 지원). */
export function cellOf(row, column) {
  if (column.key.startsWith('fields.')) return (row.fields || {})[column.key.slice(7)] ?? '';
  const v = row[column.key];
  return v === null || v === undefined ? '' : String(v);
}

/** 일자별·월별 집계 요약. */
export function summarize(rows) {
  const byDate = {};
  const byMonth = {};
  for (const r of rows) {
    byDate[r.done_date] = (byDate[r.done_date] || 0) + 1;
    byMonth[r.month] = (byMonth[r.month] || 0) + 1;
  }
  return { total: rows.length, byDate, byMonth };
}
