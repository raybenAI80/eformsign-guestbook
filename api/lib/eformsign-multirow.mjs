/**
 * 누적형 방명록(한 장에 N명) — 다음 방문자가 열 단계를 찾는 최소 구현
 *
 * 설계 결정(2026-09-28)
 *   - **상태 저장소가 없다.** 진행 중 문서는 매번 이폼사인 문서 목록에서 찾는다. 고객 Vercel 에
 *     DB·KV 를 붙이게 하지 않기 위해서다. 대신 호출마다 토큰 발급 1 + 목록 1 + 상세 1(+생성 1) 콜이 든다.
 *   - **수신자는 자리표시(placeholder)다.** 새 장을 만들 때 참여자 N 단계 전부에 「방문자 k」를
 *     외부 수신자로 미리 넣는다. 이메일은 고객이 준 주소 하나를 `+v<k>` 로 갈라 단계마다 다르게 만든다
 *     (같은 주소를 N 번 넣으면 recipients[] 에서 단계별 토큰을 가를 수 없고, 멤버 계정 주소와 같으면
 *     외부 수신자가 아니라 멤버로 잡힐 수 있다). 알림은 `is_noti_ignore=true` 로 보내지 않는다.
 *     🔴 `use_mail=false` + `use_sms=false` 는 400 [4000001] 로 거부된다(2026-09-28 실측) — 그래서
 *        `use_mail=true` + `is_noti_ignore=true` 조합을 쓴다.
 *   - **N 명이 차면 새 장.** 마지막 방문자가 전송하면 문서가 완료(status_type 003)되고, 다음 호출은
 *     쓸 수 있는 진행 중 문서가 없으므로 새 문서를 만든다.
 *   - 완료 직후 목록 API 반영이 늦을 수 있어, 화면이 직전에 쓰던 document_id 를 `last` 로 넘기면
 *     그 문서를 **상세 조회로 먼저 판정**하고, 끝난 문서면 목록 후보에서도 뺀다.
 *   - 진행 중으로 볼 수 없는 문서(완료·취소·반려·삭제·외부 수신자 기한 지남)는 완료와 같게 취급한다.
 *   - 진행 중 문서가 둘 이상이면 가장 최근 생성 1건만 쓰고 나머지는 로그만 남긴다(삭제하지 않는다).
 *
 * 🔴 이 모듈이 돌려주는 값 중 브라우저로 나가도 되는 것은 token_id(그 단계 1회용 외부 처리 토큰)와
 *    회사·서식·문서 ID 뿐이다. API 키·개인키·액세스 토큰은 절대 응답에 싣지 않는다.
 *
 * 의존성 0 — eformsign-report.mjs 의 토큰 발급을 재사용한다.
 */
import { issueToken } from './eformsign-report.mjs';

/** 참여자 단계가 "지금 방문자를 받을 수 있는" 상태 코드. 그 밖(003 완료·013/042 취소·061 반려·049 삭제 …)은 끝난 문서로 본다. */
const OPEN_STATUS = new Set(['060', '062', '063']);
const PARTICIPANT_STEP = '05';
const ID_RE = /^[0-9a-f]{32}$/i;

