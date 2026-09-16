# 이폼사인 방명록 (제품 템플릿)

태블릿 한 대에 작성 화면을 띄워 두면, **로그인하지 않은 방문자**가 서식을 채우고 전송한 뒤
사람이 손대지 않아도 **다음 방문자용 빈 서식**이 저절로 다시 열립니다.

- **(A) 즉시 복귀** — 제출하자마자 새 서식
- **(B) 감사 화면 뒤 복귀** — 「작성해 주셔서 감사합니다」를 몇 초 보여 준 뒤 새 서식

정적 파일 몇 개로 끝납니다. 서버도, 데이터베이스도 필요 없습니다.
그리고 **이폼사인 API 키가 필요 없습니다** — 화면을 띄우는 데 쓰는 값은 회사 ID 와 서식 ID 두 개뿐입니다.
(API 키는 아래 「완료 문서 리포트」 유료 옵션을 켤 때만 씁니다.)

> 제품 이름은 **「이폼사인 방명록」** 으로 확정되었습니다(2026-09-16). 화면·설정 마법사에 보이는
> 이름은 `config.js` 의 `productName` **한 곳**에서만 나옵니다.

---

## 준비물

1. 이폼사인 계정과 **웹폼 디자이너로 만든 서식(템플릿)** 하나
2. 그 템플릿에서 **「URL로 문서 생성 허용」**을 켜고 받은 **외부 작성 주소**
3. 태블릿(안드로이드·아이패드·윈도우 어느 쪽이든) 과 인터넷

---

## 🔴 먼저 알아 둘 제약

사내 레퍼런스 구축(2026-09-11~16) 때 실제로 부딪힌 것들입니다. 순서대로 확인하세요.

### 1. 템플릿 알림 설정이 비어 있으면 **제출이 실패**합니다
방문자가 전송을 눌렀는데 화면이 「이미 작성한 문서입니다」로 바뀌고 **문서가 만들어지지 않는다면**
템플릿의 알림(notification) 설정이 비어 있는 경우입니다. 콘솔에서 만든 템플릿은 서버가 채워 주므로
보통 문제가 없고, **API 로 만들거나 복사한 템플릿**에서 주로 납니다.
증상이 나오면 템플릿 설정에서 알림을 한 번 저장하고 다시 배포하세요.

### 2. 「URL로 문서 생성 허용」이 **반드시 켜져 있어야** 합니다
꺼져 있으면 화면은 뜨는데 서식 내용이 오지 않아 **빈 화면 + 「보고서를 로딩하면서 예외가 발생했습니다」**
만 보입니다.
켜는 곳: **템플릿 설정 > 워크플로우 > 시작 단계 속성 > 「URL로 문서 생성 허용」**.
설정 마법사 2단계가 바로 이것을 눈으로 확인하는 절차입니다.

### 3. 공개 주소이므로 **자동 제출 방지(reCAPTCHA)** 를 권합니다
주소가 밖으로 새면 누구나 문서를 만들 수 있고, 만들어진 문서는 **요금으로 청구**됩니다.
자동 제출 방지를 켜면 방문자가 「로봇이 아닙니다」를 한 번 더 눌러야 하므로 현장 체감과
맞바꾸는 선택입니다. 끄기로 했다면 템플릿의 **문서 생성 수 제한**·**도메인/IP 지정**을 함께 거세요.

### 4. 인증서 기반 전자서명은 함께 쓸 수 없습니다
「URL로 문서 생성 허용」과 병용되지 않습니다(제품 제약).

### 5. 전송 확인 팝업은 **숨길 수 없습니다**
방문자는 **전송 → 팝업의 전송**으로 두 번 누릅니다. 안내 문구에 그 점을 적어 두세요.

### 6. 작성 화면 안의 터치는 **키오스크 페이지가 볼 수 없습니다**
작성 화면은 이폼사인 도메인의 프레임이라, 그 안에서 글자를 쓰거나 서명을 그려도 바깥 페이지에는
아무 신호가 오지 않습니다. 그래서 이 키오스크는 **포커스 폴링**으로 「방문자가 프레임 안에 있다」를
판별하고, 되돌리기 기준을 두 가지로 나눕니다.

