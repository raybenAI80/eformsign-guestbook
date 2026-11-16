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
import { issueToken, invalidateToken } from './eformsign-report.mjs';

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

/**
 * 상품 기본 서식(D안)의 머리 칸 4개 — 새 장을 만들 때 문서 생성 요청 document.fields 로 채운다.
 * (2026-09-28 실측: 읽기 전용 칸에도 값이 들어가고 화면·완료 PDF 에 남는다 — 볼트
 *  claim:eformsign-document-create-field-value-injection-2026-09-28)
 * 🔴 설정한 값만 싣는다. 아무것도 설정하지 않으면 fields 를 보내지 않아 기존 서식·기존 배포는 그대로다.
 */
export const HEADER_FIELD_IDS = { orgName: '기관명', dept: '부서', date: '방문일', sheetNo: '장번호' };
const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** 「2026. 9. 28. (월)」 — 서버(Vercel)는 UTC 라 고객 시간대로 바꿔 적는다. */
export function visitDateText(d = new Date(), timeZone = 'Asia/Seoul') {
  let y, m, day, wd;
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
      .formatToParts(d).map((x) => [x.type, x.value]));
    y = p.year; m = p.month; day = p.day; wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  } catch {
    y = d.getUTCFullYear(); m = d.getUTCMonth() + 1; day = d.getUTCDate(); wd = d.getUTCDay();
  }
  return `${y}. ${Number(m)}. ${Number(day)}. (${WEEK_KO[wd] ?? ''})`;
}

/** 고객 시간대 기준 「YYYY-MM-DD」(같은 날 판정용). */
function localDay(t, timeZone) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Number(t))); }
  catch { return new Date(Number(t)).toISOString().slice(0, 10); }
}

/**
 * 머리 칸 값 → document.fields[]. header = { orgName, dept, date:true|false, sheetNo:true|false }.
 * sheetIndex = 그날 몇 번째 장인지(1부터). 빈 값·꺼진 항목은 싣지 않는다.
 */
export function headerFieldValues(header = {}, { now = Date.now(), timeZone = 'Asia/Seoul', sheetIndex = 1 } = {}) {
  const out = [];
  const org = String(header.orgName || '').trim();
  const dept = String(header.dept || '').trim();
  if (org) out.push({ id: HEADER_FIELD_IDS.orgName, value: org });
  if (dept) out.push({ id: HEADER_FIELD_IDS.dept, value: dept });
  if (header.date) out.push({ id: HEADER_FIELD_IDS.date, value: visitDateText(new Date(now), timeZone) });
  if (header.sheetNo) out.push({ id: HEADER_FIELD_IDS.sheetNo, value: `${Math.max(1, Math.floor(Number(sheetIndex) || 1))}장` });
  return out;
}

/** 환경변수 → header (KIOSK_MULTIROW_ORG_NAME · _DEPT · _DATE=auto · _SHEET_NO=auto). api/multirow.mjs 와 검증 도구가 같이 쓴다. */
export function headerFromEnv(env = {}) {
  const auto = (v) => /^(auto|on|true|1|yes)$/i.test(String(v || '').trim());
  return { orgName: env.KIOSK_MULTIROW_ORG_NAME || '', dept: env.KIOSK_MULTIROW_DEPT || '', date: auto(env.KIOSK_MULTIROW_DATE), sheetNo: auto(env.KIOSK_MULTIROW_SHEET_NO) };
}

/** 목록에서 오늘(고객 시간대) 만들어진 이 서식 문서 수 + 1 = 이번 장 번호. */
export function sheetIndexToday(documents = [], { now = Date.now(), timeZone = 'Asia/Seoul', templateId } = {}) {
  const today = localDay(now, timeZone);
  const same = (documents || []).filter((d) => d && d.created_date && (!templateId || !d.template?.id || d.template.id === templateId) && localDay(d.created_date, timeZone) === today);
  return same.length + 1;
}

