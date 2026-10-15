"""v5.1 생성 이미지(gen-07·gen-08) 후보 비교 시트와 인물 일관성 200% 크롭 시트를 만든다.

실행: python promo/tools/gen-v51-sheets.py  (작업 루트 = promo/)
출력: out/gen/v51-candidates-sheet.png, out/gen/v51-consistency-sheet.png, out/gen/v51-gen01-pen-crop.png
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "public" / "gen"
OUT = ROOT / "out" / "gen"
FONT = ImageFont.truetype("C:/Windows/Fonts/malgunbd.ttf", 26)
SMALL = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 20)
BG = (24, 24, 24)
FG = (240, 240, 240)


def label(img, text, font=FONT):
    """Return a copy with a dark label bar on top."""
    bar = 44
    out = Image.new("RGB", (img.width, img.height + bar), BG)
    out.paste(img, (0, bar))
    ImageDraw.Draw(out).text((10, 6), text, fill=FG, font=font)
    return out


def grid(rows, gap=12):
    """rows = list[list[Image]] -> one sheet."""
    width = max(sum(i.width for i in r) + gap * (len(r) + 1) for r in rows)
    height = sum(max(i.height for i in r) for r in rows) + gap * (len(rows) + 1)
    sheet = Image.new("RGB", (width, height), BG)
    y = gap
    for r in rows:
        x = gap
        for i in r:
            sheet.paste(i, (x, y))
            x += i.width + gap
        y += max(i.height for i in r) + gap
    return sheet


def thumb(path, w=640):
    im = Image.open(path).convert("RGB")
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


def candidates():
    rows = [
        [label(thumb(GEN / "gen-02.png"), "참조 gen-02 (기존·밤)")]
        + [label(thumb(OUT / f"gen-08-night-copy-c{n}.png"), f"gen-08 c{n}") for n in (1, 2, 3)],
        [label(thumb(GEN / "gen-06.png"), "참조 gen-06 (기존·낮)")]
        + [label(thumb(OUT / f"gen-07-empty-desk-c{n}.png"), f"gen-07 c{n}") for n in (1, 2, 3)],
    ]
    grid(rows).save(OUT / "v51-candidates-sheet.png")


# 200% crop regions (x0, y0, x1, y1) in each file's own pixel space.
CROPS = [
    ("gen-06 머리", GEN / "gen-06.png", (0, 0, 500, 420)),
    ("gen-06 손", GEN / "gen-06.png", (800, 770, 1000, 900)),
    ("gen-02 머리", GEN / "gen-02.png", (320, 40, 720, 450)),
    ("gen-02 손", GEN / "gen-02.png", (950, 760, 1160, 880)),
    ("07-c1 머리", OUT / "gen-07-empty-desk-c1.png", (0, 0, 450, 360)),
    ("07-c1 손(덮개)", OUT / "gen-07-empty-desk-c1.png", (600, 490, 820, 620)),
    ("07-c1 손(컵)", OUT / "gen-07-empty-desk-c1.png", (1110, 520, 1300, 720)),
    ("07-c2 머리", OUT / "gen-07-empty-desk-c2.png", (40, 10, 460, 400)),
    ("07-c2 손(컵)", OUT / "gen-07-empty-desk-c2.png", (480, 410, 740, 580)),
    ("07-c3 머리", OUT / "gen-07-empty-desk-c3.png", (170, 20, 520, 360)),
    ("07-c3 손(컵)", OUT / "gen-07-empty-desk-c3.png", (430, 360, 620, 490)),
    ("07-c3 손(덮개)", OUT / "gen-07-empty-desk-c3.png", (760, 580, 940, 720)),
    ("08-c1 왼손", OUT / "gen-08-night-copy-c1.png", (470, 430, 720, 580)),
    ("08-c1 오른손", OUT / "gen-08-night-copy-c1.png", (1280, 680, 1600, 900)),
    ("08-c1 칸·필기", OUT / "gen-08-night-copy-c1.png", (1000, 400, 1400, 620)),
    ("08-c2 왼손", OUT / "gen-08-night-copy-c2.png", (60, 410, 380, 760)),
    ("08-c2 오른손", OUT / "gen-08-night-copy-c2.png", (1290, 380, 1600, 760)),
    ("08-c3 펜손", OUT / "gen-08-night-copy-c3.png", (260, 290, 480, 620)),
    ("08-c3 칸·필기", OUT / "gen-08-night-copy-c3.png", (760, 520, 1200, 740)),
]


def consistency(per_row=4, max_w=760):
    tiles = []
    for name, path, box in CROPS:
        im = Image.open(path).convert("RGB").crop(box)
        im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)  # 200%
        if im.width > max_w:  # keep sheet manageable; label notes the scale
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        tiles.append(label(im, name, SMALL))
    rows = [tiles[i:i + per_row] for i in range(0, len(tiles), per_row)]
    grid(rows).save(OUT / "v51-consistency-sheet.png")


def gen01_pen():
    """hook 랙 포커스 판정용: gen-01 펜 끝 영역을 2배·3배 확대해 1920 폭으로 본다."""
    im = Image.open(GEN / "gen-01.png").convert("RGB")
    cx, cy = 712, 760  # pen tip
    out = []
    for zoom in (2, 3):
        w, h = 1920 // zoom, 1080 // zoom
        box = (cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)
        crop = im.crop(box).resize((960, 540), Image.LANCZOS)
        out.append(label(crop, f"gen-01 펜 끝 {zoom}배 확대 (원본 {w}x{h} 영역)"))
    grid([out]).save(OUT / "v51-gen01-pen-crop.png")


if __name__ == "__main__":
    candidates()
    consistency()
    gen01_pen()
    print("ok")
