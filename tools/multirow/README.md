# tools/multirow — 누적형 방명록(1문서 N인) 서식 빌드·실측 도구 (내부용)

## 고객 로고가 들어간 상품 서식 만들기 (A안, 2026-09-28)

```
EFORMSIGN_CORE_DIR=<eformsign-core> node tools/multirow/build.mjs --layout tools/multirow/layout-product.json --variant D --logo <고객로고.png|jpg|svg> --pdf <out>/bg-D.pdf --out <out>/guestbook-D.ozr --xml <out>/guestbook-D.xml
```

- `--logo` 를 빼면 로고 없이 기관명 텍스트만(기관명·부서 값칸이 표 오른쪽 끝까지 넓어진다).
- 로고 자리 = variant D `logoSlot`(오른쪽 위 20~52pt, 높이 32pt 고정, 너비 140pt 상한 — 넘으면 높이를 줄여 세로 가운데). 기관명·부서 값칸 오른쪽 끝 = 로고 왼쪽 − 8pt.
- 형식: PNG(투명 유지)·JPG. SVG 는 PyMuPDF 가 이미지로 직접 못 받아 600px 로 래스터해 넣는다 — SVG 안의 글자는 대체 글꼴로 그려지므로 윤곽선 SVG 또는 PNG 를 받는다. 인쇄 크기 기준 150dpi 미만이면 `WARN logo resolution low` 를 찍는다.
- 확인: 출력 JSON 의 `bgPages: 1`·`pages: 1`·`logo: [x0,y0,x1,y1]`. 배경 1쪽 PNG 를 200% 로 잘라 로고와 기관명이 안 겹치는지 본다. 그 뒤 배포·designer-open·eformsign-render 게이트는 기존 절차(스킬 `eformsign-kiosk` references/multirow-guestbook.md).
- `logoSlot` 이 없는 variant(A·B·C·C2·P)에 `--logo` 를 주면 오류로 멈춘다. C2 의 로고 2개는 `logos[]` 고정값 그대로다.

## 필수 표시는 자기 행만 (D v7, 2026-09-29 — `ozrRequired: "own-row"`)

- variant D 는 `ozrRequired: "own-row"` 다. 성명·서명에 정적 `REQUIRED="true"` 20건을 그대로 두고(빈 전송 차단은 이 정적 속성 + 참여자 단계 필수가 함께 있어야 성립 — v4 플랫폼 필수 단독은 실패), 모든 입력칸 OnBind 에 `This.SetRequired(_cur === _row)` 를 넣어 **단계 k 에서는 k행만** 필수(분홍·뱃지)로 보이게 한다. 단계를 모르는 화면(편집기 미리보기·PDF, `_cur 0`)에서는 전 행이 필수 해제로 그려진다.
- 확인: 빌드 xml 에서 `REQUIRED="true"` 20 · `SetRequired(_cur === _row)` 20. 열람 화면 트래커 「필수 입력 항목(0/2)」, 입력 없이 「입력 시작 → 다음」을 눌러도 「전송」 버튼이 생기지 않고 문서 단계가 그대로면 차단 성립.
- `"static"`(v6 까지)은 정적 속성만이라 편집기·뷰어에서 10행 성명·서명이 전부 분홍으로 보인다.

## 다른 회사로 서식 복제 (2026-09-29 실측, efstest v6 → 테스트 회사)

`eformsign templates copy-to-company <원본 ID> --target-api-key … --target-private-key-file … --target-member-id … --name "<이름>" --category 키오스크 --copy-kiosk-config -y`(원본 env) 한 줄 → `verify-template.mjs --template-name "<이름>"`(대상 env) = MULTIROW_TEMPLATE_READY. `--copy-kiosk-config` 가 기본 config 5키 + 알림·외부 접근·외부 사용자 플래그(URL 로 문서 생성 허용·본인확인)·팝업 생략(quick_processing)을 멤버·회사 ID 치환해 복사하고 배포(release)까지 한다 — 후처리 스크립트·`deploy.mjs --apply-to` 불필요(2026-09-29 SDK 옵션화 검증). 🔴 `--copy-config` 만 쓰면 이 네 가지가 빠지고, `--no-release` 를 주면 미배포로 남아 verify-template 이 이름으로 못 찾는다. 문서 관리자(form_manager.members)는 복사되지 않는다(서버가 빈 배열로 돌려줌). 모노레포 CLI 에 `--copy-kiosk-config` 가 있어야 한다(브랜치 feat/copy-to-company-release, 머지 전).