// ── 시간창·하루 단위 새 장(2026-09-29) ─────────────────────────────────────────
// 🔴 이폼사인 API 에는 문서를 강제로 「완료」시키는 호출이 없다(취소·반려·삭제뿐). 그래서 「종료 시각」은
//    문서를 끝내는 것이 아니라 **그 장을 마감(더는 이어 쓰지 않음)하고 다음 방문자에게 새 장**을 여는 뜻이다.
//    마감된 장은 취소하지 않고 진행 중으로 남긴다(적힌 기록 보존). 크론 없이 요청 시점에 판정한다.

/** 'HH:MM'(또는 'H:MM') → 자정부터 분. 빈 값 = null. 형식이 틀리면 NaN. */
export function parseClock(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** 고객 시간대 기준 자정부터 분. */
function localMinutes(t, timeZone) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(Number(t))).map((x) => [x.type, x.value]));
    return (Number(p.hour) % 24) * 60 + Number(p.minute);
  } catch { const d = new Date(Number(t)); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
}

/** 시각 설정 검사. 틀린 이름 목록을 돌려준다(빈 배열 = 정상). 종료 시각이 시작 시각보다 늦어야 한다(자정 넘는 운영은 받지 않는다). */
export function sheetOptionErrors({ newSheet = 'never', openAt = null, closeAt = null, afterClose = 'new' } = {}) {
  const bad = [];
  if (!['never', 'daily'].includes(newSheet)) bad.push('KIOSK_MULTIROW_NEW_SHEET');
  if (!['new', 'closed'].includes(afterClose)) bad.push('KIOSK_MULTIROW_AFTER_CLOSE');
  const o = parseClock(openAt), c = parseClock(closeAt);
  if (Number.isNaN(o)) bad.push('KIOSK_MULTIROW_OPEN_AT');
  if (Number.isNaN(c)) bad.push('KIOSK_MULTIROW_CLOSE_AT');
  if (o != null && c != null && !Number.isNaN(o) && !Number.isNaN(c) && c <= o) bad.push('KIOSK_MULTIROW_OPEN_AT', 'KIOSK_MULTIROW_CLOSE_AT');
  return [...new Set(bad)];
}

/** 환경변수 → 시간창 옵션 + 틀린 이름. api/multirow.mjs 가 400 으로 답할 때 쓴다. */
export function sheetOptionsFromEnv(env = {}) {
  const low = (v, d) => String(v ?? '').trim().toLowerCase() || d;
  const options = {
    newSheet: low(env.KIOSK_MULTIROW_NEW_SHEET, 'never'),
    openAt: String(env.KIOSK_MULTIROW_OPEN_AT ?? '').trim() || null,
    closeAt: String(env.KIOSK_MULTIROW_CLOSE_AT ?? '').trim() || null,
    afterClose: low(env.KIOSK_MULTIROW_AFTER_CLOSE, 'new'),
  };
  return { options, errors: sheetOptionErrors(options) };
}

/**
 * 지금이 운영 시간 안인지. 경계: 시작 시각 정각 = 안, 종료 시각 정각 = 밖(마감).
 * @returns {{dayKey:string, inWindow:boolean, beforeOpen:boolean, afterClose:boolean}}
 */
export function sheetWindow(now = Date.now(), { tz = 'Asia/Seoul', timeZone, openAt = null, closeAt = null } = {}) {
  const zone = timeZone || tz;
  const errs = sheetOptionErrors({ openAt, closeAt });
  if (errs.length) throw new Error('운영 시각 형식이 틀렸습니다: ' + errs.join(', '));
  const m = localMinutes(now, zone), o = parseClock(openAt), c = parseClock(closeAt);
  const beforeOpen = o != null && m < o;
  const afterClose = c != null && m >= c;
  return { dayKey: localDay(now, zone), inWindow: !beforeOpen && !afterClose, beforeOpen, afterClose };
}

/** 문서가 오늘(고객 시간대) 만든 장인지. created_date 가 없으면 false. */
export function isSheetOfToday(doc, now = Date.now(), tz = 'Asia/Seoul') {
  return !!(doc && doc.created_date) && localDay(doc.created_date, tz) === localDay(now, tz);
}

