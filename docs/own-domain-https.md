> **IT 담당자용 문서입니다. 고객은 읽지 않아도 됩니다.**

# 이폼사인 방명록 — 고객 자체 도메인에 올리기

Vercel 을 쓰지 않고 **고객사가 이미 운영 중인 웹서버나 스토리지**에 올리는 경로다. 사내 규정상 외부 호스팅을 쓸 수 없거나, 이미 사내 도메인과 인증서를 갖추고 있을 때 이 방식을 쓴다. Vercel 「Deploy」 버튼 경로는 [vercel-signup-guide.md](vercel-signup-guide.md) 에 있다.

---

## 임의 도메인에서 임베딩이 되는가 — 실증 결과 (2026-09-16)

**된다.** 이폼사인 서버는 임베딩 부모 페이지의 origin 을 제한하지 않는다.

`localhost` 도 `*.vercel.app` 도 아닌 호스트명(`https://kiosk.127.0.0.1.nip.io:8443`)에서 방명록 화면을 열어 ① 임베딩 스크립트 로드 ② 작성 화면 렌더 ③ 실제 작성·전송 ④ 전송 후 빈 서식 재오픈까지 전부 통과했다. 같은 절차를 `https://localhost:8444` 에서도 돌려 대조했고 결과가 같았다.

근거가 되는 응답 헤더:

| 확인한 것 | 결과 |
|---|---|
| `https://www.eformsign.com/lib/js/efs_embedded_v2.js` | HTTP 200. `Access-Control-Allow-Origin` 제약 없음 |
| `.../eform/document/external_user_view_service.html` (작성 화면 문서) | HTTP 200. **`X-Frame-Options` 없음**, **`Content-Security-Policy: frame-ancestors` 없음** |
| 이폼사인 도메인의 4xx/5xx 응답 | 없음 |

즉 프레임 차단은 헤더 수준에서 걸려 있지 않다. 배포 도메인 때문에 막힐 일은 없고, 실제로 막힌다면 원인은 **고객 쪽 프록시·방화벽이 헤더를 주입**하거나 **HTTPS 가 아니거나 템플릿 설정** 쪽이다.

한계 — 이 실증은 자체서명 인증서를 쓰는 로컬 Node HTTPS 서버에서 했다. 공인 인증서·실제 고객 웹서버(Nginx·IIS·CDN)와는 서버 종류가 다르다. 서버가 응답에 `X-Frame-Options` 나 `Content-Security-Policy` 를 주입하는 구성이면 그 도메인에서는 막힌다. 그래서 **첫 고객 도메인마다 아래 실증 절차를 한 번 돌린다.**

---

## 🔴 HTTPS 가 필수다

방명록 화면은 이폼사인 작성 화면(`https://www.eformsign.com/...`)을 `<iframe>` 으로 품는 구조다. 부모 페이지를 `http://` 로 열면 브라우저가 **혼합 콘텐츠(mixed content)** 로 판단해 https 하위 자원의 로딩을 막거나 경고한다. 작성 화면이 뜨지 않거나, 떠도 서식 본문이 비거나, 서명 패드 같은 일부 기능만 동작하지 않는 형태로 나타난다.

따라서 **배포 주소는 반드시 `https://`** 여야 한다. `file://` 로 열어도 임베딩 스크립트가 동작하지 않으므로 파일을 두 번 클릭해 여는 방식은 쓸 수 없다.

인증서는 무료로 발급받을 수 있다. 사내 발급 절차가 없으면 Let's Encrypt 와 `certbot` 을 쓴다(`certbot --nginx -d kiosk.example.co.kr` 로 발급과 갱신 설정이 한 번에 된다).

---

## 사전 조건

- 배포 주소가 `https://` 이고 인증서가 유효할 것(자체서명 인증서는 태블릿에서 경고가 떠 운영에 못 쓴다).
- 정적 파일 호스팅이면 충분하다. 서버 사이드 실행 환경·데이터베이스·API 키가 전부 필요 없다.
- 프록시·WAF 가 응답에 `X-Frame-Options` / `Content-Security-Policy: frame-ancestors` 를 주입하지 않을 것.
- 태블릿에서 `https://www.eformsign.com` 으로 나가는 통신이 열려 있을 것.

### 올려야 할 파일

저장소에서 `node build.mjs` 를 돌리면 `public/` 에 배포용 파일이 만들어진다. 설정 마법사로 zip 을 내려받았다면 압축을 푼 결과가 같은 구성이다. 웹 루트에 **디렉터리 구조 그대로** 올린다.

```
/index.html          키오스크 화면 (필수)
/config.js           설정 한 장 (필수)
/assets/logo.png     헤더 로고 (로고를 쓸 때만)
```