- `idleResetSeconds` — 아직 아무도 손대지 않은 **빈 화면** 기준
- `abandonResetSeconds` — 작성을 시작한 방문자가 **자리를 뜬** 경우 기준(프레임 밖에 있는 시간만 셉니다)

되돌리기 직전에는 `countdownSeconds` 초 동안 「계속 작성하시겠습니까?」가 뜨고, 그동안 작성 내용은
흐리게 가려집니다. 아무 곳이나 터치하면 취소됩니다.

---

## 설치 — 세 가지 경로

### 경로 가. Vercel 에 배포 (가장 쉬움)

1. `setup.html` 을 브라우저에서 열어 설정 마법사를 끝까지 진행합니다.
2. 5단계에서 **「설치 시작하기」** 를 누르면 6단계가 열립니다. Vercel 이 이 템플릿 저장소를 고객 계정으로
   복사해 새 프로젝트를 만들고, 설치 중 환경변수 칸 **`KIOSK_CONFIG` 하나**를 보여 줍니다.
3. 마법사 6-③ 화면의 **「복사」** 버튼으로 얻은 한 줄을 그 칸에 붙여 넣고 배포합니다.
   🔴 Vercel Deploy 링크는 환경변수 **이름만** 넘기고 값은 미리 채우지 못합니다 —
   그래서 값을 여러 개 받지 않고 한 줄로 합쳤습니다(붙여넣기 1회).
4. 배포가 끝나면 나온 주소를 태블릿에서 엽니다.

Vercel 계정 만들기는 [docs/vercel-signup-guide.md](docs/vercel-signup-guide.md),
회사 주소(자체 도메인)와 HTTPS 연결은 [docs/own-domain-https.md](docs/own-domain-https.md)를 보세요.

### 경로 나. 정적 꾸러미를 사내 서버에 올리기

1. 설정 마법사 5단계에서 **「자체 서버에 올리기」**를 고르고, 6단계에서 **「정적 꾸러미 내려받기」**를 누릅니다.
2. 받은 zip 을 풀면 `index.html` · `config.js` · (로고를 올렸다면) `assets/logo.png` 가 있습니다.
3. 사내 웹서버나 정적 호스팅의 한 폴더에 그대로 올립니다.

🔴 **반드시 `https://` 주소로 열어야 합니다.** 파일을 두 번 눌러 여는 방식(`file://`)으로는
작성 화면을 불러오는 스크립트가 동작하지 않습니다.

### 경로 다. 내 PC 에서 먼저 확인하기

```bash
npx serve -l 8099 .
# 또는
python -m http.server 8099 --bind 127.0.0.1
```

브라우저에서 `http://localhost:8099/` (키오스크 화면) 와 `http://localhost:8099/setup.html`
(설정 마법사) 를 엽니다.

---

## 설정 마법사 (`setup.html`)

서버가 필요 없는 정적 페이지입니다. 입력값은 **그 브라우저 안에만** 임시 저장되고 어디로도 전송되지 않습니다.

| 단계 | 하는 일 |
|---|---|
| 1 | 외부 작성 주소를 붙여 넣으면 `company_id` · `form_id` · `country_code` · `lang_code` 를 자동으로 읽습니다 |
| 2 | 그 값으로 실제 작성 화면을 띄워 **서식이 보이는지** 눈으로 확인합니다(제약 2를 잡는 단계) |
| 3 | 회사 이름 · 로고 · 화면 제목 · 안내 문구 |
| 4 | 제출 뒤 동작(즉시/감사 화면)과 대기시간 4종 |
| 5 | `config.js` 미리보기·복사, **배포 방법 선택**(Vercel / 자체 서버) |
| 6 | 고른 방법의 **배포 절차를 한 번에 한 가지씩** 안내. 마친 단계를 눌러 확인하면 다음이 열리고, 진행 상태는 브라우저에 저장되어 새로 고쳐도 이어집니다 |

