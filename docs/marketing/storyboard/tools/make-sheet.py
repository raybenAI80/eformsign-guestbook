"""Build the labelled storyboard contact sheet (4 cols x 2 rows).

Usage: python docs/marketing/storyboard/tools/make-sheet.py [--out PATH]
Reads frames/<id>.png; a missing frame is drawn as a grey placeholder.
Labels come from SCENES below (copied verbatim from demo-video-storyboard.md section 2).
"""
import argparse, hashlib, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # docs/marketing/storyboard
REPO = os.path.abspath(os.path.join(ROOT, "..", "..", ".."))
FONT_DIR = os.path.join(REPO, "promo", "public", "fonts")
FONT_REG = os.path.join(FONT_DIR, "Pretendard-Regular.ttf")
FONT_BOLD = os.path.join(FONT_DIR, "Paperlogy-6SemiBold.ttf")

SCENES = [
    (1, "hook", "0–4", "수기 방명록을 이폼사인으로 바꾸면", "실제 화면은 이렇습니다"),
    (2, "arrive", "4–10", "방문하신 분은", "열려 있는 한 줄만 적습니다"),
    (3, "fill", "10–20", "적고, 체크하고, 서명하면", "끝입니다"),
    (4, "next", "20–28", "다음 분에게는", "앞사람 정보가 보이지 않습니다"),
    (5, "stack", "28–36", "열 명이 써도", "문서는 하루 한 장"),
    (6, "manage", "36–44", "찾고, 열고, 내려받기까지", "이폼사인 문서함에서"),
    (7, "branch", "44–50", "방명록은 시작일 뿐", "계약·동의·접수도 같은 이폼사인"),
    (8, "cta", "50–54", "지금 이폼사인을 체험해 보세요", "www.eformsign.com"),
]

COLS, ROWS = 4, 2
CELL_W, CELL_H = 960, 540          # 16:9 frame slot -> sheet width 4*960 + gutters >= 3840
GUT, MARGIN, LABEL_H = 24, 48, 200
BG, INK, SUB, ACCENT = (250, 250, 248), (30, 30, 30), (90, 90, 90), (30, 111, 217)


def frame_path(num, sid):
    return os.path.join(ROOT, "frames", f"{num:02d}-{sid}.png")


def fit(img):
    """Letterbox into CELL_W x CELL_H keeping aspect."""
    img = img.convert("RGB")
    s = min(CELL_W / img.width, CELL_H / img.height)
    r = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    canvas = Image.new("RGB", (CELL_W, CELL_H), BG)
    canvas.paste(r, ((CELL_W - r.width) // 2, (CELL_H - r.height) // 2))
    return canvas


def placeholder(draw, x, y, font):
    draw.rectangle([x, y, x + CELL_W - 1, y + CELL_H - 1], fill=(225, 225, 222), outline=(160, 160, 160), width=3)
    draw.text((x + CELL_W // 2, y + CELL_H // 2), "미생성", font=font, fill=SUB, anchor="mm")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "storyboard-sheet.png"))
    a = ap.parse_args()
    f_head = ImageFont.truetype(FONT_BOLD, 40)
    f_cap = ImageFont.truetype(FONT_REG, 38)
    W = MARGIN * 2 + COLS * CELL_W + (COLS - 1) * GUT
    H = MARGIN * 2 + ROWS * (CELL_H + LABEL_H) + (ROWS - 1) * GUT
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    report = []
    for i, (num, sid, span, c1, c2) in enumerate(SCENES):
        col, row = i % COLS, i // COLS
        x = MARGIN + col * (CELL_W + GUT)
        y = MARGIN + row * (CELL_H + LABEL_H + GUT)
        p = frame_path(num, sid)
        if os.path.exists(p):
            im = Image.open(p)
            sheet.paste(fit(im), (x, y))
            d.rectangle([x, y, x + CELL_W - 1, y + CELL_H - 1], outline=(150, 150, 150), width=2)
            sha = hashlib.sha256(open(p, "rb").read()).hexdigest()
            report.append(f"{num:02d}-{sid}: {im.width}x{im.height} sha256={sha[:8]}")
        else:
            placeholder(d, x, y, f_cap)
            report.append(f"{num:02d}-{sid}: MISSING")
        ly = y + CELL_H + 18
        d.text((x, ly), f"{num} · {sid} · {span}초", font=f_head, fill=ACCENT)
        d.text((x, ly + 62), c1, font=f_cap, fill=INK)
        d.text((x, ly + 112), c2, font=f_cap, fill=INK)
    sheet.save(a.out)
    shas = [r.split("sha256=")[1] for r in report if "sha256=" in r]
    print(f"sheet {W}x{H} -> {a.out}")
    print("\n".join(report))
    print("duplicate sha256:", "NONE" if len(shas) == len(set(shas)) else "FOUND")


if __name__ == "__main__":
    main()
