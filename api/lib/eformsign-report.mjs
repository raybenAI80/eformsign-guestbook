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
  const apiUrl = parsed?.api_key?.company?.apiUrl;
  if (!accessToken || !apiUrl) throw new Error('토큰 응답에 access_token 또는 company.apiUrl 이 없습니다.');
  return { accessToken, apiUrl, company: parsed.api_key.company };
}

/**
 * 문서 목록 조회 (type=04 = 문서 관리 = 회사 전체).
 * 🔴 페이징은 limit/skip 이다 — pageSize/page 는 조용히 무시된다.
 */
export async function listDocuments({ apiUrl, accessToken, limit = 100, skip = 0, startUpdateDate, endUpdateDate, templateIds }) {
  const body = { type: '04', limit: String(limit), skip: String(skip) };
  if (startUpdateDate !== undefined) body.start_update_date = startUpdateDate;
  if (endUpdateDate !== undefined) body.end_update_date = endUpdateDate;
  if (templateIds && templateIds.length) body.template_ids = templateIds;

  const res = await fetch(`${apiUrl}/v2.0/api/list_document`, {
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

/**
 * 완료 문서(status_type === '003') 행을 모은다.
 * 개인 식별 정보는 담지 않는다 — 문서명·템플릿명·완료일·처리시간(분)만.
 * (eformsign-core/src/resources/reports.ts 의 파생 공식과 동일)
 */
export async function fetchCompletedDocumentRows(opts) {
  const { apiKey, privateKey, memberId, tokenUrl, templateIds } = opts;
  const pageSize = Math.min(Number(opts.pageSize) || 100, 100);
  const maxPages = Number(opts.maxPages) || 50;
  const startUpdateDate = opts.startDate === undefined ? undefined : startOfDayMs(opts.startDate);
  const endUpdateDate = opts.endDate === undefined ? undefined : endOfDayMs(opts.endDate);

  const { accessToken, apiUrl } = await issueToken({ apiKey, privateKey, memberId, tokenUrl });

  const all = [];
  let pages = 0;
  for (let page = 0; page < maxPages; page++) {
    pages = page + 1;
    const res = await listDocuments({
      apiUrl, accessToken, limit: pageSize, skip: page * pageSize,
      startUpdateDate, endUpdateDate, templateIds,
    });
    const docs = res?.documents ?? [];
    all.push(...docs);
    if (docs.length < pageSize) break;
  }

  const done = all.filter((d) => d?.current_status?.status_type === '003');
  const rows = done.map((d) => {
    const updated = d.updated_date ?? Date.now();
    const created = d.created_date ?? updated;
    const t = new Date(updated);
    return {
      month: `${t.getFullYear()}-${pad(t.getMonth() + 1)}`,
      done_date: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`,
      doc_name: String(d.document_name ?? '').slice(0, 30),
      template_name: String(d.template?.name ?? '').slice(0, 26),
      minutes: Math.max(0, Math.round((updated - created) / 60000)),
    };
  });

  return { rows, scannedCount: all.length, pages };
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