- `config.js` 의 `companyId` · `templateId` 가 고객 서식을 가리키는지 확인한다.
- 로고를 쓰지 않으면 `assets/` 를 통째로 빼고 `logoUrl` 을 빈 문자열로 둔다.
- `index.html` 과 `config.js` 에는 **캐시 금지 헤더**를 걸어 태블릿이 옛 설정을 물고 있는 것을 막는다(아래 서버별 예시에 포함).

---

## 우리 쪽 실증 절차 (첫 고객 도메인마다 1회)

고객이 파일을 올린 직후, 담당자에게 넘기기 전에 우리가 직접 돌린다.

```bash
cd kiosk-product
node tools/verify-origin.mjs --url https://kiosk.고객사.co.kr --label 고객사명
```

세 항목을 자동으로 판정한다.

| 항목 | 무엇을 보는가 | PASS 조건 |
|---|---|---|
| `[1] script` | 임베딩 스크립트 `efs_embedded_v2.js` | HTTP 200 + `EformSignDocument` 정의됨 |
| `[2] frame` | 작성 화면 iframe 렌더 | `action_callback` 도착(45초 이내) |
| `[3] submit` | 작성·전송·빈 서식 재오픈 (`--submit` 일 때만) | 제출 접수 + 빈 서식 재오픈 |

전송까지 확인하려면 `--submit` 을 붙인다. **실제 문서가 1건 만들어지므로** 고객 운영 서식이 아니라 테스트용 서식으로 먼저 돌리거나, 만들어진 문서를 고객에게 알린다.

```bash
node tools/verify-origin.mjs --url https://kiosk.고객사.co.kr --label 고객사명 --submit --notype
```

`--notype` 은 값 입력을 건너뛴다. 서식 항목이 바뀌면 입력칸 좌표가 어긋나므로, 고객 서식을 처음 보는 상태에서는 `--notype` 이 안전하다(좌표 잡는 법은 저장소 README 「서식을 고친 뒤」 절).

**남길 것**

- 결과 JSON: `reports/origin-<label>.json` — 판정·이폼사인 응답 헤더·콘솔 오류·문서 ID 가 전부 들어 있다.
- 스크린샷: `evidence/origin/<label>-*.png` — 작성 화면·입력·전송 후 빈 화면.
- 3항목 PASS 캡처와 결과 JSON 을 **아래 확인 기록 표에 한 줄로 요약**하고, 파일은 프로젝트 증거 폴더에 함께 보관한다.

### 확인 기록

| 확인일 | 도메인 | script | frame | submit | 비고 |
|---|---|---|---|---|---|
| 2026-09-16 | `kiosk.127.0.0.1.nip.io` (임의 호스트명 실증) | PASS | PASS | PASS | 자체서명·로컬 Node HTTPS. 차단 헤더 없음 |
| 2026-09-16 | `localhost` (대조군) | PASS | PASS | PASS | 임의 호스트명과 차이 없음 |
| 2026-09-16 | `eformsign-guestbook-test.vercel.app` | PASS | PASS | — | 전송 생략(운영 서식) |
| | | | | | |

### 고객에게 받을 정보

| 항목 | 왜 필요한가 |
|---|---|
| 배포할 도메인(예: `kiosk.example.co.kr`) | 실증 대상 URL |
| 호스팅 종류(Nginx / Apache / IIS / S3+CloudFront / Cloudflare Pages / 기타) | 캐시·헤더 설정 안내를 고르기 위해 |
| 인증서 발급 주체와 만료일 | 만료되면 태블릿이 경고 화면에서 멈춘다 |
| 프록시·WAF 사용 여부 | 프레임 차단 헤더 주입 가능성 |
| 전산 담당자 이름·연락처 | 실패 시 진단을 주고받을 창구 |
| 쓸 서식의 회사 ID·서식 ID | `config.js` 작성 |

---

## 웹서버별 최소 설정

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name kiosk.example.co.kr;
    ssl_certificate     /etc/letsencrypt/live/kiosk.example.co.kr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kiosk.example.co.kr/privkey.pem;
    root /var/www/kiosk;
    index index.html;
    location ~* ^/(index\.html|config\.js)$ { add_header Cache-Control "no-store, must-revalidate"; }
}
```

`add_header X-Frame-Options ...` 이나 `Content-Security-Policy` 를 전역으로 걸어 둔 서버라면 이 사이트에서는 빼거나 `frame-ancestors` 에서 이 페이지를 제외한다.

### Apache

```apache
<VirtualHost *:443>
    ServerName kiosk.example.co.kr
    DocumentRoot /var/www/kiosk
    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/kiosk.example.co.kr/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/kiosk.example.co.kr/privkey.pem
    <FilesMatch "^(index\.html|config\.js)$">
        Header set Cache-Control "no-store, must-revalidate"
    </FilesMatch>
