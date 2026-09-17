# 이폼사인 방명록 — 상품판 (eformsign-guestbook, public)

고객이 자기 Vercel/웹서버에 직접 배포하는 무인 방명록 키오스크 래퍼다. 설정 마법사(`setup.html`)에 이폼사인 외부 작성 URL 을 붙여넣으면 동작한다 — **고객 배포본에 API 키가 필요 없다**. 2026-09-17 에 모노레포 `kiosk-product/` 에서 이 저장소 **루트**로 분리했다.

## 작업 시작 시
1. 스킬 `eformsign-kiosk` 를 먼저 호출한다(요건 판별·템플릿 조건·배포·검증·함정).
2. 볼트 팩 `…/llm-wiki/wiki/packs/eformsign-api-support-pack/claims.md` 의 「키오스크 반복 작성 조사」 절을 통독한다.
3. 프로젝트 memory = `C:/Users/FORCS/.claude/projects/D--pjt-eformsign-guestbook/memory/`.

## 🔴 public 저장소
- 회사 ID·템플릿 ID·검증 리포트를 커밋하지 않는다(그 자산은 `eformsign-guestbook-ops/tools-evidence/` 에 있다).
- 고객용 문서 4종은 쉬운 말 게이트(`tools/check-plain-language.mjs --docs`) 대상이다.

## 완료 판정
- 완료 게이트: `node C:/Users/FORCS/.agent-harness/gates/gate-verify.mjs --task "<요청>" --artifact <산출물>` (exit 1 = 완료 주장 금지).
- 착수 라우팅: `node C:/Users/FORCS/.agent-harness/gates/gate-route.mjs --task "<요청>" --workspace "<이 폴더>"`.

## 의존
- 모노레포 SDK/CLI 는 env 로만: `EFORMSIGN_CORE_DIR` · `EFORMSIGN_CLI`. 절대경로 하드코딩 금지.
