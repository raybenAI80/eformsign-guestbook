#!/usr/bin/env python
"""방명록 펼침면(종이 지면)의 4점 좌표를 화소 스캔으로 측정한다.

왜 있나: 육안 격자 추정은 과거 120px 틀렸다. 지면은 "밝고 무채색이며 평탄한"
연결 성분이므로 기계로 뽑는다. 산출은 JSON(화면 좌표 tl,tr,br,bl) + 오버레이 PNG.

  python tools/book-quad.py public/gen/gen-01.png --roi 0,700,900,1080 --out .gen-work/bq-01.png
"""
import sys, json, argparse
import numpy as np, cv2
from PIL import Image
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument("image")
ap.add_argument("--roi", default=None, help="x0,y0,x1,y1")
ap.add_argument("--out", default=None, help="오버레이 PNG 경로")
ap.add_argument("--minval", type=int, default=170)
ap.add_argument("--maxsat", type=int, default=30)
ap.add_argument("--components", type=int, default=1,
                help="상위 N개 연결성분을 합쳐 한 지면으로 본다. 펼침면의 좌·우 페이지가 밝기 차로 "
                     "갈라지는데 임계값을 낮추면 카운터가 번지는 경우 2 를 쓴다(2026-09-18 gen-01 3차).")
a = ap.parse_args()

im = Image.open(a.image).convert("RGB")
W, H = im.size
arr = np.asarray(im).astype(np.int16)
mx, mn = arr.max(2), arr.min(2)
mask = (mx - mn <= a.maxsat) & (mx >= a.minval)
g = np.asarray(im.convert("L")).astype(np.float32)
var = ndimage.uniform_filter(g * g, 9) - ndimage.uniform_filter(g, 9) ** 2
mask &= var < 60                      # 지면은 평탄하다
if a.roi:
    x0, y0, x1, y1 = [int(v) for v in a.roi.split(",")]
    r = np.zeros_like(mask); r[y0:y1, x0:x1] = True; mask &= r
mask = ndimage.binary_opening(mask, np.ones((7, 7)))
mask = ndimage.binary_closing(mask, np.ones((15, 15)))
lab, n = ndimage.label(mask)
assert n, "지면 후보 없음"
sizes = ndimage.sum(mask, lab, range(1, n + 1))
keep = [int(i) + 1 for i in np.argsort(sizes)[::-1][:max(1, a.components)]]
comp = np.isin(lab, keep).astype(np.uint8)

cnts = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]
hull = cv2.convexHull(np.vstack(cnts))          # 여러 성분이면 전체를 감싸는 외곽
quad = None
for eps in np.arange(0.005, 0.12, 0.002):            # 4점이 될 때까지 완화
    ap_ = cv2.approxPolyDP(hull, eps * cv2.arcLength(hull, True), True)
    if len(ap_) == 4:
        quad = ap_.reshape(4, 2).astype(float); break
if quad is None:                                      # 최소외접 회전사각형으로 후퇴
    quad = cv2.boxPoints(cv2.minAreaRect(hull)).astype(float)

# 기울기가 큰 지면은 (x+y)/(x-y) 극값이 겹쳐 퇴화한다 -> 무게중심 기준 각도 정렬
c = quad.mean(0)
ang = np.arctan2(quad[:, 1] - c[1], quad[:, 0] - c[0])
quad = quad[np.argsort(ang)]                      # 화면좌표계에서 시계방향
start = int(np.argmin(quad.sum(1)))               # 좌상단에 가장 가까운 점부터
quad = np.roll(quad, -start, axis=0)
pts = [[int(round(p[0])), int(round(p[1]))] for p in quad]  # tl,tr,br,bl
res = dict(image=a.image, size=[W, H], area=int(comp.sum()),
           widthRatio=round((max(p[0] for p in pts) - min(p[0] for p in pts)) / W, 3),
           order="tl,tr,br,bl", points=pts, measure="pixel-scan(low-sat flat bright component + convex hull approx)")
print(json.dumps(res, indent=1))
if a.out:
    ov = np.asarray(im).copy()
    cv2.polylines(ov, [np.array(pts)], True, (255, 0, 0), 4)
    for i, p in enumerate(pts):
        cv2.circle(ov, tuple(p), 9, (255, 0, 0), -1)
        cv2.putText(ov, "tl tr br bl".split()[i], (p[0] + 12, p[1] - 8), 0, 1.0, (255, 0, 0), 3)
    Image.fromarray(ov).save(a.out)
