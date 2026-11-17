# 프롬프트 감사 — eformsign-guestbook (2026-09-30)

## 가정 (Step 0)

- **범위**: 작업 디렉터리 `D:\pjt\eformsign-guestbook` 의 프롬프트 표면만. 인벤토리 결과 지침 파일은 루트 `CLAUDE.md` 1개다. 중첩 `CLAUDE.md`·`CLAUDE.local.md`·`AGENTS.md`·`SKILL.md`·`.cursorrules`·규칙/명령/서브에이전트/출력 스타일 파일은 저장소에 없다. `.claude/` 에는 `launch.json`(개발 서버 실행 설정, 프롬프트 아님) 하나만 있어 존재만 확인하고 읽지 않았다. `.claude/settings*.json`·`.mcp.json`·자격 파일은 저장소에 없으며 읽지 않았다(`.env.local` 은 git-ignored, 존재만 확인). Anthropic/Claude API 요청을 만드는 코드(`anthropic`·`claude-`·`messages.create`·`@anthropic-ai`)는 추적 파일 전체에서 0건이다.
- **건너뛴 파일(범위 밖, 내용 미감사)**: 사용자 수준 설정 `C:\Users\FORCS\.claude\`(전역 `CLAUDE.md`·`RULES.md`·스킬 `eformsign-kiosk`·프로젝트 memory), `C:\Users\FORCS\.agent-harness\`(게이트 `gate-verify.mjs`·`gate-route.mjs`, 볼트 팩 `…/llm-wiki/wiki/packs/eformsign-api-support-pack/claims.md`), 형제 저장소 `eformsign-guestbook-demo/tools-evidence/`. `CLAUDE.md` 가 이들을 경로로 가리키지만 저장소 밖이므로 존재 여부로 판정하지 않았다.
- **대상 모델**: 요청에 모델 지정 없음. `CLAUDE.md` 는 코딩 에이전트가 읽으므로 감사를 수행하는 모델 기준 **Claude Fable 5.1 (`claude-fable-5-1`)**. 저장소에 요청 생성 코드가 없어 앱 쪽 대상 모델은 해당 없음.
- **비-Anthropic 공급자 마커 grep** (`openai|langchain_openai|google.generativeai|genai|mistralai|cohere|ollama|gpt-4|gpt-5`): 실질 적중은 `promo/public/gen/prompts.json:26,384,445,550,605,662` 뿐이다 — 홍보 영상용 이미지 생성 프롬프트 기록이며 도구는 `"gpt-image 스킬 (ChatGPT 구독 경로 … OPENAI_API_KEY·Images API 미사용"`. Claude 프롬프트 표면이 아니므로 감사하지 않았고 Anthropic SDK 로의 전환도 제안하지 않는다. 나머지 적중(`phaseCoherence`·`coherence`, `promo/tools/measure-book.mjs`·`book-axis.py`)은 부분 문자열 오탐이다. git-ignored `.local/` 아래 적중(자동화용 Chrome 프로필 데이터·네트워크 캡처·배포 로그)은 프롬프트 표면이 아니라 제외했다. 같은 전체 트리 검색에서도 지침 파일은 루트 `CLAUDE.md` 하나뿐이었다.
- **이력**: 이 저장소 이력은 2026-09-16 초기 커밋(`392c13a`)부터이며 `CLAUDE.md` 는 2026-09-17 `adb0a2b` 에서 추가되고 `0f87f89` 에서 11행만 바뀌었다. 모노레포 분리 이전의 출처는 모노레포 이력에 있다.

## 요약

가장 영향이 큰 결함은 사실이 코드보다 뒤처진 두 곳이다. 첫째, `CLAUDE.md:12` 는 쉬운 말 게이트 대상을 「고객용 문서 4종」이라 하지만 게이트 스크립트의 `--docs` 목록은 2026-09-28 `fb8721a` 에서 `docs/multirow-option.md` 가 더해져 5종이다. README 도 이미 5종으로 적는다. 에이전트가 이 숫자를 믿고 4종만 손보거나 목록을 따로 관리하면 새 고객 문서가 게이트 밖으로 빠진다. 둘째, `CLAUDE.md:3` 은 「고객 배포본에 API 키가 필요 없다」고 조건 없이 말하지만, 저장소의 `api/report.mjs`·`api/multirow.mjs` 는 `EFORMSIGN_API_KEY` 를 요구하고 README 는 같은 주장을 「유료 옵션을 켤 때만 씀」으로 한정한다. 조건 없는 문장은 옵션 작업 중인 에이전트를 오도할 수 있다.

압박 언어·스캐폴드·과잉 명세 같은 모델 세대 결함은 없다. `🔴` 표시는 1곳(「public 저장소」)이고 공개 저장소라는 이유가 제목에 붙어 있는 실제 정책 제약이다.

| 그룹 | 건수 |
|---|---|
| Group 1 (낡은 프롬프트 문구) | 0 |
| Group 2 (취약한 스킬·설정 파일) | 2 (High 1·Medium 1) + Low 표시 1 |
| Group 3 (도구 설명) | not applicable — 도구 정의 없음 |
| Group 4 (요청 설정·아키텍처) | not applicable — 요청 생성 코드·서브에이전트 정의 없음 |

## 발견 사항

### 1. 쉬운 말 게이트 대상 문서 수가 스크립트와 불일치

- **Location**: `CLAUDE.md:12`
- **Evidence**: `- 고객용 문서 4종은 쉬운 말 게이트(`tools/check-plain-language.mjs --docs`) 대상이다.`
- **Pattern**: Group 2 — Volatile specifics (저장소가 반박하는 사실 주장)
- **Why obsolete**: `tools/check-plain-language.mjs:56-63` 의 `CUSTOMER_DOCS` 는 `docs/README.md`·`docs/vercel-signup-guide.md`·`docs/report-option.md`·`docs/after-form-change.md`·`docs/multirow-option.md` 5개이며, 5번째 항목은 `fb8721a`(2026-09-28, 누적형 옵션 추가)에서 들어왔다. 스크립트 주석(7·56행)과 `README.md:147,420` 도 「5종」이다. `CLAUDE.md` 의 숫자는 그 이전(`adb0a2b`, 09-17) 상태로 남아 있다. 경로와 `--docs` 플래그 자체는 현존하며 정상 정의돼 있다(`check-plain-language.mjs:192`).
- **Confidence**: High (저장소 자체가 반박)
- **Action**: `rewrite` — 다시 어긋나지 않도록 숫자 대신 단일 진실(스크립트 목록)을 가리킨다:
  `- 고객용 문서(목록 = `tools/check-plain-language.mjs` 의 `CUSTOMER_DOCS`)는 쉬운 말 게이트(`tools/check-plain-language.mjs --docs`) 대상이다.`

### 2. 「API 키 불필요」가 유료 옵션 조건 없이 서술됨

- **Location**: `CLAUDE.md:3`
- **Evidence**: `… 설정 마법사(`setup.html`)에 이폼사인 외부 작성 URL 을 붙여넣으면 동작한다 — **고객 배포본에 API 키가 필요 없다**.`
- **Pattern**: Group 2 — Volatile specifics (범위가 코드보다 넓게 쓰인 사실 주장)
- **Why obsolete**: 기본 키오스크 화면에 대해서는 맞지만, 같은 배포본에 들어 있는 `api/report.mjs:9,59`·`api/multirow.mjs:14,89,108` 은 `EFORMSIGN_API_KEY`(와 개인키·멤버 ID)를 요구한다. `README.md:10-11` 은 같은 주장을 「API 키는 아래 「완료 문서 리포트」 유료 옵션을 켤 때만 씁니다」로 한정하고, `docs/multirow-option.md:12` 도 누적형은 API 키가 필요하다고 적는다. 조건 없는 문장은 옵션 작업 시 「키를 쓰면 안 된다」 또는 「키 설정 안내 불필요」로 잘못 읽힐 수 있다. 제품 맥락 문장 자체는 유지해야 할 context 이므로 삭제가 아니라 한정만 추가한다.
- **Confidence**: Medium (저장소가 무조건 서술을 부분적으로 반박하지만 기본 경로에 대해서는 여전히 참)
- **Action**: `rewrite` — `**기본 배포본에는 API 키가 필요 없다**(리포트·누적형 유료 옵션만 `api/` 서버 함수가 `EFORMSIGN_API_KEY` 등 환경변수를 쓴다).`

### 3. env 규칙 목록에 `EFORMSIGN_ENV_FILE` 누락 (표시만)

- **Location**: `CLAUDE.md:19`
- **Evidence**: `- 모노레포 SDK/CLI 는 env 로만: `EFORMSIGN_CORE_DIR` · `EFORMSIGN_CLI`. 절대경로 하드코딩 금지.`
- **Pattern**: Group 2 — Volatile specifics (불완전 목록)
- **Why obsolete**: 두 변수는 실제로 쓰인다(`tools/multirow/env.mjs:13-14`, `promo/tools/make-ozr-report.mjs:36-37`). 다만 `tools/multirow/embed-member.mjs:6`·`tablet-step.mjs:9,184` 는 세 번째 외부 경로 변수 `EFORMSIGN_ENV_FILE` 도 요구한다. 기재된 항목이 반박되지는 않았고 「SDK/CLI」 범위에 자격 파일 경로가 포함되는지는 작성자 판단이라 High/Medium 근거가 없다. 추적 코드에서 모노레포 절대경로 하드코딩은 발견되지 않았다(문서 `docs/design/logo-injection-options.md:12` 의 조사 근거 인용 1건은 코드가 아님).
- **Confidence**: Low
- **Action**: `flag` — 자격 파일 경로도 이 규칙에 포함할지 사용자 결정 사항.

### 검토했으나 finding 아님 (keep list 적용)

- `CLAUDE.md:10-11` 「🔴 public 저장소 — 회사 ID·템플릿 ID·검증 리포트를 커밋하지 않는다」: 공개 저장소라는 이유와 자산의 실제 위치가 붙은 정책 제약(1e). 유지.
- `CLAUDE.md:15` 「exit 1 = 완료 주장 금지」: 게이트 도구 계약을 서술하는 절차 규칙(fragile operation). 유지.
- `CLAUDE.md:19` 「절대경로 하드코딩 금지」: 코드(`env.mjs` 의 throw)가 강제하는 이식성 제약. 유지.
- `CLAUDE.md:5-8` 「작업 시작 시」 번호 목록: 라우팅 텍스트이며 순서(스킬→팩→memory)가 의미를 가진다. 유지.
- `CLAUDE.md:8` 프로젝트 memory 경로: 하네스가 자동 로드하는 경로와 중복되지만 서로 일치하는 working redundancy(keep list 8). 저장소 밖 경로라 probe 하지 않음.
- `CLAUDE.md:3` 「2026-09-17 에 모노레포 `kiosk-product/` 에서 … 분리했다」: 스킬 `eformsign-kiosk` 가 옛 이름 `kiosk-product` 를 쓰는 이유를 알려주는 환경 사실(context). 유지.
