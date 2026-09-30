# 이폼사인 홍보영상 — 방명록 활용 사례 편

Remotion 4 단일 스택. 실사 촬영 없음. 소재는 ① 이폼사인 실화면 캡처 ② 생성형 실사 이미지 두 종류뿐이다.
기획 정본 = `../docs/marketing/promo-video-plan.md` (상품 저장소 루트 기준 `docs/marketing/promo-video-plan.md`)

## 한 화면 명령

```bash
pnpm install                 # typescript@5 고정 (7 은 Remotion 번들이 깨진다)

pnpm studio                  # 미리보기 (http://localhost:3000)
pnpm check                   # 쉬운 말 게이트 — 원고 금칙어·조사 띄어쓰기. exit 0 이어야 한다
pnpm tts                     # script.ts → public/voice/*.mp3 + 길이표. 장면 길이 역산표도 같이 나온다
node tools/tts.mjs --plan    # 음성 생성 없이 길이 역산표만
node tools/tts.mjs --force   # 캐시 무시하고 전부 다시

pnpm render:preview9         # 9초 시안 → out/preview9.mp4
pnpm render:main             # 60초 본편 → out/main60.mp4
pnpm typecheck

node tools/contact-sheet.mjs out/preview9.mp4   # 렌더 결과 프레임 4장 대조시트 → out/check/
```

🔴 **렌더는 오래 걸린다. 반드시 백그라운드로 돌린다**(포그라운드 2분 제한).

## 컴포지션 7개

| id | 크기 | 길이 | 용도 |
|---|---|---|---|
| `Main60` | 1920×1080 | 60초 | 본편 |
| `Cut15H` | 1920×1080 | 15초 | 컷다운 가로 (광고) |
| `Cut15V` | 1080×1920 | 15초 | 컷다운 세로 (광고) |
| `Loop30` | 1920×1080 | 30초 | 전시회 부스 루프판 (기본 무음) |
| `Gif3` | 1200×675 | 3초 | 뉴스레터 GIF (문서함에 쌓이는 장면) |
| `Still` | 1920×1080 | 60초 | 스틸컷 추출용 |
| `Preview9` | 1920×1080 | 9초 | Hook+Paper 스타일 확정 시안 |

**무음판은 따로 등록하지 않는다.** 같은 컴포지션에 `mute` 를 넘긴다.

```bash
npx remotion render Main60 out/main60-mute.mp4 --props='{"mute":true}'
npx remotion still Still out/still-01.png --frame=60
npx remotion render Gif3 out/gif3.gif --codec=gif
```

## 구조

```
src/script.ts              자막·나레이션 원고 단일 원천 (게이트·TTS·화면이 전부 여기서 나온다)
src/shots.ts               실화면 캡처 배치표 (캡처가 오면 여기 한 줄만 고친다)
src/Root.tsx               컴포지션 7개 등록
src/scenes/                장면 8개 = 스토리보드 행 1:1
                           Hook·Paper = 완성 · 나머지 6개 = 자막·타이밍이 보이는 레이아웃 뼈대
src/components/            Photo(카메라 무빙) · ScreenComposite(4점 코너 매핑)
                           Inbox(문서 쌓임) · Caption(한국어 줄바꿈) · SplitScreen · Slot · Stage
src/compositions/          Main60/Preview9 · Cut15 · Extras(Loop30·Gif3·Still)
public/gen/                생성형 실사 이미지 6장 (지금은 회색 플레이스홀더 — 파일만 교체하면 붙는다)
public/shots/              이폼사인 실화면 캡처 (커밋하지 않는다)
public/brand/              로고·슬로건 PNG — 🔴 텍스트 조판 금지, 이 PNG 만 쓴다
public/voice/              edge-tts mp3 + voice.json (길이·역산)
tools/check-script.mjs     쉬운 말 게이트
tools/tts.mjs              나레이션 생성 + 장면 길이 역산 (읽기 속도 RATE=+10%)
tools/contact-sheet.mjs    렌더 결과 프레임 대조시트 (길이·용량만 보고 완료를 주장하지 않으려고)
tools/gen-images.md        생성 이미지 프롬프트 6개 (재생성 조건)
```

## 지켜야 할 선

- **주인공은 이폼사인.** 자막·나레이션에 「태블릿」 「설치」 「무인 키오스크」를 쓰지 않는다 — `pnpm check` 가 막는다.
- **가격 숫자·「무료」 금지.** 리포트는 「유료 옵션」 각주까지만.
- **브랜드**: 메인 `#0E73C3` 이 유일한 메인 컬러. 서브는 20% 미만. 로고·슬로건은 제공 PNG 만.
- **생성 이미지 경계**: 이폼사인 화면·로고·문서는 생성하지 않는다. 생성 이미지 안의 글자는 쓰지 않고 Remotion 텍스트로 덧씌운다.
- **회사 ID·서식 ID·실데이터 노출 0.** 실화면 캡처는 영상 전용 데모 계정으로만 찍고 이 저장소에 커밋하지 않는다.
- **전송 팝업 2회는 제품 동작이다.** 편집으로 지우지 않는다.
- **한국어 줄바꿈**: `keep-all` + `break-word`(🔴 `anywhere` 금지), 조사는 앞 어절과 같은 줄, 자막 한 줄 15~25자.

## 소재가 도착하면

| 소재 | 놓는 곳 | 바꿔야 하는 코드 |
|---|---|---|
| 생성 이미지 6장 | `public/gen/gen-0N.png` 덮어쓰기 | 없음 |
| 문서함 캡처 | `public/shots/…` | `src/shots.ts` 의 `INBOX_SHOT` 에 경로 한 줄. Hook·Fill·Repeat 의 문서함이 캡처 위 도착 모션으로 바뀐다 |
| 그 밖의 실화면 캡처 | `public/shots/*.png` | 각 장면의 `Slot` 을 `ScreenComposite` 로 교체하고 네 꼭짓점 좌표를 넣는다 |
| 음원·효과음 | `public/audio/` | 장면에 `<Audio>` 추가 |

`TimeTag`(좌상단 타이밍 표식)는 조립 단계 확인용이다. **최종 렌더 전에 뗀다.**

🔴 작성 화면 캡처(B·C)를 다시 찍으면 `node tools/measure-scenes.mjs` → `node tools/prescale-shots.mjs` 순서로 돌린다.
prescale 이 이폼사인 「다음 입력 칸」 분홍 안내 화살표·맞춤법 물결 밑줄을 `_scaled/` 사본에서 지운다(`tools/remove-guide-arrow.py`, 원본은 그대로).
확인 = `node tools/check-hand-motion.mjs --video <Fill·Repeat 구간 mp4>`(분홍 화소 프레임 0).

## 본편 렌더 기록

| 판 | 명령 | 결과 |
|---|---|---|
| v3.3 (2026-09-30, 레인 V2·R) | `npx remotion render Main60 out/main60-v3.3.mp4 --timeout=180000 --concurrency=4` | 1800f·60.05초·28.4MB · sha256 f951a23faaf7… · I -16.8 LUFS · TP -2.4 dBTP · 분리도 최소 12.5 dB · 게이트 10종 exit 0 |
