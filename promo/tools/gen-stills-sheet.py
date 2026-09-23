#!/usr/bin/env python
"""생성 스틸 6장(+세로 3장)을 한 장의 대조시트로 붙인다.

왜 있나: 장면을 하나씩 열어보면 "같은 공간으로 읽히는가"를 판정할 수 없다.
prompts.json 의 screenQuad(화면 합성 자리)는 빨강, bookQuad(종이 지면)는 주황으로 겹쳐 그린다.
  python tools/gen-stills-sheet.py
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = os.path.join(ROOT, "public", "gen")
spec = json.load(open(os.path.join(GEN, "prompts.json"), encoding="utf-8"))

items = []
for s in spec["scenes"]:
    items.append((os.path.basename(s["output"]["landscape"]), s.get("screenQuad"), s.get("bookQuad")))
for s in spec["scenes"]:
    if s["output"].get("portrait"):
        items.append((os.path.basename(s["output"]["portrait"]), s.get("screenQuadPortrait"), s.get("bookQuadPortrait")))

CW, PAD, TOP = 640, 22, 56
cols = 3
try:
    font = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 17)
    title = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 24)
except OSError:
    font = title = ImageFont.load_default()

tiles = []
for name, sq, bq in items:
    im = Image.open(os.path.join(GEN, name)).convert("RGB")
    d = ImageDraw.Draw(im)
    for quad, color in ((sq, (220, 30, 30)), (bq, (235, 130, 20))):
        if quad:
            d.polygon([tuple(p) for p in quad["points"]], outline=color, width=max(4, im.width // 300))
    h = int(im.height * CW / im.width)
    tiles.append((name, im.resize((CW, h), Image.LANCZOS), im.size))

rows, i = [], 0
while i < len(tiles):
    rows.append(tiles[i:i + cols]); i += cols
W = PAD + cols * (CW + PAD)
H = TOP + sum(max(t[1].height for t in r) + 28 + PAD for r in rows)
sheet = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(sheet)
d.text((PAD, 16), "eformsign promo - generated stills (contact sheet)  ·  red = screenQuad  ·  orange = bookQuad(종이 지면)", fill="black", font=title)
y = TOP
for r in rows:
    x = PAD
    for name, im, orig in r:
        sheet.paste(im, (x, y))
        d.text((x, y + im.height + 6), f"{name}   {orig[0]}x{orig[1]}", fill=(60, 60, 60), font=font)
        x += CW + PAD
    y += max(t[1].height for t in r) + 28 + PAD
sheet.save(os.path.join(GEN, "contact-sheet.png"))
print("contact-sheet.png", sheet.size, len(tiles), "tiles")
