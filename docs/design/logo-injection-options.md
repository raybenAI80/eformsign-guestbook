# 누적형 방명록 OZR — 고객 로고 주입 경로 조사 (2026-09-28)

사용자 지적: "회사로고도 없고" — 고객마다 다른 로고가 방명록 문서 상단(화면·완료 PDF 모두)에 들어가야 한다.
현 상태: `tools/multirow/build.mjs` + `make-pdf-product.py`(PyMuPDF 배경 PDF 생성 → OZR 입력 컴포넌트 주입) 어디에도
이미지/로고 처리 코드가 없다(코드 grep 0건). 완전한 공백이다.

## 조사 방법
- 볼트 `ozr-ontology-pack/claims.md`(2700줄), `oz-designer-properties.json`, `eformsign-api-support-pack/claims.md`(1653줄),
  `ozr-card-art-pack/claims.md` 통독·grep 교차 확인.
- 저장소 코드(`tools/multirow/*.mjs`, `make-pdf-product.py`) 및 SDK 소스(`D:\pjt\eformsign\eformsign-core\src\resources\*.ts`) 직접 확인.
- **추정 금지 원칙에 따라, 확인 안 된 것은 전부 "미확인"으로 표기했다.**

## 경로 비교

| # | 경로 | 근거(claim slug/원문) | 판정 | 화면·PDF 양쪽 유지 | 상품 적합도(컴맹·할 일 최소) | 다음 실측 1줄 |
|---|---|---|---|---|---|---|
| 1 | **빌드 시 배경 PDF에 로고 삽입** — `make-pdf-product.py`(PyMuPDF)가 서식 배경 PDF를 만들 때 로고 이미지를 `page.insert_image()`로 그려 넣고, 고객별로 OZR을 다시 빌드한다 | 코드 확인: 현재 `make-pdf-product.py`에 이미지 처리 코드 0건(공백이지 불가능은 아님) — PyMuPDF `insert_image`는 표준 API라 기술적으로 자명. 볼트 `ozr-ontology-pack` `claim:build-manifest-estimatedpages-ignores-recurring-header-footer-so-it-undercounts`의 부수 교훈("자산 교체는 조판 변경이다" — 이미지 종횡비가 바뀌면 밴드 높이·페이지 수가 바뀔 수 있음 — 로고 삽입 후 페이지 수 오라클 재실행 필요) | **가능(가장 확실)** | 예 — 배경 PDF에 박히므로 화면·완료 PDF 둘 다 항상 유지, 별도 런타임 의존 없음 | ▲ — 생성 단계를 **누가 어디서** 돌리느냐가 관건(아래 흐름 선택지) | `make-pdf-product.py`에 `--logo <path>` 인자 추가 + 로고 유무 2건으로 페이지 수 오라클(`verify-template.mjs`) 회귀 확인 |
| 2 | **문서 생성 시 필드 값 주입으로 이미지 필드 채우기** — 서식은 고객 공통 1개로 두고, 서버 함수가 문서 생성 시 이미지 필드 값(URL/base64)을 주입 | 🔴 **브리프의 전제(`document_fields`가 값 주입 파라미터)가 틀렸다.** 이폼사인 공식 API 레퍼런스 `eformsign-api-support-pack/api-webhook-sections.md` 1712행 이하 — `document_fields[]`는 **템플릿 상세 조회 응답(`GET /v2.0/api/forms/{form_id}`)의 필드 메타데이터**다(`seq`/`name`/`display_name`/`displayable`/`form_index` — 문서함 목록에 표시할 컬럼 정의). **문서 생성 시 값을 밀어 넣는 파라미터가 아니다.** SDK 코드 확인(`eformsign-core/src/resources/{api,reports}.ts`, `eformsign-cli`, 저장소 `create-doc.mjs`)에도 필드값 프리필 파라미터 0건 — 이 개념 자체가 이 코드베이스·공식 레퍼런스 어디에도 없다 | **불가(현재 확인된 범위에서)** — "문서 생성 API로 이미지 필드에 값을 직접 주입"하는 표면 자체를 찾지 못했다. 남은 가능성은 경로 3(OZFormParam/VIEWDATA 런타임 바인딩)뿐 | 해당 없음(경로 자체가 성립 안 함) | 해당 없음 | 이번 조사로 종결 — 후속 실측은 경로 3으로 흡수 |
| 3 | **OZ 파라미터 바인딩(OZFormParam/VIEWDATA)** — Label 컴포넌트의 그리기 형태="이미지", 텍스트=`http://` 경로를 런타임에 바인딩 | 세 사실이 확인됨: ① `oz-designer-properties.json` "그리기 형태"="이미지" + 텍스트="ozp://forcs.jpg" 예시, "이미지 URL" 속성 설명에 `ozp://`/`http://`/`file://` 세 경로 허용 명시 ② `[[claim:dynamic-label-text-via-polled-dropdown-and-getinputcomponent-settext]]` — Label에 FORMID+`<OZFORMID COMPTYPE="Label">` 등록 시 `GetInputComponent(id).SetText()` 런타임 변경이 실증됨(라이브 PROVEN) ③ `[[claim:onbind-settop-survives-completed-pdf-flatten]]` — OnBind에서의 변경(SetTop/SetText/SetVisible 계열)은 flatten 이전에 실행되어 **완성 PDF에도 반영**됨(워터마크 SetTextRotation 사례로 실증) | **부분 가능 — 단 경로가 갈린다.** ④ 그러나 `[[claim:ozr-ui-state-persists-via-sendable-formid-field-not-formparam]]` — **OZFormParam 자체는 fresh 재바인드(문서 재오픈·서버 PDF 렌더)마다 템플릿 기본값으로 리셋**된다. 값을 "완성 PDF"까지 유지하려면 OZFormParam으로 1회 시드한 뒤 `SENDABLE` 숨김 EDITABLE FORMID 필드에 값을 써서 이폼사인 문서데이터에 영속시켜야 한다(이 필드는 문서 생성 시 값이 필요 → 결국 #2의 "필드 프리필이 되는가"로 되돌아감) | 조건부(SENDABLE 필드 경로를 타면 예, 순수 OZFormParam만이면 화면은 되나 완성 PDF에서 리셋 위험) | 미확인 — OZ 서버 필요 여부가 코퍼스에서 판정 보류 상태(`oz-viewer-embed-feasibility` 체크포인트, 사용자 지시로 중단) | ①`VIEWDATA`에 로고 URL을 문서 생성 API로 실제로 흘려보낼 수 있는지 실측 ②안 되면 #2 경로(SENDABLE 필드 프리필)로 합류 |

## 생성 단계를 어디에 둘 것인가 (경로 1을 택할 경우의 흐름 선택지)

방명록 상품은 "고객 자기 Vercel + API 키 불필요"가 대원칙(`feedback_kiosk_deploy_for_non_technical_users.md`, `memory-kiosk-product-package-2026-09-17`). 경로 1(빌드 시 삽입)을 쓰려면 **OZR을 고객별로 다시 만드는 단계**가 필요한데, 이걸 컴맹 고객 PC에서 실행하게 하면 원칙 위반이다. 선택지:

| 안 | 설명 | 원칙 위반 여부 |
|---|---|---|
| A | 우리 쪽에서 로고 파일을 받아 OZR을 만들어 준 뒤 고객에게 업로드시킨다(현재 "서식은 고객이 웹폼 디자이너로 직접 제작" 원칙과 배치 — 로고 있는 서식만 예외적으로 우리가 만들어주는 용역이 됨) | 서식=고객 직접 제작 원칙과 충돌, 별도 협의 필요 |
| B | 설정 마법사(`setup.html`)에 로고 업로드 필드를 추가하고, 그 로고를 **래퍼(HTML) 헤더**에만 얹는다 — OZR 문서 자체에는 안 들어가고 방명록 웹페이지 감싸는 부분에만 표시 | 원칙 위반 없음(이미 결정된 사실 — `memory-kiosk-product-package-2026-09-17` 4항 "로고: 래퍼 헤더에 이미지, 없으면 회사명 텍스트") — **확인 완료(2026-09-28, 코드 grep)**: `config.js`·`index.html`·`setup.html`(및 `public/` 사본)에 이미 `logo` 관련 코드가 존재 — 즉 **래퍼 헤더 로고는 이미 구현돼 있다.** 따라서 사용자가 지적한 "회사로고도 없고"는 **래퍼가 아니라 OZR 문서 자체(작성 화면·완료 PDF)**를 가리킨 것으로 읽힌다 — 이 조사의 경로 1~3이 다루는 바로 그 공백 |
| C | 서버(리포트 옵션처럼 API 키를 쓰는 고객 한정) 함수가 문서 생성 시 경로 2/3으로 주입 | 리포트 옵션과 동일하게 "API 키 있는 고객만" 조건부 기능으로 분리 가능 |

## 권고

1. **래퍼 헤더 로고(안 B)는 이미 구현돼 있다** — 사용자가 지적한 공백은 **OZR 문서(작성 화면·완료 PDF) 안의 로고**다. 여기가 실제로 채워야 할 지점.
2. **문서(OZR) 안에 로고가 꼭 필요하다면 경로 1(빌드 시 배경 PDF 삽입)이 유일하게 "가능" 판정을 받은 경로**다 — 기술적으로 자명하고 화면·완료 PDF 모두에서 항상 유지되며, 경로 2는 애초에 성립하지 않고 경로 3은 API 키·서버가 필요해져 원칙과 부딪힌다. 단 "OZR을 고객별로 누가 만드는가"는 상품 원칙(서식=고객 직접 제작)과 충돌하므로 별도 결정이 필요하다(위 안 A).
3. 경로 3(OZFormParam 런타임 바인딩)은 API 키·서버 함수가 필요해져 "API 키 불필요" 원칙과 정면으로 부딪힌다 — 리포트 옵션처럼 **유료·API 키 보유 고객 한정 기능**으로만 고려한다.

## 실측 계획 (우선순위)
1. 경로 1: `make-pdf-product.py --logo <path>` 시제품 + `verify-template.mjs` 페이지 수 회귀 2건(로고 있음/없음).
2. 경로 3(유료 옵션으로 검토할 경우): OZFormParam으로 넘긴 이미지 URL이 완성 PDF 렌더까지 살아남는지 실 서식으로 1회 실측 — SENDABLE 숨김 필드 영속 경로 포함.
