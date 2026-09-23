#!/usr/bin/env python3
"""화면 영역 **200% 크롭**으로 v2(전) 대 v3(후)를 나란히 놓는다.

왜 도구로 만드나: 축소된 대조시트로는 합성 결함이 안 보인다(2026-09-10 교훈,
memory `feedback_review_composites_at_full_size`). 판정은 원본 크기 이상의 크롭으로 한다.

쓰는 법
  python tools/compare-stills.py <before.png> <after.png> <out.png> x y w h [scale]
"""
import sys
from PIL import Image, ImageDraw, ImageFont

before, after, out = sys.argv[1], sys.argv[2], sys.argv[3]
x, y, w, h = (int(v) for v in sys.argv[4:8])
scale = int(sys.argv[8]) if len(sys.argv) > 8 else 2

try:
    font = ImageFont.load_default(28)
except TypeError:  # 옛 PIL
    font = ImageFont.load_default()

BAR = 40
tiles = []
for path, label in ((before, "v2  BEFORE"), (after, "v3  AFTER")):
    im = Image.open(path).convert("RGB").crop((x, y, x + w, y + h))
    im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    tile = Image.new("RGB", (im.width, im.height + BAR), (16, 22, 32))
    tile.paste(im, (0, BAR))
    ImageDraw.Draw(tile).text((10, 8), label, fill=(255, 255, 255), font=font)
    tiles.append(tile)

gap = 16
canvas = Image.new(
    "RGB", (sum(t.width for t in tiles) + gap, tiles[0].height), (16, 22, 32)
)
cx = 0
for t in tiles:
    canvas.paste(t, (cx, 0))
    cx += t.width + gap
canvas.save(out)
print(f"{out} {canvas.size} (crop {x},{y} {w}x{h} @{scale}x)")
