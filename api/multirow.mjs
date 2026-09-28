/**
 * 누적형 방명록(한 장에 N명, 서버 포함 옵션) — Vercel 서버리스 함수
 *
 * 화면(index.html, docMode 'multirow')이 이 주소를 부르면, 지금 방문자가 이어 적을
 * 문서와 단계를 골라 그 단계의 외부 처리 토큰(token_id)을 돌려준다. 화면은 그 값으로
 * 이폼사인 임베딩(mode.type "02" + user.type "02" + external_token)을 연다.
 * N 명이 다 차 문서가 완료되면 다음 호출이 새 장(새 문서)을 만든다.
 *
 * 🔴 기본 배포에서는 꺼져 있다. `KIOSK_MULTIROW_ENABLED=true` 가 아니면 즉시 404 로 답하고
 *    이폼사인 API 를 한 번도 부르지 않는다.
 *
 * 환경변수
 *   KIOSK_MULTIROW_ENABLED=true
 *   EFORMSIGN_API_KEY / EFORMSIGN_PRIVATE_KEY / EFORMSIGN_MEMBER_ID   리포트 옵션과 같은 값
 *   KIOSK_MULTIROW_FORM_ID=...      누적형 서식 ID (없으면 KIOSK_FORM_ID)
 *   KIOSK_MULTIROW_EMAIL=...        자리표시 수신자에 쓸 고객 이메일 하나(단계마다 +v<k> 로 갈라 쓴다)
 *   KIOSK_MULTIROW_ROWS=20          (선택) 서식을 못 읽을 때만 쓰는 예비값. 평소에는 서식의 방문자(참여자) 단계 수를 그대로 쓴다
 *   KIOSK_MULTIROW_VALID_DAYS=50    (선택) 방문자 단계마다의 기한(일, 1~50). 안 주면 이폼사인 기본 7일이라 50을 기본으로 둔다
 *   KIOSK_TIMEZONE=Asia/Seoul       (선택) 문서 이름에 붙는 날짜·시각의 시간대
 *   KIOSK_MULTIROW_DOC_NAME=방명록  (선택) 문서 이름 앞부분. 뒤에 만든 날짜·시각이 붙는다
 *   KIOSK_MULTIROW_VISITOR_PREFIX="방문자 "  (선택) 자리표시 수신자 이름 앞부분
 *   KIOSK_MULTIROW_SPLIT_EMAIL=on   (선택) off 면 +v<k> 없이 같은 주소를 그대로 쓴다(실측 전 — 권장 안 함)
 *
 * 호출
 *   GET /api/multirow            → 지금 열 단계
 *   GET /api/multirow?last=<id>  → 화면이 직전에 쓰던 문서를 먼저 확인(완료 직후 목록 반영 지연 대비)
 *
 * 응답(200): { ok, document_id, step_no, step_name, token_id, company_id, created, rows, embed }
 * 🔴 API 키·개인키·액세스 토큰은 싣지 않는다. CORS 헤더를 주지 않는다 — 같은 주소의 화면만 쓴다.
 *
 * 설계 메모(구현하지 않음): 「하루 단위 새 장」 — KIOSK_MULTIROW_NEW_SHEET=daily 를 두고, 진행 중
 * 문서의 created_date 가 오늘(고객 시간대)이 아니면 그 문서를 그대로 둔 채 새 문서를 만든다.
 * 남은 빈 단계는 관리자가 문서 관리에서 정리한다. docs/multirow-option.md 「하루 단위 새 장」 참조.
 */
import { resolveMultirowStep } from './lib/eformsign-multirow.mjs';

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(JSON.stringify(body));
};

const on = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
const off = (v) => /^(0|false|no|off)$/i.test(String(v || '').trim());

/** 다른 사이트에서 부른 요청은 거절한다(같은 주소의 화면만 허용). */
function crossSite(req) {
  const h = req.headers || {};
  const site = String(h['sec-fetch-site'] || '');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = h.origin;
  if (origin) {
    let o;
    try { o = new URL(origin).host; } catch { return true; }
    const host = String(h['x-forwarded-host'] || h.host || '');
    if (o !== host) return true;
  }
  return false;
}

