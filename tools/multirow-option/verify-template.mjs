// 누적형(한 장에 여러 명) 서식 준비 상태 판정 — 게이트 multirow-template-readiness 의 판정 스크립트.
//
//   node --env-file=.local/report.env tools/multirow-option/verify-template.mjs --template-name "<서식 이름>"
//   node --env-file=.local/report.env tools/multirow-option/verify-template.mjs --form-id <서식 ID>   (또는 env KIOSK_MULTIROW_FORM_ID)
//   node tools/multirow-option/verify-template.mjs --file <GET /v2.0/api/forms/{id}?is_include_config=true 응답 json>   (오프라인)
//
// exit 0 = 통과 · 1 = 실패(꺼야 할 설정이 켜짐 등) · 2 = 사용법/조회 오류.
// 판정 축(2026-09-28 실측 근거 — .work/progress-multirow-guestbook.md 5·6·16·26~29항):
//   fail  참여자 단계 수 < 2                  — 한 장에 여러 명이 아니다
//   fail  참여자 단계 열람 전 본인확인 켜짐     — 방문자가 인증번호·reCAPTCHA 화면에서 멈춘다(view_auth_on)
//   fail  참여자 단계 인증서 전자서명 켜짐      — 전송 때 PASS·네이버·카카오 인증서 화면이 떠 끝낼 수 없다(cert_sign_on)
//   fail  외부 수신자 완료 알림(단계별 수신자) 켜짐 — 한 장이 끝날 때마다 전 명단 완료 PDF 가 방문자 전원에게 메일로 나간다(outsider_complete_mail_on)
//   fail  quick_processing(문서 전송 시 팝업 생략) 꺼짐 — 전송 확인창이 한 번 더 뜬다
//   fail  is_release 꺼짐                       — 배포 안 된 서식은 문서를 만들 수 없다
//   warn  참여자 단계 전송 전 인증 켜짐(send_auth_on)
// 🔴 출력에는 서식·회사 ID 를 싣지 않는다(public 저장소 — 로그가 그대로 캡처될 수 있다).
import fs from 'node:fs';
import { issueToken } from '../../api/lib/eformsign-report.mjs';
import { readTemplatePlan } from '../../api/lib/eformsign-multirow.mjs';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const env = process.env;

async function load() {
  if (arg('--file')) return JSON.parse(fs.readFileSync(arg('--file'), 'utf8'));
  if (!env.EFORMSIGN_API_KEY || !env.EFORMSIGN_PRIVATE_KEY || !env.EFORMSIGN_MEMBER_ID) throw new Error('EFORMSIGN_API_KEY / EFORMSIGN_PRIVATE_KEY / EFORMSIGN_MEMBER_ID 가 필요합니다(--env-file).');
  const { accessToken, apiUrl } = await issueToken({ apiKey: env.EFORMSIGN_API_KEY, privateKey: env.EFORMSIGN_PRIVATE_KEY, memberId: env.EFORMSIGN_MEMBER_ID });
  const get = async (p) => { const r = await fetch(`${apiUrl}${p}`, { headers: { Authorization: `Bearer ${accessToken}` } }); if (!r.ok) throw new Error(`HTTP ${r.status} ${p.replace(/[0-9a-f]{32}/gi, '<id>')}`); return r.json(); };
  let id = arg('--form-id') || env.KIOSK_MULTIROW_FORM_ID;
  if (arg('--template-name')) {
    const t = ((await get('/v2.0/api/forms')).templates || []).find((x) => x.name === arg('--template-name'));
    if (!t) throw new Error('서식을 이름으로 찾지 못했습니다: ' + arg('--template-name'));
    id = t.form_id || t.id;
  }
  if (!id) throw new Error('--template-name / --form-id / --file 중 하나가 필요합니다.');
  return get(`/v2.0/api/forms/${encodeURIComponent(id)}?is_include_config=true`);
}

export function judge(tpl) {
  const t = tpl?.form || tpl?.result?.form || tpl;
  const plan = readTemplatePlan(t);
  const checks = [];
  const add = (level, key, ok, detail) => checks.push({ level, key, ok, detail });
  add('fail', 'participant_steps>=2', plan.stepNames.length >= 2, `${plan.stepNames.length}단계`);
  add('fail', 'view_auth_off', !plan.warnings.includes('view_auth_on'), '열람 전 본인확인');
  add('fail', 'cert_sign_off', !plan.warnings.includes('cert_sign_on'), '인증서 전자서명');
  add('fail', 'outsider_complete_mail_off', !plan.warnings.includes('outsider_complete_mail_on'), '외부 수신자 완료 알림(단계별 수신자)');
  add('fail', 'quick_processing_on', t?.quick_processing === true, `quick_processing=${t?.quick_processing}`);
  add('fail', 'is_release', t?.is_release === true, `is_release=${t?.is_release}`);
  add('warn', 'send_auth_off', !plan.warnings.includes('send_auth_on'), '전송 전 인증');
  const failed = checks.filter((c) => c.level === 'fail' && !c.ok).map((c) => c.key);
  return { ok: failed.length === 0, failed, rows: plan.stepNames.length, stepNames: plan.stepNames, checks };
}

if (/verify-template\.mjs$/.test(process.argv[1] || '')) {
  try {
    const r = judge(await load());
    console.log(JSON.stringify(r, null, 1).replace(/[0-9a-f]{32}/gi, '<id>'));
    console.log(r.ok ? 'MULTIROW_TEMPLATE_READY' : `MULTIROW_TEMPLATE_NOT_READY ${r.failed.join(',')}`);
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error('verify-template 오류:', String(e.message || e).replace(/[0-9a-f]{32}/gi, '<id>'));
    process.exit(2);
  }
}