</VirtualHost>
```

### IIS (Windows Server)

1. IIS 관리자에서 사이트를 만들고 실제 경로를 파일을 올린 폴더로 지정한다.
2. 바인딩에 **https / 443** 을 추가하고 서버 인증서를 고른다.
3. 기본 문서에 `index.html` 이 있는지 확인한다.
4. 캐시 금지는 `web.config` 로 건다.

```xml
<configuration><system.webServer><httpProtocol><customHeaders>
  <add name="Cache-Control" value="no-store, must-revalidate" />
</customHeaders></httpProtocol></system.webServer></configuration>
```

### Amazon S3 + CloudFront

1. S3 버킷에 파일을 올린다(퍼블릭 접근은 열지 않고 CloudFront 원본 접근 제어를 쓴다).
2. CloudFront 배포를 만들고 원본을 그 버킷으로 지정한다. 기본 루트 개체는 `index.html`.
3. 뷰어 프로토콜 정책을 **Redirect HTTP to HTTPS** 로 둔다.
4. 자체 도메인을 쓰면 ACM 에서 인증서를 발급(us-east-1 리전)해 배포에 연결한다.
5. `index.html` 과 `config.js` 오브젝트 메타데이터에 `Cache-Control: no-store` 를 넣는다. `.js` 의 `Content-Type` 이 `text/javascript` 인지 확인한다.

### Cloudflare Pages

1. Workers & Pages > Create > Pages > **Upload assets** 에서 `public/` 폴더를 통째로 올린다.
2. 배포되면 `https://<프로젝트>.pages.dev` 주소가 나온다. HTTPS 는 기본으로 붙는다.
3. 자체 도메인은 프로젝트의 Custom domains 에 추가한다.
4. 캐시 금지는 `public/_headers` 로 건다.

```
/index.html
  Cache-Control: no-store, must-revalidate
/config.js
  Cache-Control: no-store, must-revalidate
```

---

## 실패 시 진단 표

`verify-origin.mjs` 가 FAIL 을 내면 결과 JSON 의 `consoleErrors` · `blockingHeaders` · `httpErrors` 를 먼저 본다.

| 증상 / 로그 | 원인 | 조치 |
|---|---|---|
| `Mixed Content: The page at 'http://...'` · `[1] script` FAIL | 부모 페이지가 http | 배포 주소를 https 로. 인증서부터 확인 |
| `Refused to display ... in a frame` · 결과 JSON 의 `blockingHeaders` 에 `x-frame-options` 또는 `frame-ancestors` | 고객 프록시·WAF·서버가 프레임 차단 헤더를 주입 | 해당 사이트에서 그 헤더를 빼거나 `frame-ancestors` 예외 |
| 인증서 경고 화면에서 멈춤 | 자체서명·만료·중간 인증서 누락 | 공인 인증서로 교체. 체인 포함 여부 확인 |
| `config.js` 를 고쳤는데 옛 설정으로 뜬다 | 브라우저·CDN 캐시 | `Cache-Control: no-store` 적용 후 CDN 캐시 무효화 |
| `config.js` 가 `text/html` 로 내려온다 / `Refused to execute script` | MIME 타입 오설정 | `.js` → `text/javascript` 로 매핑(IIS: MIME 형식, S3: 오브젝트 Content-Type) |
| 화면 틀만 뜨고 본문이 빈다, 「보고서를 로딩하면서 예외가 발생했습니다」(1020030013), Network 에 403 | 템플릿의 **「URL로 문서 생성 허용」이 꺼짐** | 이폼사인 콘솔 > 템플릿 > 워크플로우 > 시작 단계 속성에서 켜고 재배포 |
| 전송했는데 「이미 작성한 문서입니다」로 바뀌고 문서가 안 생긴다 | 템플릿 알림 설정이 비어 있음(400) | 이폼사인 담당자에게 템플릿 점검 요청 |
| `[2] frame` FAIL 인데 콘솔이 깨끗하다 | `index.html`·`config.js` 가 안 올라갔거나 경로 어긋남, 또는 회사/서식 ID 오타 | 파일 구성과 `config.js` 값 확인 |
| 작성 중인데 화면이 자꾸 처음으로 돌아간다 | 대기시간이 짧게 잡힘 | `config.js` 의 `abandonResetSeconds` 를 늘린다 |

콘솔에 `Framing 'https://www.google.com/' violates ... frame-ancestors 'self'` (report-only) 나 `ERR_BLOCKED_BY_ORB` 가 보이는 것은 reCAPTCHA 쪽 메시지로, 실증에서 **전송이 정상 접수된 상태에서도 나타났다.** 실패 신호가 아니다.

---

## 운영 시 함께 볼 것

- 공개 주소가 외부로 새면 누구나 문서를 만들 수 있다. 템플릿 시작 단계의 **문서 생성 수 제한**이나 **도메인·IP 지정**을 함께 건다.
- 방문자의 개인정보를 받으므로 서식에 수집·이용 동의 항목을 둔다.
- 설정을 바꿀 때는 `config.js` 한 파일만 고쳐 다시 올린다.
