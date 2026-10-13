"""Build hand.png for the bridge-opus scene: hands + pen + cuffs of gen-01.png only.
Model alpha (hyperframes remove-background, u2net_human_seg) is low-res and blobby, so it is used
only as a prior; GrabCut (OpenCV) refines edges inside two hand regions, with paper/wood/sweater
seeded as background. Output: RGBA 1920x1080, same pixel grid as gen-01.png (drop-in layer).
Usage: python bridge-hand-matte.py <gen-01.png> <person-alpha.png> <out hand.png> [<out check dir>]
"""
import sys, numpy as np, cv2
from PIL import Image

src, person, out = sys.argv[1:4]
chk = sys.argv[4] if len(sys.argv) > 4 else None
img = np.array(Image.open(src).convert("RGB"))
alpha = np.array(Image.open(person).getchannel("A")).astype(np.float32) / 255
H, W = alpha.shape

# hand regions (photo px): x0, y0, x1, y1 — top edge = straight cuff/sleeve clip
REGIONS = [(572, 655, 752, 836), (858, 690, 1084, 806)]
# background seeds that the person-model wrongly includes (table wood, sweater between hands)
BG_RECTS = [(572, 782, 632, 836), (752, 746, 872, 772), (1044, 752, 1084, 774), (752, 655, 862, 742)]

region = np.zeros((H, W), bool)
for x0, y0, x1, y1 in REGIONS:
    region[y0:y1, x0:x1] = True

r, g, b = [img[..., i].astype(int) for i in range(3)]
mn, mx = np.minimum(np.minimum(r, g), b), np.maximum(np.maximum(r, g), b)
yy, xx = np.mgrid[0:H, 0:W]
paper = (mn > 165) & ((mx - mn) < 30)                     # notebook page incl. soft shadow
dark = (mx < 100) & (xx > 840) & (xx < 1000)                             # sweater/pants + finger-gap shadow (left hand only; the pen is dark)
sleeve = ((mx - mn) < 22) & (mx > 80) & (mx < 170) & (xx < 760) & (yy < 780)  # grey cuff fabric (right arm)
wood = (r < 165) & (b < 105) & (yy > 745) & (xx > 840)    # table wood visible under the left fingers

gc = np.full((H, W), cv2.GC_BGD, np.uint8)
gc[region] = cv2.GC_PR_BGD
gc[region & (alpha > 0.5)] = cv2.GC_PR_FGD
core = cv2.erode(((alpha > 0.9) & region).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
core &= ~dark
gc[core | (region & sleeve)] = cv2.GC_FGD                # model core + right cuff win (keeps knuckle highlights)
gc[region & (paper | dark | wood) & ~core & ~sleeve] = cv2.GC_BGD
for x0, y0, x1, y1 in BG_RECTS:
    gc[y0:y1, x0:x1] = cv2.GC_BGD

# run on a padded crop only
ys, xs = np.where(region)
cy0, cy1, cx0, cx1 = ys.min() - 20, ys.max() + 20, xs.min() - 20, xs.max() + 20
sub = gc[cy0:cy1, cx0:cx1].copy()
bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
cv2.grabCut(np.ascontiguousarray(img[cy0:cy1, cx0:cx1][..., ::-1]), sub, None, bgd, fgd, 8, cv2.GC_INIT_WITH_MASK)
fg = np.zeros((H, W), np.uint8)
fg[cy0:cy1, cx0:cx1] = np.isin(sub, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.uint8)
fg &= region.astype(np.uint8)
# keep components that touch the core (drop specks), close pinholes
fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
n, lab = cv2.connectedComponents(fg)
keep = set(np.unique(lab[core & (fg > 0)])) - {0}
fg = np.isin(lab, list(keep)).astype(np.uint8)
fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(fg)
fg = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 400]).astype(np.float32)
# 1.5 px feather
a = cv2.GaussianBlur(fg, (0, 0), 1.0)
a[~region] = 0
outimg = np.dstack([img, (a * 255).round().astype(np.uint8)])
Image.fromarray(outimg, "RGBA").save(out)
print("hand px", int((a > 0.5).sum()))

if chk:
    o = Image.fromarray(img)
    hand = Image.fromarray(outimg, "RGBA")
    for name, col in (("magenta", (255, 0, 255)), ("dark", (20, 24, 40)), ("white", (255, 255, 255))):
        plate = Image.new("RGB", (W, H), col)
        plate.paste(hand, (0, 0), hand)
        for i, (x0, y0, x1, y1) in enumerate(REGIONS):
            c = plate.crop((x0 - 10, y0 - 10, x1 + 10, y1 + 10))
            c.resize((c.width * 2, c.height * 2), Image.LANCZOS).save(f"{chk}/check-{name}-r{i}.png")
    # composite over original (should be identical where alpha>0) + over a white "table" quad
    t = o.copy()
    quad = np.array([[615, 786], [1242, 805], [1247, 965], [505, 922]], np.int32)
    tt = np.array(t); cv2.fillPoly(tt, [quad - [0, 60]], (250, 250, 252)); t = Image.fromarray(tt)
    t.paste(hand, (0, 0), hand)
    c = t.crop((560, 640, 1100, 850)); c.resize((c.width * 2, c.height * 2), Image.LANCZOS).save(f"{chk}/check-overtable.png")