/** 하루를 운영 전·운영 중·마감 뒤 세 구간으로 나눈다. 같은 날·같은 구간에 만든 장만 이어 쓴다. */
function segmentOf(t, opts) {
  const w = sheetWindow(t, opts);
  return w.beforeOpen ? 'before' : w.afterClose ? 'after' : 'in';
}

/**
 * 이 장을 지금 방문자에게 이어 쓰게 할지(열린 장이 아니면 false).
 *   newSheet 'never' → 열린 장이면 항상 이어 쓴다(현행).
 *   newSheet 'daily' → 오늘 만든 장이고, 지금과 같은 구간(운영 중이면 운영 중에 만든 장)이어야 한다.
 *     = 날짜가 바뀌면 새 장, 종료 시각이 지나면 새 장(운영 중에 만든 장은 마감).
 *       마감 뒤에 연 장은 마감 뒤 방문자끼리 이어 쓴다(방문자마다 새 장이 생기지 않게).
 * opts = { templateId, newSheet, openAt, closeAt, tz|timeZone }
 */
export function shouldReuse(doc, now = Date.now(), opts = {}) {
  if (!judgeDocument(doc, { templateId: opts.templateId, now }).open) return false;
  if ((opts.newSheet || 'never') !== 'daily') return true;
  const tz = opts.timeZone || opts.tz || 'Asia/Seoul';
  if (!isSheetOfToday(doc, now, tz)) return false;
  return segmentOf(doc.created_date, opts) === segmentOf(now, opts);
}

/** 새 장을 여는 이유(응답 sheet.reason). staleOpen = 진행 중이지만 이어 쓰지 않기로 한 장들. 'first' = 이어 쓸 장이 없음(첫 장·앞 장이 다 참). */
export function newSheetReason(now, staleOpen = [], opts = {}) {
  if ((opts.newSheet || 'never') === 'daily') {
    const w = sheetWindow(now, opts);
    if (w.afterClose) return 'after_close';
    if (w.beforeOpen) return 'before_open';
    const tz = opts.timeZone || opts.tz || 'Asia/Seoul';
    if (staleOpen.some((d) => d && d.created_date && !isSheetOfToday(d, now, tz))) return 'new_day';
  }
  return 'first';
}

