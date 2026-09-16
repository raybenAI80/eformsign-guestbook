/* 키오스크 설정 — 이 파일 한 장만 고치면 된다.
 * 설정 마법사(setup.html)로 만들면 이 파일이 자동으로 생성된다.
 * Vercel 「Deploy」 버튼으로 설치했다면 이 파일 대신 환경변수 KIOSK_CONFIG 한 개를 쓴다 — README 참조.
 * URL 쿼리로 덮어쓰기: ?mode=thanks&sec=5&idle=120&abandon=180&countdown=5&company=<id>&template=<id>
 */
window.KIOSK_CONFIG = {
  // ── 제품 이름 (화면·설정 마법사 제목에 쓰인다. 이름을 바꾸려면 여기 한 곳만 고친다) ──
  productName: '이폼사인 방명록',

  // ── 이폼사인 연결 정보 ──────────────────────────────────────────────
  // 외부 작성 URL 에서 그대로 옮겨 적는다. 설정 마법사가 자동으로 뽑아 준다.
  //   https://www.eformsign.com/eform/document/external_user_view_service.html
  //     ?company_id=<companyId>&form_id=<templateId>&lang_code=<langCode>&country_code=<countryCode>
  // 🔴 API 키는 필요 없다. 아래 두 값만 있으면 작성 화면이 열린다.
  companyId: '',            // 회사 ID (외부 작성 URL 의 company_id)
  templateId: '',           // 템플릿 ID (외부 작성 URL 의 form_id)
  countryCode: 'kr',        // 국가 코드 (kr / jp / en …)
  langCode: 'ko',           // 이폼사인 화면 언어

  // ── 화면 브랜딩 ─────────────────────────────────────────────────────
  // logoUrl 이 있으면 헤더 왼쪽에 로고를, 없으면 companyName 을, 둘 다 없으면 title 만 보여 준다.
  companyName: '',          // 예: '주식회사 포시에스'
  logoUrl: '',              // 'assets/logo.png' · 'data:image/png;base64,...' · 'https://…/logo.png'

  title: '문서 작성',
  subtitle: '내용을 작성한 뒤 전송을 눌러 주세요.',

  // 외부 작성자(로그인하지 않은 방문자)로 열 때 쓰는 표시 이름
  visitorName: '작성자',

  // ── 동작 ────────────────────────────────────────────────────────────
  // 'immediate' = 제출 즉시 새 작성 화면 / 'thanks' = 감사 화면 N초 후 새 작성 화면
  mode: 'thanks',
  thanksSeconds: 5,
  thanksMessage: '작성해 주셔서 감사합니다.',
  thanksSubMessage: '잠시 후 처음 화면으로 돌아갑니다.',

  // ── 대기시간 4종 ────────────────────────────────────────────────────
  //  · idleResetSeconds    : 아직 아무도 작성 프레임을 건드리지 않은 빈 화면 기준(0 이면 리셋 끔).
  //  · abandonResetSeconds : 방문자가 작성을 시작한 뒤 자리를 뜬 경우 기준.
  //    🔴 작성 프레임은 다른 도메인의 iframe 이라 그 안의 터치·키 입력이 이 페이지에 보이지 않는다.
  //       포커스가 프레임 안에 머무는 동안은 활동으로 보고, 프레임 밖에 있는 시간만 센다.
  //  · countdownSeconds    : 리셋 직전 「계속 작성하시겠습니까?」 복귀 카운트다운 시간.
  //  권장값: 로비·전시 부스 60~90초 / 사무실 접수대 180초, abandon > idle, countdown 5~10초.
  idleResetSeconds: 120,
  abandonResetSeconds: 180,
  countdownSeconds: 5,

  // 작성 화면이 이 시간(초) 안에 뜨지 않으면 담당자 확인 안내를 띄운다. 0 이면 끔.
  // 정상 로드는 실측 3~9초였다. 회선이 느린 현장이면 조금 늘린다(고급 설정 — 설정 마법사에는 없다).
  loadWatchSeconds: 25,

  // ── 임베딩 옵션 ─────────────────────────────────────────────────────
  // showHeader:false 로 두면 이폼사인 기본 헤더의 '전송' 버튼까지 사라진다 → 기본 true 권장.
  showHeader: true,
  // 전송 확인 팝업 숨김 시도. 현재 제품에서는 효과가 없다(README 「알아 둘 제약」 5번).
  hideRequestPopup: true,

  // 작성 화면에 미리 채워 둘 값. value 가 '@today' 면 오늘 날짜로 치환된다.
  prefill: [],

  // 진단용 로그 패널. 🔴 현장 운영에서는 false (패널이 화면 터치를 가로챈다).
  debug: false,
};