**6단계 구성**

- **Vercel 경로(7단계)** — ① GitHub 계정 ② Vercel 계정(무료 플랜의 비상업 제한 안내)
  ③ **설정값 한 줄 복사**(`KIOSK_CONFIG`) ④ 설치 화면에서 붙여 넣기 ⑤ 주소 확인(https 검사 +
  그 주소를 그 자리에서 띄워 눈으로 확인) ⑥ 기록 요약 옵션(선택, `REPORT_SECRET` 32자 제안값 생성)
  ⑦ 태블릿 설정(기기별 안내 + 주소 QR 코드).
- **회사 서버 경로(3단계, IT 담당자용)** — ① 파일 묶음 받기 ② 파일 올리기 ③ 주소 확인.
  5단계의 접힌 「IT 담당자에게 전달」에서 들어갑니다.

**컴맹 기준 수용 조건** (2026-09-16 사용자 지시)

- 화면 문안에 개발자 용어 금지. 기계 게이트 `tools/check-plain-language.mjs` 가 표시 텍스트 노드를
  훑어 금칙어를 검출합니다(괄호 안 원어와 `data-term-ok` 요소는 제외).
- 한 화면 = 할 일 하나 = 강조 버튼 하나. 나머지 버튼은 작고 회색.
- 각 단계에 실제 화면 그림 + 눌러야 할 자리 빨간 박스. 로그인 뒤 화면은
  `docs/img/post-login-captures.json` 이 들어오면 자동으로 붙고, 없으면 「화면 그림 준비 중」 자리표시자와
  말로 짚는 안내가 나옵니다.
- 모든 단계에 「안 돼요」 → 증상 고르기 → **다음 행동 하나**. 마지막 선택지는 언제나 「도움 요청」이며
  `SUPPORT_CONTACT` 상수(기본 빈 값)와 「이 화면 정보 복사」 버튼이 붙습니다.

🔴 마법사는 **이폼사인 API 키도, `REPORT_SECRET` 값도 저장하지 않습니다.** 리포트 옵션 단계는 Vercel
환경변수에 넣을 **이름 목록**과 `REPORT_SECRET` 제안값만 보여 주며, 제안값은 화면을 새로 고치면 다시
만들어집니다(넣기 전에 복사해 두어야 합니다).

로고는 높이 **160px** 이하로 자동 축소해 설정에 직접 담습니다.
🔴 `KIOSK_CONFIG` 한 줄 전체가 **48KB** 를 넘으면 환경변수 칸에 들어가지 않으므로, 마법사 3단계가
갈림길을 띄웁니다 — ① 회사 홈페이지의 로고 그림 주소를 넣거나 ② 로고 없이 회사 이름으로 표시.
회사 서버(파일 묶음) 경로는 종전대로 `assets/logo.png` 파일로 함께 넣습니다.

---

## 설정 파일 (`config.js`)

| 키 | 뜻 | 기본값 |
|---|---|---|
| `productName` | 제품 이름(브라우저 탭·마법사 제목). **이름은 이 한 곳에만 둡니다** | `이폼사인 방명록` |
| `companyId` | 회사 ID (외부 작성 주소의 `company_id`) | (비어 있음) |
| `templateId` | 서식 ID (외부 작성 주소의 `form_id`) | (비어 있음) |
| `countryCode` / `langCode` | 국가·언어 코드 | `kr` / `ko` |
| `companyName` | 헤더에 로고가 없을 때 표시할 회사 이름 | (비어 있음) |
| `logoUrl` | 헤더 로고. `assets/logo.png` · `data:` · 절대 주소 모두 가능 | (비어 있음) |
| `title` / `subtitle` | 화면 제목·안내 문구 | `방문자 기록부` / 안내 문장 |
| `visitorName` | 작성자 표시 이름 | `방문자` |
| `mode` | `immediate` 또는 `thanks` | `thanks` |
| `thanksSeconds` | 감사 화면을 보여 주는 시간(초) | `5` |
| `idleResetSeconds` | 빈 화면 방치 되돌리기(초). `0` 이면 끔 | `120` |
| `abandonResetSeconds` | 작성 중 이탈 되돌리기(초) | `180` |
| `countdownSeconds` | 복귀 카운트다운(초) | `5` |
| `showHeader` | 이폼사인 기본 헤더(전송 버튼 포함) | `true` |
| `hideRequestPopup` | 전송 확인 팝업 숨김 시도(현재 효과 없음, 제약 5) | `true` |
| `debug` | 진단 로그 패널. **현장에서는 꺼 두세요**(패널이 터치를 가로챕니다) | `false` |