/** 새 장: 참여자 N 단계에 자리표시 외부 수신자를 넣어 문서를 만든다. fields = document.fields[{id,value}](머리 칸 값, 선택). */
export function buildCreateBody({ rows, email, visitorPrefix = '방문자 ', documentName, splitEmail = true, stepNames = [], validDays = 50, fields = [] }) {
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
  return { document: { document_name: documentName, recipients, ...(fields && fields.length ? { fields } : {}) } };
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

/** 목록에서 지금 방문자를 받을 수 있는 열린 장(제외 목록 뺌). */
function openOf(documents, { exclude, templateId, now }) {
  return (documents || [])
    .filter((d) => d && d.id && !exclude.has(d.id))
    .filter((d) => judgeDocument(d, { templateId, now }).open);
}

/**
 * 이어 쓸 후보를 **결정적으로** 정렬한다 — 서로 다른 요청이 같은 목록을 보면 항상 같은 장을 고른다.
 * 같은 날(고객 시간대) 열린 장이 여러 건이면 가장 먼저 만든 것이 첫째다(생성 시각이 같으면 문서 번호 순).
 * 이렇게 하면 동시 요청이 장을 둘 만들었어도 모두가 한 장으로 모인다. 남는 빈 장은 건드리지 않는다(삭제는 사람이 판단).
 * 날짜가 다른 장끼리는 최신 날짜 쪽이 앞선다(예전 never 모드가 쓰던 「최신 우선」 유지).
 */
export function pickCandidates(documents, { exclude = new Set(), templateId, now, sheetOpts, timeZone }) {
  const cands = openOf(documents, { exclude, templateId, now }).filter((d) => shouldReuse(d, now, sheetOpts));
  if (cands.length < 2) return cands;
  const created = (d) => Number(d.created_date || 0);
  const newest = cands.reduce((m, d) => (created(d) > created(m) ? d : m));
  const day = localDay(created(newest), timeZone);
  const same = cands.filter((d) => localDay(created(d), timeZone) === day);
  const rest = cands.filter((d) => !same.includes(d)).sort((a, b) => created(b) - created(a));
  same.sort((a, b) => created(a) - created(b) || String(a.id).localeCompare(String(b.id)));
  return [...same, ...rest];
}

/**
 * 지금 열어야 할 단계를 정한다.
 * @returns {Promise<{company_id, template_id, document_id, step_no, step_name, token_id, visitor_name, created, rows, sheet, log}
 *   | {closed:true, openAt, closeAt, sheet, log}>}  closed = 운영 시간 밖 + afterClose 'closed'
 */
export async function resolveMultirowStep(opts) {
  const {
    apiKey, privateKey, memberId, tokenUrl, templateId, email,
    rows = 20, visitorPrefix = '방문자 ', documentName = '방명록', lastDocumentId, splitEmail = true,
    lookbackDays = 50, now = Date.now(), timeZone = 'Asia/Seoul', validDays = 50,
    forceNew = false,   // 검증 도구 전용: 진행 중 문서가 있어도 새 장을 만든다(핸들러는 쓰지 않는다)
    header = {},        // 머리 칸(기관명·부서·방문일·장번호) — headerFieldValues 참고. 비어 있으면 fields 를 보내지 않는다
    newSheet = 'never', openAt = null, closeAt = null, afterClose = 'new',   // 시간창·하루 단위 새 장(sheetWindow·shouldReuse)
  } = opts;
  if (!templateId) throw new Error('KIOSK_MULTIROW_FORM_ID 가 없습니다.');
  if (!email) throw new Error('KIOSK_MULTIROW_EMAIL 이 없습니다.');
  let n = Math.max(1, Math.min(30, Math.floor(Number(rows) || 20)));   // 참여자 상한 30명
  const log = [];
  let warnings = [];
  const sheetOpts = { templateId, newSheet, openAt, closeAt, timeZone };
  const win = sheetWindow(now, sheetOpts);
  const sheetInfo = (reason) => ({ dayKey: win.dayKey, inWindow: win.inWindow, reason });
  // 운영 시간 밖 + 「받지 않기」 → 이폼사인을 부르지 않고 닫힘으로 답한다(토큰 발급도 하지 않는다).
  if (afterClose === 'closed' && !win.inWindow) {
    return { closed: true, openAt, closeAt, sheet: sheetInfo(win.beforeOpen ? 'before_open' : 'after_close'), log: ['closed'] };
  }

  const tokenOpts = { apiKey, privateKey, memberId, tokenUrl };
  let { accessToken, apiUrl, company } = await issueToken(tokenOpts);
  // 토큰은 함수 메모리에서 재사용된다. 서버가 401 로 거절하면 캐시를 버리고 새 토큰으로 같은 호출을 딱 1번 다시 한다.
  // 🔴 문서 생성(POST /documents)은 재시도하지 않는다 — 401 이어도 오류로 끝내고 캐시만 버린다(생성 1건 = 요금 1건, 화면이 판정부터 다시 요청한다).
  const call = async (pathname, o = {}) => {
    try { return await api(apiUrl, accessToken, pathname, o); } catch (e) {
      if (e.status !== 401) throw e;
      invalidateToken(tokenOpts);
      if (o.noRetry) throw e;
      log.push('token_reissued');
      ({ accessToken, apiUrl } = await issueToken(tokenOpts));
      return api(apiUrl, accessToken, pathname, o);
    }
  };
  const companyId = company?.company_id || company?.id || '';
  const getDoc = (id) => call(`/v2.0/api/documents/${id}`, { query: { include_external_token: 'true' } });

  const answer = (doc, created, reason) => {
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
      sheet: sheetInfo(reason),
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
      // daily 인데 상세에 created_date 가 없으면 여기서 정하지 않고 목록(created_date 있음)으로 넘긴다.
      const decidable = newSheet !== 'daily' || !!d?.created_date;
      if (j.open && decidable && shouldReuse(d, now, sheetOpts) && currentStepToken(d)) return answer(d, false, 'reuse');
      if (!j.open || decidable) exclude.add(lastDocumentId);
    } catch (e) {
      log.push(`last:error_${e.status || 'x'}`);
      exclude.add(lastDocumentId);
    }
  }

  // ── 2. 진행 중 문서를 목록에서 찾는다 ──
  const listOpen = () => call('/v2.0/api/list_document', {
    method: 'POST',
    body: {
      type: '04', limit: '50', skip: '0', template_ids: [templateId],
      start_create_date: now - lookbackDays * 86400000, end_create_date: Date.now() + 60000,
    },
  });
  const list = await listOpen();
  const cands = pickCandidates(list?.documents, { exclude, templateId, now, sheetOpts, timeZone });
  const stale = openOf(list?.documents, { exclude, templateId, now }).filter((d) => !cands.includes(d));
  log.push(`list:${(list?.documents || []).length}/open:${cands.length}`);
  if (stale.length) log.push(`closed_sheet:${stale.length}`);
  if (cands.length > 1) log.push(`extra_open:${cands.length - 1}`);   // 가장 먼저 만든 1건만 쓴다. 나머지는 그대로 둔다(삭제 금지)

  const tryReuse = async (found) => {
    for (const c of found) {
      const d = await getDoc(c.id);                   // 목록은 오래됐을 수 있다 — 상세로 다시 판정
      const j = judgeDocument(d, { templateId, now });
      if (j.open && currentStepToken(d)) return answer(d, false, 'reuse');
      log.push(`cand:${j.reason}`);
    }
    return null;
  };
  if (!forceNew) { const hit = await tryReuse(cands); if (hit) return hit; }

  // ── 3. 없으면 새 장 — 수신자 수는 서식의 참여자 단계 수로 정한다 ──
  let stepNames = [];
  try {
    const plan = readTemplatePlan(await call(`/v2.0/api/forms/${templateId}`, { query: { is_include_config: 'true' } }));
    if (plan.stepNames.length) {
      if (plan.stepNames.length !== n) log.push(`rows_from_template:${plan.stepNames.length}(env ${n})`);
      n = Math.min(30, plan.stepNames.length);
      stepNames = plan.stepNames;
    } else log.push('template_no_participant_step');
    warnings = plan.warnings;
  } catch (e) {
    log.push(`template_read_error_${e.status || 'x'}`);   // 못 읽으면 환경변수 값으로 진행
  }
  const fields = headerFieldValues(header, { now, timeZone, sheetIndex: header.sheetNo ? sheetIndexToday(list?.documents, { now, timeZone, templateId }) : 1 });
  if (fields.length) log.push(`fields:${fields.map((f) => f.id).join('+')}`);
  // 🔴 생성 직전에 목록을 한 번 더 본다 — 서식 조회 사이에 다른 요청이 장을 만들었을 수 있다(동시 요청 중복 생성 방지, 2026-11-16).
  //    그 사이에 열린 장이 생겼으면 만들지 않고 그것을 쓴다. 이 확인으로 막지 못하는 것은 서로의 목록이 아직 비어 보이는 같은 순간의 두 요청뿐이다.
  if (!forceNew) {
    const list2 = await listOpen();
    const again = pickCandidates(list2?.documents, { exclude, templateId, now, sheetOpts, timeZone });
    if (again.length) { log.push(`recheck:found_${again.length}`); const hit = await tryReuse(again); if (hit) return hit; }
  }
  const body = buildCreateBody({ rows: n, email, visitorPrefix, documentName: `${documentName} ${stamp(new Date(now), timeZone)}`, splitEmail, stepNames, validDays, fields });
  // 🔴 생성 호출은 자동 재시도하지 않는다(실패하면 오류로 끝나고 화면이 판정부터 다시 요청한다). 문서 생성 1건 = 요금 1건.
  const created = await call('/v2.0/api/documents', { method: 'POST', query: { template_id: templateId }, body, noRetry: true });
  const newId = created?.document?.id;
  if (!newId) throw new Error('새 문서를 만들었지만 문서 번호가 응답에 없습니다.');
  log.push('created');
  return answer(await getDoc(newId), true, newSheetReason(now, stale, sheetOpts));
}
