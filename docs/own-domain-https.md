<!-- 제품 이름 미확정: 이 문서의 이폼사인 방명록 을 확정된 제품 이름으로 일괄 치환한 뒤 고객에게 전달한다. -->

# 이폼사인 방명록 — 고객 자기 도메인에 올리기

Vercel 을 쓰지 않고 **고객사가 이미 운영 중인 웹서버나 스토리지**에 올리는 방법이다. 사내 규정상 외부 호스팅을 쓸 수 없거나, 이미 사내 도메인과 인증서를 갖추고 있을 때 이 방식을 쓴다.

Vercel 「Deploy」 버튼으로 설치하는 방법은 [vercel-signup-guide.md](vercel-signup-guide.md) 에 있다.

---

## 🔴 HTTPS 가 필수다

이폼사인 방명록 의 화면은 이폼사인 작성 화면(`https://www.eformsign.com/...`)을 `<iframe>` 으로 품는 구조다.

부모 페이지를 `http://` 로 열면 브라우저가 **혼합 콘텐츠(mixed content)** 로 판단해 https 하위 자원의 로딩을 막거나 경고한다. 작성 화면이 뜨지 않거나, 떠도 서식 본문이 비거나, 서명 패드 같은 일부 기능만 동작하지 않는 형태로 나타난다. 브라우저·버전에 따라 증상이 달라서 원인을 찾기 어렵다.

따라서 **배포 주소는 반드시 `https://` 여야 한다.** `file://` 로 열어도 임베딩 스크립트가 동작하지 않으므로 파일을 두 번 클릭해 여는 방식은 쓸 수 없다.

인증서는 무료로 발급받을 수 있다. 사내 인증서 발급 절차가 없으면 Let's Encrypt 와 `certbot` 을 쓴다(`certbot --nginx -d kiosk.example.co.kr` 형태로 발급과 갱신 설정이 한 번에 된다).

---

## 올려야 할 파일

저장소에서 `node build.mjs` 를 돌리면 `public/` 에 배포용 파일이 만들어진다. 설정 마법사로 zip 을 내려받았다면 압축을 푼 결과가 같은 구성이다. 이 파일들을 웹 루트에 **디렉터리 구조 그대로** 올린다.

```
/index.html          키오스크 화면 (필수)
/config.js           설정 한 장 (필수)
/assets/logo.png     헤더 로고 (로고를 쓸 때만)
```

- `config.js` 의 `companyId` · `templateId` 가 고객 서식을 가리키는지 확인한다.
- 로고를 쓰지 않으면 `assets/` 를 통째로 빼도 된다. `config.js` 의 `logoUrl` 을 빈 문자열로 둔다.
- `index.html` 과 `config.js` 에는 **캐시 금지 헤더**를 걸어 둔다. 태블릿이 옛 설정을 물고 있는 것을 막는다. 아래 서버별 예시에 포함해 두었다.

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

1. S3 버킷에 파일을 올린다(퍼블릭 접근은 열지 않고 CloudFront 의 원본 접근 제어를 쓴다).
2. CloudFront 배포를 만들고 원본을 그 버킷으로 지정한다. 기본 루트 개체는 `index.html`.
3. 뷰어 프로토콜 정책을 **Redirect HTTP to HTTPS** 로 둔다.
4. 자체 도메인을 쓰면 ACM 에서 인증서를 발급(us-east-1 리전)해 배포에 연결한다.
5. `index.html` 과 `config.js` 오브젝트의 메타데이터에 `Cache-Control: no-store` 를 넣는다.

### Cloudflare Pages

1. Cloudflare 대시보드 > Workers & Pages > Create > Pages > **Upload assets** 에서 `public/` 폴더를 통째로 올린다.
2. 배포되면 `https://<프로젝트>.pages.dev` 주소가 나온다. HTTPS 는 기본으로 붙는다.
3. 자체 도메인을 쓰려면 프로젝트의 Custom domains 에 도메인을 추가한다.
4. 캐시 금지는 `public/_headers` 파일로 건다.