한 대만 다르게 쓰고 싶으면 파일을 고치지 말고 주소 뒤에 붙입니다.

```
?mode=thanks&sec=5&idle=120&abandon=180&countdown=5&company=<회사ID>&template=<서식ID>
```

**헤더 표시 규칙**: 로고가 있으면 로고, 없으면 회사 이름, 둘 다 없으면 화면 제목만 보여 줍니다.
헤더 오른쪽의 **「처음부터 다시」** 버튼은 확인을 한 번 거친 뒤 빈 서식으로 되돌립니다
(감사 화면에서는 되돌릴 것이 없으므로 숨겨집니다).

---

## 환경변수 (Vercel 배포 경로)

Vercel 「Deploy」 버튼으로 설치하면 저장소 파일을 직접 고칠 수 없으므로, 환경변수로 설정을 넣습니다.
빌드할 때 `node build.mjs` 가 이 값을 읽어 `public/config.js` 를 만듭니다.

우선순위는 다음과 같습니다(위가 이깁니다).

| 순위 | 무엇 | 언제 |
|---|---|---|
| 1 | **`KIOSK_CONFIG`** — 설정 한 줄 | 기본 경로. 설정 마법사가 만든 값을 그대로 붙여 넣습니다 |
| 2 | `KIOSK_*` 개별 변수 | **고급(수동 설정)**. 하위 호환으로 남겨 둔 경로 |
| 3 | 저장소의 `config.js` | 둘 다 없을 때 그대로 복사 |

### 설정값 한 줄 (KIOSK_CONFIG)

설정 객체(JSON)를 **UTF-8 → base64url** 로 인코딩한 문자열 하나입니다.
Vercel 의 Deploy 링크는 `env=<이름>` 으로 환경변수 **이름만** 넘길 수 있고 값은 미리 채우지 못합니다.
그래서 고객이 손으로 채워야 하는 칸을 **한 개**로 줄였습니다.

```
env=KIOSK_CONFIG&envDescription=설정 마법사에서 복사한 값을 붙여 넣으세요
```

값 검증(`build.mjs` 의 `decodeKioskConfig`)은 다음을 확인하고, 어긋나면 **exit 1** 과 한국어 사유를 냅니다.

- base64url 로 풀리지 않음 → 「값을 풀지 못했습니다 …」
- 푼 내용이 JSON 이 아님 → 「안에 든 내용이 설정값 형식이 아닙니다(JSON 아님) …」
- 필수 키 누락(`companyId` · `templateId`) → 「회사 ID(companyId) · 서식 ID(templateId) 이(가) 없습니다 …」

> 🔴 로고를 data URI 로 담으면 값이 커집니다. 마법사는 **48KB** 를 넘으면 로고를 담지 않고
> 로고 주소 입력 또는 로고 생략 중 하나를 고르게 합니다.

### 고급(수동 설정) — 항목별 환경변수

`KIOSK_CONFIG` 를 쓰지 않고 항목별로 넣고 싶을 때만 씁니다.