export default async function handler(req, res) {
  const env = process.env;

  if (!on(env.KIOSK_MULTIROW_ENABLED)) {
    return json(res, 404, { ok: false, reason: 'multirow_disabled', message: '누적형 옵션이 꺼져 있습니다.' });
  }
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { ok: false, reason: 'method', message: 'GET 만 받습니다.' });
  }
  if (crossSite(req)) {
    return json(res, 403, { ok: false, reason: 'cross_site', message: '이 주소는 같은 사이트의 방명록 화면에서만 부를 수 있습니다.' });
  }

  const missing = [];
  if (!env.EFORMSIGN_API_KEY) missing.push('EFORMSIGN_API_KEY');
  if (!env.EFORMSIGN_PRIVATE_KEY) missing.push('EFORMSIGN_PRIVATE_KEY');
  if (!env.EFORMSIGN_MEMBER_ID) missing.push('EFORMSIGN_MEMBER_ID');
  if (!(env.KIOSK_MULTIROW_FORM_ID || env.KIOSK_FORM_ID)) missing.push('KIOSK_MULTIROW_FORM_ID');
  if (!env.KIOSK_MULTIROW_EMAIL) missing.push('KIOSK_MULTIROW_EMAIL');
  if (missing.length) {
    return json(res, 500, { ok: false, reason: 'missing_env', missing, message: '설정값이 비어 있습니다: ' + missing.join(', ') });
  }

  const last = new URL(req.url || '/', 'http://localhost').searchParams.get('last') || '';

  try {
    const r = await resolveMultirowStep({
      apiKey: env.EFORMSIGN_API_KEY,
      privateKey: env.EFORMSIGN_PRIVATE_KEY,
      memberId: env.EFORMSIGN_MEMBER_ID,
      tokenUrl: env.EFORMSIGN_TOKEN_URL || undefined,
      templateId: env.KIOSK_MULTIROW_FORM_ID || env.KIOSK_FORM_ID,
      email: env.KIOSK_MULTIROW_EMAIL,
      rows: Number(env.KIOSK_MULTIROW_ROWS) || 20,
      documentName: env.KIOSK_MULTIROW_DOC_NAME || '방명록',
      visitorPrefix: env.KIOSK_MULTIROW_VISITOR_PREFIX || '방문자 ',
      splitEmail: !off(env.KIOSK_MULTIROW_SPLIT_EMAIL),
      lastDocumentId: last,
      timeZone: env.KIOSK_TIMEZONE || 'Asia/Seoul',
      validDays: Number(env.KIOSK_MULTIROW_VALID_DAYS) || 50,
    });
    if (r.warnings.length) console.warn('[multirow] 서식 설정 확인 필요:', r.warnings.join(', '));
    if (r.log.some((s) => s.startsWith('extra_open:'))) console.warn('[multirow] 진행 중 문서가 여러 건입니다 — 가장 최근 1건만 씁니다.', r.log.join(' '));
    return json(res, 200, {
      ok: true,
      document_id: r.document_id,
      step_no: r.step_no,
      step_name: r.step_name,
      token_id: r.token_id,
      company_id: r.company_id,
      created: r.created,
      rows: r.rows,
      // 새 장을 만들 때만 채워진다: view_auth_on · send_auth_on · cert_sign_on · outsider_complete_mail_on
      warnings: r.warnings,
      trace: r.log,
      embed: {
        company: { id: r.company_id },
        user: { type: '02', external_token: r.token_id, external_user_info: { name: r.visitor_name || r.step_name || '방문자' } },
        mode: { type: '02', template_id: r.template_id, document_id: r.document_id },
      },
    });
  } catch (e) {
    // 메시지에는 HTTP 상태와 이폼사인 응답 앞부분만 있다(키·토큰 값 없음).
    return json(res, 502, { ok: false, reason: 'eformsign_error', message: e?.message || String(e) });
  }
}
