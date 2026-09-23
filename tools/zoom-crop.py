#!/usr/bin/env python3
"""스틸 한 장에서 **기기 화면 영역만 잘라 확대**한다(기본 200%, lanczos).

왜 있나: 합성 결함(눌린 화면·손가락 위 화면·서식 어긋남)은 축소된 대조시트에서
안 보인다. 판정은 원본 크기 이상의 크롭으로 한다
(memory `feedback_review_composites_at_full_size`, 2026-09-10).
`compare-stills.py` 는 전/후 두 장을 나란히 붙이는 도구고, 이것은 **한 장**을 키운다.

쓰는 법
  python tools/zoom-crop.py <in.png> <out.png> x y w h [scale]
  python tools/zoom-crop.py out/check/v3k-fill-733.png out/check/v3k-fill-zoom200.png 285 220 555 655

x,y,w,h 는 1920x1080 프레임 좌표. 프레임 밖으로 나가면 잘라 맞춘다.
좌표의 근거: 장면의 화면 자리는 `public/gen/prompts.json` 의 screenQuad
(Fill=gen-03 · Repeat=gen-04/05 · Manage=gen-06) 와 `src/scenes/Branch.tsx` 의 FORM 상자다.
🔴 다만 장면 컴포넌트가 그 위에 카메라(Photo pan/zoom)와 StagePane 확대를 더 얹으므로
**렌더된 스틸에서의 실제 자리는 quad 좌표와 다르다** — 스틸을 보고 잡은 값을 인자로 준다.
"""
import sys
from PIL import Image

if len(sys.argv) < 7:
    sys.exit(__doc__)

src, out = sys.argv[1], sys.argv[2]
x, y, w, h = (int(v) for v in sys.argv[3:7])
scale = int(sys.argv[7]) if len(sys.argv) > 7 else 2

im = Image.open(src).convert("RGB")
x0, y0 = max(0, x), max(0, y)
x1, y1 = min(im.width, x + w), min(im.height, y + h)
crop = im.crop((x0, y0, x1, y1))
big = crop.resize((crop.width * scale, crop.height * scale), Image.LANCZOS)
big.save(out)
print(f"{out}  {crop.width}x{crop.height} -> {big.width}x{big.height} (x{scale}, lanczos)")