| 환경변수 | 대응 설정 키 |
|---|---|
| `KIOSK_PRODUCT_NAME` | `productName` |
| `KIOSK_COMPANY_ID` | `companyId` |
| `KIOSK_FORM_ID` | `templateId` |
| `KIOSK_COUNTRY_CODE` | `countryCode` |
| `KIOSK_LANG_CODE` | `langCode` |
| `KIOSK_COMPANY_NAME` | `companyName` |
| `KIOSK_LOGO_URL` | `logoUrl` |
| `KIOSK_TITLE` | `title` |
| `KIOSK_SUBTITLE` | `subtitle` |
| `KIOSK_VISITOR_NAME` | `visitorName` |
| `KIOSK_MODE` | `mode` (`immediate` / `thanks`) |
| `KIOSK_THANKS_SECONDS` | `thanksSeconds` |
| `KIOSK_THANKS_MESSAGE` / `KIOSK_THANKS_SUBMESSAGE` | 감사 화면 문구 |
| `KIOSK_IDLE_SECONDS` | `idleResetSeconds` |
| `KIOSK_ABANDON_SECONDS` | `abandonResetSeconds` |
| `KIOSK_COUNTDOWN_SECONDS` | `countdownSeconds` |
| `KIOSK_SHOW_HEADER` / `KIOSK_HIDE_REQUEST_POPUP` / `KIOSK_DEBUG` | 각 동명 설정 |

값이 형식에 맞지 않으면 빌드가 **실패**하고 어떤 변수가 잘못됐는지 알려 줍니다
(예: `KIOSK_MODE` 에 `immediate`/`thanks` 가 아닌 값).

---

## 완료 문서 리포트 (유료 옵션)

날마다 완료된 문서 건수를 모아 웹훅이나 메일로 보내는 기능입니다.
**기본 배포에서는 완전히 꺼져 있고**, 켜지 않으면 이폼사인 API 를 한 번도 부르지 않습니다.
필요 없으면 `api/` 폴더를 통째로 지워도 됩니다.

### 켜는 법

1. 이폼사인 **회사 관리 > API 관리**에서 API 키와 개인키를 발급받습니다.
2. Vercel 프로젝트 설정 > Environment Variables 에 넣습니다.

| 환경변수 | 뜻 |
|---|---|
| `KIOSK_REPORT_ENABLED` | `true` 여야 동작합니다. 없으면 `404` 로 답하고 끝 |
| `EFORMSIGN_API_KEY` / `EFORMSIGN_PRIVATE_KEY` | 이폼사인 API 자격 |
| `EFORMSIGN_MEMBER_ID` | (선택) 멤버 토큰으로 조회할 때 |
| `KIOSK_REPORT_DAYS` | (선택) 조회 기간(일). 기본 `30` |
| `REPORT_SECRET` | 수동 호출용 열쇠. `/api/report?secret=<값>` |
| `REPORT_WEBHOOK_URL` | 있으면 결과를 JSON 으로 POST |
| `RESEND_API_KEY` · `REPORT_TO_EMAIL` · `REPORT_FROM_EMAIL` | 있으면 Resend 로 메일 발송 |

3. 하루 한 번 자동 실행하려면 `vercel.report.json` 의 `crons` 블록을 `vercel.json` 최상위에
   붙여 넣고 다시 배포합니다. 🔴 **Vercel 무료 플랜의 크론은 하루 1회까지만** 허용됩니다.

리포트에는 **개인 식별 정보를 담지 않습니다** — 문서명·템플릿명·완료일·처리시간(분)만 모읍니다.

---

## 태블릿 키오스크 모드

- **안드로이드(Chrome)**: 화면 고정(앱 고정)을 켜거나, 전용 단말이면 *Fully Kiosk Browser* 같은
  키오스크 런처에 시작 주소를 지정합니다.
- **아이패드(Safari)**: 설정 > 손쉬운 사용 > **가이드 접근**을 켜고, 페이지를 연 뒤
  측면 버튼을 세 번 눌러 시작합니다.
- **윈도우 태블릿(Edge)**: `msedge.exe --kiosk https://<주소> --edge-kiosk-type=fullscreen`

페이지 자체도 뒤로가기를 무효화하고, 우클릭·확대 제스처를 막고, 방치되면 처음 화면으로 돌아갑니다.

---

## 운영 주의

