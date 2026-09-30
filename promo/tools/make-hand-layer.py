"""레인 V(2026-09-30) — Fill·Repeat 공용 바탕(손 없음)과 손 컷아웃을 만든다.

입력
  public/gen/gen-03.png                       원본(손 있음)
  public/gen/cand/gen-03-nohand-a.png         gpt-image 「같은 구도·손 없음」 변형(1672x941, gitignore)
  --coarse <png>                              Canva remove-background 결과(저해상 알파, 선택)
출력
  public/gen/gen-03-plate.png                 바탕 = gen-03 에서 손·소매 영역만 변형본으로 교체
                                              (마스크 밖 화소는 gen-03 과 바이트 동일 → screenQuad 불변)
  public/gen/hand-03.png                      손+소매 RGBA 컷아웃(소매는 오른쪽으로 연장)
  stdout JSON                                 prompts.json scene3.handLayer 에 넣을 좌표

🔴 함정
  - 차분 키잉만으로는 손등이 배경(베이지 카운터)과 비슷해 빠진다 → 저해상 AI 알파를 GrabCut 사전으로.
  - AI 알파는 태블릿까지 「피사체」로 잡는다 → 변형본과 같은 화소(d<10)이고 어두운(L<95) 베젤은 제외.
  - 몸통(오른쪽 x≥1290)은 잘라 내고 소매를 거울 반복으로 연장한다(화면 밖으로 이어지게).
"""
import argparse, json
import numpy as np, cv2

ap = argparse.ArgumentParser()
ap.add_argument('--src', default='public/gen/gen-03.png')
ap.add_argument('--nohand', default='public/gen/cand/gen-03-nohand-a.png')
ap.add_argument('--coarse', default=None)
ap.add_argument('--coarse-box', default='740,440,1340,860')
ap.add_argument('--cut-x', type=int, default=1245)
ap.add_argument('--extend', type=int, default=420)
ap.add_argument('--plate-out', default='public/gen/gen-03-plate.png')
ap.add_argument('--hand-out', default='public/gen/hand-03.png')
ap.add_argument('--debug', default=None)
A = ap.parse_args()

a = cv2.imread(A.src)
H, W = a.shape[:2]
b0 = cv2.imread(A.nohand)
b = cv2.resize(b0, (W, H), interpolation=cv2.INTER_LANCZOS4)
la = cv2.cvtColor(cv2.GaussianBlur(a, (3, 3), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
lb = cv2.cvtColor(cv2.GaussianBlur(b, (3, 3), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
d = np.sqrt(((la - lb) ** 2).sum(2))
L = la[:, :, 0]

# 1) 차분 키잉 씨앗
roi = np.zeros(d.shape, bool); roi[430:860, 740:A.cut_x + 40] = True
seed = ((d > 28) & roi).astype(np.uint8)
seed = cv2.morphologyEx(seed, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(seed)
seed = (lab == 1 + np.argmax(st[1:, 4])).astype(np.uint8)
seed = cv2.morphologyEx(seed, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))

# 2) 저해상 AI 알파(있으면) → GrabCut 사전
x0, y0, x1, y1 = map(int, A.coarse_box.split(','))
cm = np.zeros(d.shape, np.uint8)
if A.coarse:
    al = cv2.imread(A.coarse, cv2.IMREAD_UNCHANGED)[:, :, 3]
    cm[y0:y1, x0:x1] = (cv2.resize(al, (x1 - x0, y1 - y0)) > 127).astype(np.uint8)
else:
    cm = cv2.dilate(seed, np.ones((25, 25), np.uint8))
gc = np.full(d.shape, cv2.GC_BGD, np.uint8)
gc[cv2.dilate(cm, np.ones((15, 15), np.uint8)) > 0] = cv2.GC_PR_BGD
gc[(cm > 0) & (d >= 6)] = cv2.GC_PR_FGD
gc[(cv2.erode(cm, np.ones((13, 13), np.uint8)) > 0) & (d >= 6)] = cv2.GC_FGD
gc[cv2.erode(seed, np.ones((5, 5), np.uint8)) > 0] = cv2.GC_FGD
gc[:, :780] = cv2.GC_BGD
bg = np.zeros((1, 65)); fg = np.zeros((1, 65))
cv2.setRNGSeed(7)
cv2.grabCut(a, gc, None, bg, fg, 8, cv2.GC_INIT_WITH_MASK)
m = ((gc == 1) | (gc == 3)).astype(np.uint8)

def biggest(x):
    n, lab, st, _ = cv2.connectedComponentsWithStats(x)
    return (lab == 1 + np.argmax(st[1:, 4])).astype(np.uint8)

def fill(x):
    ff = x.copy(); mk = np.zeros((x.shape[0] + 2, x.shape[1] + 2), np.uint8)
    cv2.floodFill(ff, mk, (0, 0), 1); return x | (1 - ff)

m = fill(cv2.morphologyEx(biggest(m), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)))
# 3) 태블릿 베젤·옆면 제외, 몸통 절단
m = m.astype(bool) & ~((L < 95) & (d < 12))
reg = np.zeros_like(m); reg[480:720, 770:900] = True
m &= ~(reg & (d < 10))
m[:, A.cut_x:] = False
xx = np.arange(W)[None, :].repeat(H, 0)
m &= ~((L < 70) & (xx < 840))  # 베젤 티끌(피부는 이렇게 어둡지 않다)
m = m.astype(np.uint8)
k5 = np.ones((5, 5), np.uint8)
opened = cv2.morphologyEx(m, cv2.MORPH_OPEN, k5)
m = np.where(reg, opened, m).astype(np.uint8)
m = fill(biggest(cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))))

# 4) 바탕: 손 영역(넉넉히)만 변형본으로, 가장자리 페더
rep = cv2.dilate(np.maximum(m, seed), np.ones((25, 25), np.uint8)).astype(np.float32)
rep[:, A.cut_x - 10:] = np.maximum(rep[:, A.cut_x - 10:], cv2.dilate(seed, np.ones((25, 25), np.uint8))[:, A.cut_x - 10:])
rep = cv2.GaussianBlur(rep, (0, 0), 5)
rep[rep < 0.02] = 0  # 먼 곳은 원본 화소 그대로(바이트 동일)
plate = (a * (1 - rep[..., None]) + b * rep[..., None]).round().astype(np.uint8)
plate[rep == 0] = a[rep == 0]
cv2.imwrite(A.plate_out, plate)

# 5) 손 컷아웃 + 소매 연장(거울 반복)
alpha = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.8)
ys, xs = np.nonzero(m)
bx0, by0, bx1, by1 = xs.min() - 4, ys.min() - 4, A.cut_x, ys.max() + 4
rgba = np.dstack([a[by0:by1, bx0:bx1], (alpha[by0:by1, bx0:bx1] * 255).round().astype(np.uint8)])
blk = 60
# 소매 위·아래 경계의 기울기(절단면 앞 80px 에서 측정) — 연장부가 팔 방향으로 이어지게
def band(col):
    yy = np.nonzero(col > 128)[0]
    return (yy.min(), yy.max()) if len(yy) else (0, 0)