```
/index.html
  Cache-Control: no-store, must-revalidate
/config.js
  Cache-Control: no-store, must-revalidate
```

---

## 올린 뒤 확인 절차

PC 브라우저에서 배포 주소를 열고 다음을 순서대로 본다.

1. **주소창이 `https://` 이고 자물쇠 표시가 정상인가.** 인증서 경고가 뜨면 여기서 멈추고 인증서부터 고친다.
2. **이폼사인 서식 본문이 보이는가.** 화면 틀만 뜨고 가운데가 비어 있으면 아래 「증상별 원인」을 본다.
3. **개발자도구(F12) > Console 에 빨간 오류가 없는가.**
   - `Mixed Content: The page at 'http://...' was loaded over HTTPS...` → 부모 페이지가 http 다. 1번으로 돌아간다.
   - `Refused to display ... in a frame` → 브라우저나 사내 프록시가 프레임 표시를 막고 있다. 방화벽·프록시의 `Content-Security-Policy` / `X-Frame-Options` 주입 설정을 본다.
4. **개발자도구 > Network 에 403 이 있는가.** `.../forms/<템플릿ID>/ozrs/<...>` 요청이 403 이면 템플릿의 **「URL로 문서 생성 허용」이 꺼져 있다.** 이폼사인 콘솔에서 템플릿 설정 > 워크플로우 > 시작 단계 속성에서 켜고 재배포한다.
5. **한 건 작성해 전송한다.** 방문자는 전송 버튼을 누른 뒤 확인 팝업에서 한 번 더 전송을 누른다. 이폼사인 콘솔 > 문서 관리에서 그 문서가 보이면 된다.
6. **태블릿에서도 같은 절차를 반복한다.** PC 에서만 확인하고 끝내지 않는다.

### 증상별 원인

| 증상 | 원인 | 조치 |
|---|---|---|
| 화면 틀만 뜨고 본문이 빈다, 「보고서를 로딩하면서 예외가 발생했습니다」(1020030013) | 템플릿의 「URL로 문서 생성 허용」이 꺼짐 → 403 | 콘솔에서 켜고 재배포 |
| 전송을 눌렀는데 「이미 작성한 문서입니다」로 바뀌고 문서가 안 생긴다 | 템플릿 알림 설정이 비어 있음 | 이폼사인 담당자에게 템플릿 점검 요청 |
| 작성 중인데 화면이 자꾸 처음으로 돌아간다 | 대기시간이 짧게 잡힘 | `config.js` 의 `abandonResetSeconds` 를 늘린다 |
| 아무 일도 일어나지 않고 콘솔도 깨끗하다 | `index.html` 이 통째로 올라가지 않았거나 경로가 어긋남 | 파일 구성을 다시 확인한다 |

---

## 🔴 첫 배포 시 확인이 필요한 사항

임의 고객 도메인에서 이폼사인 임베딩이 허용되는지는 Vercel 도메인과 localhost 에서만 실증되었으며, 자체 도메인은 첫 배포 시 실제 확인이 필요합니다(확인 후 이 문서에 결과를 기록).

확인 방법은 위 「올린 뒤 확인 절차」 2~5번 그대로다. 4번에서 403 이 아닌 다른 거부가 나오거나 프레임 자체가 차단되면 그 응답과 콘솔 메시지를 남겨 이폼사인 담당자에게 전달한다.

확인이 끝나면 아래 표에 결과를 적는다.

| 확인일 | 도메인 | 결과 | 비고 |
|---|---|---|---|
| | | | |

---

## 운영 시 함께 볼 것

- 공개 주소가 외부로 새면 누구나 문서를 만들 수 있다. 템플릿 시작 단계의 **문서 생성 수 제한**이나 **도메인·IP 지정**을 함께 건다.
- 방문자의 개인정보를 받으므로 서식에 수집·이용 동의 항목을 둔다.
- 설정을 바꿀 때는 `config.js` 한 파일만 고쳐 다시 올린다.