- 완료된 문서는 담당자의 **개인 문서함에 뜨지 않습니다.** 외부 작성자가 만든 문서이기 때문입니다.
  콘솔의 **문서 관리** 화면에서 봅니다. 담당자가 보게 하려면 대표 관리자가
  회사 관리 > 권한 관리에서 그 멤버를 **문서 관리자**로 지정합니다.
- **완료 알림 메일은 아무에게도 가지 않습니다.** 받는 사람 후보(작성자·단계별 처리자)가
  둘 다 비어 있기 때문입니다. 알림이 필요하면 워크플로에 멤버 단계를 넣어야 하고, 그러면
  무인 흐름이 깨집니다. 위 리포트 옵션이 이 빈자리를 메우는 용도입니다.
- 방문자의 개인정보를 받으므로 템플릿에 **수집·이용 동의 항목**을 반드시 두세요.
- 공용 단말이므로 직전 방문자의 입력이 남지 않는 것이 중요합니다. 이 페이지는 세션마다
  작성 프레임을 통째로 새로 만듭니다.

---

## 저장소 안내 (배포하는 쪽)

### 교체 지점

| 무엇 | 어디 |
|---|---|
| 템플릿 저장소 주소 (`TEMPLATE_REPO_URL`) | `setup.html` 안의 상수 **한 곳**. 현재 값 `https://github.com/raybenAI80/eformsign-guestbook` (2026-09-16 확정, 공개 저장소로 분리) |
| 제품 이름 | `config.js` 의 `productName`, `build.mjs` 의 `DEFAULTS.productName`, `setup.html` 의 `DEFAULT_PRODUCT_NAME` 세 곳 |
| 도움 요청 연락처 | `setup.html` 의 `SUPPORT_CONTACT` (기본 빈 값 = 「이 화면을 캡처해 서비스 제공자에게 보내세요」) |

### 파일 구성

```
index.html          키오스크 화면 (설정 한 장으로 동작)
setup.html          설정 마법사 (정적, 서버 없음)
config.js           설정 파일
build.mjs           환경변수(KIOSK_CONFIG 우선) → public/config.js 생성 (의존성 0)
tools/check-plain-language.mjs  화면 문안 금칙어 게이트
vercel.json         빌드·캐시·보안 헤더
vercel.report.json  리포트 옵션용 crons 조각 (기본 미적용)
api/report.mjs      완료 문서 리포트 (유료 옵션, 기본 꺼짐)
api/lib/            리포트용 최소 이폼사인 클라이언트 (사내 SDK 에서 옮겨 옴)
assets/             로고 등
tools/              래퍼 검증 도구
docs/               가입·도메인 안내
```

### 검증 도구

```bash
# 정적 서빙
npx serve -l 8099 .

# 헤드리스 크롬 (🔴 --headless=new. 창이 숨겨지면 클릭이 조용히 사라집니다)
chrome --headless=new --remote-debugging-port=9233 --remote-allow-origins=* \
  --user-data-dir=<임시 폴더> --window-size=768,1024 about:blank

# 반복 작성 루프 (A: 즉시 / B: 감사 화면)
node tools/verify-kiosk.mjs --port 9233 --mode immediate --rounds 2 --notype
node tools/verify-kiosk.mjs --port 9233 --mode thanks --rounds 2 --notype

# 무응답 되돌리기 3케이스 · 「처음부터 다시」 4케이스
CDP_PORT=9233 node tools/probe-idle-reset.mjs
CDP_PORT=9233 node tools/probe-restart-button.mjs

# 한국어 줄바꿈 게이트
node C:/Users/FORCS/.agent-harness/tools/korean-linebreak/cli.mjs \
  --file index.html --widths 1440,1100,375 --fail-on fail
```

🔴 좌표 기반 검증에 `?debug=1` 을 쓰지 마세요 — 로그 패널이 프레임 클릭을 가로챕니다.
🔴 저장소 파일에 **우리 회사 ID·템플릿 ID 를 남기지 마세요.** 검증할 때는 주소 뒤에
`?company=<id>&template=<id>` 로 넣습니다.