t0, b0_ = band(rgba[:, -80, 3]); t1, b1 = band(rgba[:, -1, 3])
slope = ((t1 - t0) + (b1 - b0_)) / 2 / 79.0
hh = rgba.shape[0] + int(abs(slope) * A.extend) + 2
rgba = np.concatenate([rgba, np.zeros((hh - rgba.shape[0],) + rgba.shape[1:], np.uint8)], 0)
last = rgba[:, -1:].copy(); last[:, :, 3] = np.where(last[:, :, 3] > 128, 255, 0)
last[:, :, 3] = cv2.erode(last[:, :, 3], np.ones((5, 1), np.uint8))  # 위·아래 밝은 테두리 제거
cols = []
for j in range(A.extend):
    # 🔴 거울 반복은 대칭 무늬가 눈에 띈다 → 마지막 blk 열을 가로로 늘린다(천 결이 결 방향으로 번진다)
    k = int(blk - 1 - (j * blk) // A.extend)
    c = rgba[:, -1 - k].copy()
    c[:, 3] = last[:, 0, 3]
    c = np.roll(c, int(round(slope * (j + 1))), axis=0)
    cols.append(c[:, None])
ext = np.concatenate(cols, 1)
ext[:, :, :3] = cv2.GaussianBlur(ext[:, :, :3], (0, 0), sigmaX=4, sigmaY=1.2)  # 늘인 결을 누그러뜨린다
out = np.concatenate([rgba, ext], 1)
cv2.imwrite(A.hand_out, out)
# 손끝 = 가장 왼쪽 화소들의 세로 중앙
xm = xs.min(); tipy = int(np.median(ys[xs <= xm + 2]))
info = {
    "file": A.hand_out.split('public/gen/')[-1],
    "origin": [int(bx0), int(by0)],
    "size": [int(out.shape[1]), int(out.shape[0])],
    "tip": [int(xm + 3), tipy],
    "handPixels": int(m.sum()),
    "plate": A.plate_out.split('public/gen/')[-1],
}
if A.debug:
    e = cv2.Canny(m * 255, 50, 150) > 0; v = a.copy(); v[e] = (0, 255, 0)
    cv2.imwrite(A.debug, v[420:880, 700:1400])
print(json.dumps(info))
