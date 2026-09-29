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

## 다른 회사로 서식 복제 (2026-09-29 실측, efstest v6 → 테스트 회사)

`eformsign templates copy-to-company <원본 ID> --target-api-key … --target-private-key-file … --target-member-id … --name "<이름>" --category 키오스크 --copy-config -y --json > copy.json`(원본 env) → `node tools/multirow/copy-finish.mjs --source-env <원본.env> --target-env <대상.env> --copy-out copy.json`(notification·external_access 복사 + release) → `node tools/multirow/deploy.mjs --apply-to "<이름>" --skip-send-popup --outsider-complete-mail-off`(대상 env, quick_processing) → `verify-template.mjs --template-name "<이름>"` = MULTIROW_TEMPLATE_READY. copy 직후엔 미배포라 verify-template 이 이름으로 못 찾는다.
