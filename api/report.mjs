/**
 * 완료 문서 리포트 (유료 옵션) — Vercel 서버리스 함수
 *
 * 🔴 기본 배포에서는 꺼져 있다. `KIOSK_REPORT_ENABLED=true` 가 아니면 즉시 404 로 답하고
 *    이폼사인 API 를 한 번도 부르지 않는다. 옵션이 필요 없으면 이 `api/` 폴더를 통째로 지워도 된다.
 *
 * 켜는 법(환경변수)
 *   KIOSK_REPORT_ENABLED=true
 *   EFORMSIGN_API_KEY=...            이폼사인 회사 관리 > API 관리에서 발급
 *   EFORMSIGN_PRIVATE_KEY=...        같은 화면에서 받은 개인키(hex)
 *   EFORMSIGN_MEMBER_ID=...          (선택) 멤버 토큰으로 조회할 때
 *   KIOSK_FORM_ID=...                (선택) 이 템플릿의 문서만 집계
 *   KIOSK_REPORT_DAYS=30             (선택) 조회 기간(일). 기본 30
 *
 * 전달(있는 것만 쓴다. 둘 다 없으면 응답 JSON 으로만 돌려준다)
 *   REPORT_WEBHOOK_URL=https://...   JSON POST
 *   RESEND_API_KEY / REPORT_TO_EMAIL / REPORT_FROM_EMAIL   Resend 메일
 *
 * 호출 인증
 *   - Vercel 크론: 요청 헤더 `x-vercel-cron` 이 붙는다(자동).
 *   - 수동 호출: `REPORT_SECRET` 을 정하고 `/api/report?secret=<값>` 으로 부른다.
 *   - 둘 다 없으면 401. (공개 URL 로 문서 통계가 새지 않게 하기 위해서)
 */
import { fetchCompletedDocumentRows, summarize } from './lib/eformsign-report.mjs';

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body, null, 2));
};

export default async function handler(req, res) {
  const env = process.env;

  // ── 0. 옵션이 꺼져 있으면 아무 일도 하지 않는다 ──
  if (String(env.KIOSK_REPORT_ENABLED || '').toLowerCase() !== 'true') {
    return json(res, 404, { ok: false, reason: 'report_disabled', message: '리포트 옵션이 꺼져 있습니다.' });
  }

  // ── 1. 호출 인증 ──
  const isCron = Boolean(req.headers?.['x-vercel-cron']);
  const secret = env.REPORT_SECRET;
  const given = new URL(req.url || '/', 'http://localhost').searchParams.get('secret');
  if (!isCron && !(secret && given && given === secret)) {
    return json(res, 401, { ok: false, reason: 'unauthorized', message: 'Vercel 크론이 아니거나 secret 이 맞지 않습니다.' });
  }

  try {
    const days = Number(env.KIOSK_REPORT_DAYS) > 0 ? Number(env.KIOSK_REPORT_DAYS) : 30;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - (days - 1) * 86400000);

    const { rows, scannedCount, pages } = await fetchCompletedDocumentRows({
      apiKey: env.EFORMSIGN_API_KEY,
      privateKey: env.EFORMSIGN_PRIVATE_KEY,
      memberId: env.EFORMSIGN_MEMBER_ID || undefined,
      tokenUrl: env.EFORMSIGN_TOKEN_URL || undefined,
      templateIds: env.KIOSK_FORM_ID ? [env.KIOSK_FORM_ID] : undefined,
      startDate, endDate,
    });

    const report = {
      ok: true,
      generated_at: new Date().toISOString(),
      period: { days, start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10) },
      scanned: scannedCount,
      pages,
      summary: summarize(rows),
      rows,
    };

    const delivered = [];

    if (env.REPORT_WEBHOOK_URL) {
      const r = await fetch(env.REPORT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      delivered.push({ via: 'webhook', status: r.status });
    }

    if (env.RESEND_API_KEY && env.REPORT_TO_EMAIL) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: env.REPORT_FROM_EMAIL || 'onboarding@resend.dev',
          to: String(env.REPORT_TO_EMAIL).split(',').map((s) => s.trim()).filter(Boolean),
          subject: `[${env.KIOSK_PRODUCT_NAME || '키오스크'}] 완료 문서 리포트 ${report.period.start} ~ ${report.period.end}`,
          text: renderText(report),
        }),
      });
      delivered.push({ via: 'resend', status: r.status });
    }

    return json(res, 200, { ...report, delivered });
  } catch (e) {
    return json(res, 500, { ok: false, reason: 'error', message: e?.message || String(e) });
  }
}

function renderText(report) {
  const s = report.summary;
  const lines = [
    `기간: ${report.period.start} ~ ${report.period.end} (${report.period.days}일)`,
    `완료 문서: ${s.total}건 (스캔 ${report.scanned}건)`,
    '',
    '일자별',
    ...Object.entries(s.byDate).sort().map(([d, n]) => `  ${d}  ${n}건`),
    '',
    '월별',
    ...Object.entries(s.byMonth).sort().map(([m, n]) => `  ${m}  ${n}건`),
  ];
  return lines.join('\n');
}