async function api(apiUrl, accessToken, pathname, { method = 'GET', query, body } = {}) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const res = await fetch(`${apiUrl}${pathname}${qs}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${pathname} 실패 HTTP ${res.status}: ${raw.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return raw ? JSON.parse(raw) : {};
}

/** 문서 한 건이 아직 다음 방문자를 받을 수 있는지. 이유 문자열을 함께 돌려준다. */
export function judgeDocument(doc, { templateId, now = Date.now() } = {}) {
  const cs = doc?.current_status || {};
  const tid = doc?.template?.id || doc?.template?.form_id;
  if (templateId && tid && tid !== templateId) return { open: false, reason: 'other_template' };
  if (cs.status_type === '003' || cs.document_step === 'complete') return { open: false, reason: 'complete' };
  if (!OPEN_STATUS.has(String(cs.status_type))) return { open: false, reason: `status_${cs.status_type || 'unknown'}` };
  if (String(cs.step_type) !== PARTICIPANT_STEP) return { open: false, reason: `step_type_${cs.step_type || 'unknown'}` };
  if (cs._expired === true || (Number(cs.expired_date) > 0 && Number(cs.expired_date) < now)) return { open: false, reason: 'expired' };
  return { open: true, reason: 'in_progress' };
}

/** 현재 단계 수신자의 외부 처리 토큰을 recipients[] 에서 찾는다(이메일 우선, 이름 보조). */
export function currentStepToken(doc) {
  const cs = doc?.current_status || {};
  const want = (cs.step_recipients || [])[0] || {};
  const list = (doc?.recipients || []).filter((r) => r && r.token_id);
  const byMail = want.email && list.find((r) => String(r.id).toLowerCase() === String(want.email).toLowerCase());
  const byName = want.name && list.find((r) => r.name === want.name);
  const hit = byMail || byName || null;
  return hit ? { token_id: hit.token_id, name: hit.name || want.name || '' } : null;
}

/** `a@b.com` → `a+v3@b.com`. 이미 + 가 있으면 뒤에 덧붙인다. */
export function placeholderEmail(base, k) {
  const s = String(base || '').trim();
  const at = s.lastIndexOf('@');
  if (at < 1) throw new Error('KIOSK_MULTIROW_EMAIL 이 이메일 주소 형식이 아닙니다.');
  return `${s.slice(0, at)}+v${k}${s.slice(at)}`;
}

/**
 * 서식 설정(step_settings·알림)에서 누적형에 필요한 것만 읽는다.
 * 🔴 참여자 단계 수보다 수신자를 적게 넣으면, 마지막 방문자의 전송 창에 「수신자 정보를 입력하고
 *    전송하세요」(다음 방문자 이름·이메일 입력칸)가 뜬다(2026-09-28 실측) — 방문자가 남의 주소를 적으면
 *    명부가 그 사람에게 간다. 그래서 수신자 수는 환경변수가 아니라 **서식의 참여자 단계 수**로 정한다.
 */
export function readTemplatePlan(tpl) {
  const cfg = tpl?.config || tpl?.form?.config || {};
  const steps = (cfg.step_settings || []).filter((x) => x && x.type === 'participant');
  const warnings = [];
  for (const st of steps) {
    const o = st.option || {};
    if (o.use_before_view_auth || o.use_email_auth || o.use_mobile_auth || o.use_login_auth || o.use_email_sms_auth_view) warnings.push(`view_auth_on:${st.name}`);
    if (o.use_before_send_auth) warnings.push(`send_auth_on:${st.name}`);
    if (o.digital_signature_info && o.digital_signature_info.use_sign) warnings.push(`cert_sign_on:${st.name}`);
  }
  const pts = cfg.notification?.processing_status?.mail?.sending_points || [];
  const out = pts.find((x) => x && x.sending_point === 'complete_outsider_document');
  if (out && out.is_step_recipients) warnings.push('outsider_complete_mail_on');
  return { stepNames: steps.map((x) => x.name || ''), warnings: [...new Set(warnings.map((w) => w.replace(/:.*/, '')))] };
}

/** 새 장: 참여자 N 단계에 자리표시 외부 수신자를 넣어 문서를 만든다. */
export function buildCreateBody({ rows, email, visitorPrefix = '방문자 ', documentName, splitEmail = true, stepNames = [], validDays = 50 }) {
  // 🔴 기한을 주지 않으면 API 로 만든 외부 수신자 단계의 기한은 「수신일로부터 7일」이다(2026-09-28 실측:
  //    expired_date = 생성 + 7일). 방문이 뜸한 곳이면 한 장이 7일 만에 멈추므로 최대 50일을 기본으로 준다.
  const day = Math.max(1, Math.min(50, Math.floor(Number(validDays) || 50)));
  const recipients = [];
  for (let k = 1; k <= rows; k++) {
    recipients.push({
      step_type: PARTICIPANT_STEP,
      use_mail: true,
      use_sms: false,
      is_noti_ignore: true,
      member: { id: splitEmail ? placeholderEmail(email, k) : String(email).trim(), name: stepNames[k - 1] || `${visitorPrefix}${k}` },
      auth: { valid: { day, hour: 0 } },
    });
  }
  return { document: { document_name: documentName, recipients } };
}

/** 문서 이름 뒤에 붙일 「YYYY-MM-DD HH:mm」. 서버(Vercel)는 UTC 라 고객 시간대로 바꿔 적는다. */
export function stamp(d = new Date(), timeZone = 'Asia/Seoul') {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * 지금 열어야 할 단계를 정한다.
 * @returns {Promise<{company_id, template_id, document_id, step_no, step_name, token_id, visitor_name, created, rows, log}>}
 */
export async function resolveMultirowStep(opts) {
  const {
    apiKey, privateKey, memberId, tokenUrl, templateId, email,
    rows = 20, visitorPrefix = '방문자 ', documentName = '방명록', lastDocumentId, splitEmail = true,
    lookbackDays = 50, now = Date.now(), timeZone = 'Asia/Seoul', validDays = 50,
    forceNew = false,   // 검증 도구 전용: 진행 중 문서가 있어도 새 장을 만든다(핸들러는 쓰지 않는다)
  } = opts;
  if (!templateId) throw new Error('KIOSK_MULTIROW_FORM_ID 가 없습니다.');
  if (!email) throw new Error('KIOSK_MULTIROW_EMAIL 이 없습니다.');
  let n = Math.max(1, Math.min(30, Math.floor(Number(rows) || 20)));   // 참여자 상한 30명
  const log = [];
  let warnings = [];

  const { accessToken, apiUrl, company } = await issueToken({ apiKey, privateKey, memberId, tokenUrl });
  const companyId = company?.company_id || company?.id || '';
  const getDoc = (id) => api(apiUrl, accessToken, `/v2.0/api/documents/${id}`, { query: { include_external_token: 'true' } });

  const answer = (doc, created) => {
    const tok = currentStepToken(doc);
    if (!tok) throw new Error('현재 단계 수신자의 외부 처리 토큰을 찾지 못했습니다(서식의 참여자 단계가 외부 수신자용인지 확인).');
    const cs = doc.current_status || {};
    return {
      company_id: companyId,
      template_id: templateId,
      document_id: doc.id,
      step_no: Math.max(1, Number(cs.step_index || 2) - 1),   // step_index 2 = 참여자 1
      step_name: cs.step_name || '',
      token_id: tok.token_id,
      visitor_name: tok.name,
      created,
      rows: (doc.recipients || []).filter((x) => x && x.token_id).length || n,
      warnings,
      log,
    };
  };

  // ── 1. 화면이 직전에 쓰던 문서를 먼저 본다(목록 반영 지연 대비) ──
  const exclude = new Set();
  if (!forceNew && lastDocumentId && ID_RE.test(lastDocumentId)) {
    try {
      const d = await getDoc(lastDocumentId);
      const j = judgeDocument(d, { templateId, now });
      log.push(`last:${j.reason}`);
      if (j.open && currentStepToken(d)) return answer(d, false);
      exclude.add(lastDocumentId);
    } catch (e) {
      log.push(`last:error_${e.status || 'x'}`);
      exclude.add(lastDocumentId);
    }
  }

  // ── 2. 진행 중 문서를 목록에서 찾는다 ──
  const list = await api(apiUrl, accessToken, '/v2.0/api/list_document', {
    method: 'POST',
    body: {
      type: '04', limit: '50', skip: '0', template_ids: [templateId],
      start_create_date: now - lookbackDays * 86400000, end_create_date: now + 60000,
    },
  });
  const cands = (list?.documents || [])
    .filter((d) => d && d.id && !exclude.has(d.id))
    .filter((d) => judgeDocument(d, { templateId, now }).open)
    .sort((a, b) => Number(b.created_date || 0) - Number(a.created_date || 0));
  log.push(`list:${(list?.documents || []).length}/open:${cands.length}`);
  if (cands.length > 1) log.push(`extra_open:${cands.length - 1}`);   // 나머지는 그대로 둔다(삭제 금지)

  for (const c of (forceNew ? [] : cands)) {
    const d = await getDoc(c.id);                     // 목록은 오래됐을 수 있다 — 상세로 다시 판정
    const j = judgeDocument(d, { templateId, now });
    if (j.open && currentStepToken(d)) return answer(d, false);
    log.push(`cand:${j.reason}`);
  }

  // ── 3. 없으면 새 장 — 수신자 수는 서식의 참여자 단계 수로 정한다 ──
  let stepNames = [];
  try {
    const plan = readTemplatePlan(await api(apiUrl, accessToken, `/v2.0/api/forms/${templateId}`, { query: { is_include_config: 'true' } }));
    if (plan.stepNames.length) {
      if (plan.stepNames.length !== n) log.push(`rows_from_template:${plan.stepNames.length}(env ${n})`);
      n = Math.min(30, plan.stepNames.length);
      stepNames = plan.stepNames;
    } else log.push('template_no_participant_step');
    warnings = plan.warnings;
  } catch (e) {
    log.push(`template_read_error_${e.status || 'x'}`);   // 못 읽으면 환경변수 값으로 진행
  }
  const body = buildCreateBody({ rows: n, email, visitorPrefix, documentName: `${documentName} ${stamp(new Date(now), timeZone)}`, splitEmail, stepNames, validDays });
  const created = await api(apiUrl, accessToken, '/v2.0/api/documents', { method: 'POST', query: { template_id: templateId }, body });
  const newId = created?.document?.id;
  if (!newId) throw new Error('새 문서를 만들었지만 문서 번호가 응답에 없습니다.');
  log.push('created');
  return answer(await getDoc(newId), true);
}
