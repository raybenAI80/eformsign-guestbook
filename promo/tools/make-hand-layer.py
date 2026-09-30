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
ap.add_argument('--knuckle-zone', default='856,968',
                help='레인 HF: 윗 윤곽(손등 쪽) 재추적 구간(사진 x0,x1). 접힌 가운데·약지 마디가 검지 뒤로 솟는 자리')
ap.add_argument('--knuckle-sigma', type=float, default=3.0, help='레인 HF: 재추적 윤곽 1D 평활 σ(열)')
ap.add_argument('--check', default=None, metavar='HAND_PNG',
                help='레인 H: 컷아웃 경계 품질만 판정(JSON 출력, 불통과 exit 1). 생성은 하지 않는다')
ap.add_argument('--origin', default='783,500', help='--check 용: 컷아웃 원점(prompts.json handLayer.origin)')
ap.add_argument('--tip', default='790,510', help='--check 용: 손끝(prompts.json handLayer.tip) — 스파이크 검사 제외 구역 중심')
A = ap.parse_args()

# 레인 H 판정 한도 — HEAD 684cbc0 컷아웃: 윗선 홈 5px·후광 +14L·베젤 티끌 다수·이음매 반투명 320px
LIMITS = {"topNotchPx": 2.5, "haloL": 6.0, "darkFringePx": 5, "seamPartialPx": 0}


def check_cutout(path, origin, cut_x):
    """손 컷아웃 경계 지표.
    topNotchPx   손 부분 윗 윤곽의 좁은 홈 깊이(1D closing, 창 13px) — 너클을 직선으로 잘라낸 자리
    haloL        가장자리 2px 띠 L 평균 - 안쪽 4~6px 띠 L 평균(배경 섞인 밝은 테두리)
    darkFringePx 가장자리 띠의 L<90 화소(베젤 잔여 티끌)
    seamPartialPx 안쪽(가장자리에서 4px 이상)인데 반투명(8<α<247)인 화소(소매 절단 이음매)
    """
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    al = im[:, :, 3].astype(np.float32) / 255
    hand_w = max(1, cut_x - origin[0] - 60)  # 손 부분(소매 연장 앞 60px 까지)
    L = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2LAB)[:, :, 0].astype(np.float32)
    # 윗선 홈
    op = al[:, :hand_w] > 0.5
    has = op.any(0)
    top = np.where(has, op.argmax(0), -1).astype(np.float32)
    t = -top
    t[~has] = -1e4
    r = 6
    pad = np.pad(t, r, mode='edge')
    dil = np.array([pad[i:i + 2 * r + 1].max() for i in range(len(t))])
    pad2 = np.pad(dil, r, mode='edge')
    clo = np.array([pad2[i:i + 2 * r + 1].min() for i in range(len(t))])
    depth = np.where(has, clo - t, 0)
    depth[:r] = 0; depth[-r:] = 0
    nx = int(np.argmax(depth))
    # 후광·티끌·이음매
    transp = (al < 0.08).astype(np.uint8)
    dt = cv2.distanceTransform(1 - transp, cv2.DIST_L2, 3)
    xs = np.arange(al.shape[1])[None, :].repeat(al.shape[0], 0)
    part = xs < hand_w
    edge = (dt <= 2) & (al >= 0.25) & part
    inner = (dt >= 4) & (dt <= 6) & part
    halo = float(L[edge].mean() - L[inner].mean()) if edge.any() and inner.any() else 0.0
    # 티끌은 피부 가장자리에서만 센다(소매 뜨개는 원래 어둡다) — 안쪽 화소의 채도(a+b)로 피부 구역 판별
    lab = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2LAB).astype(np.float32)
    chroma = (lab[:, :, 1] - 128) + (lab[:, :, 2] - 128)
    core = (dt >= 4).astype(np.float32)
    skin = cv2.GaussianBlur(chroma * core, (0, 0), 4) / np.maximum(cv2.GaussianBlur(core, (0, 0), 4), 1e-3) > 15
    dark = int(((L < 90) & edge & skin).sum())
    a8 = im[:, :, 3]
    seam = int(((a8 > 8) & (a8 < 247) & (dt >= 4)).sum())
    res = {
        "file": path,
        "topNotchPx": round(float(depth.max()), 2),
        "topNotchAtPhotoX": int(origin[0] + nx),
        "haloL": round(halo, 2),
        "darkFringePx": dark,
        "seamPartialPx": seam,
        "limits": LIMITS,
    }
    bad = [k for k in LIMITS if res[k] > LIMITS[k]]
    # 레인 HF — 윗 윤곽(손등 쪽) 스파이크: 접힌 마디가 삼각형으로 솟으면 불통과 (tools/silhouette_spikes.py)
    import os, sys as _sys
    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import silhouette_spikes as _ss
    sp = _ss.check(path, origin, (origin[0] + 7, origin[1] + 10) if A.tip is None else tuple(map(int, A.tip.split(','))), cut_x)
    res["silhouetteMinDeg"] = sp["minInteriorDeg"]
    res["silhouetteSpikes"] = sp["spikes"]
    res["silhouetteLimitDeg"] = sp["limitDeg"]
    if not sp["pass"]:
        bad.append("silhouetteMinDeg")
    res["pass"] = not bad
    res["fail"] = bad
    return res


if A.check:
    ox_, oy_ = map(int, A.origin.split(','))
    r_ = check_cutout(A.check, (ox_, oy_), A.cut_x)
    print(json.dumps(r_, ensure_ascii=False))
    raise SystemExit(0 if r_["pass"] else 1)

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

# 4-1) 레인 H(2026-09-30) — 컷아웃 경계 정리. 🔴 바탕(plate)은 위에서 기존 m 로 이미 썼다(바이트 불변),
#      여기서는 손 층 알파·가장자리 색만 고친다. 사용자 지적: 너클이 직선으로 잘리고 테두리가 하얗게 뜬다.
L0 = cv2.cvtColor(a, cv2.COLOR_BGR2LAB)[:, :, 0]
mh = m.copy()
# a) 베젤 잔여 어두운 티끌: 가장자리 2px 띠에서 L<90 제거(피부·소매 가장자리는 이렇게 어둡지 않다)
band = (mh > 0) & (cv2.distanceTransform(mh, cv2.DIST_L2, 3) <= 2)
mh[band & (L0 < 90)] = 0
# b) 윗선 너클 홈 메우기: 손 부분 윗 윤곽의 좁은 홈(폭<15)을 닫되, 각 열의 맨 윗 화소보다 위쪽만 더한다
k15 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
cl = cv2.morphologyEx(mh, cv2.MORPH_CLOSE, k15)
has = mh.any(0)
topy = np.where(has, mh.argmax(0), H)
yy = np.arange(H)[:, None].repeat(W, 1)
xx2 = np.arange(W)[None, :].repeat(H, 0)
add = (cl > 0) & (mh == 0) & (yy < topy[None, :]) & (xx2 < A.cut_x - 60)
mh[add] = 1
# b2) 레인 HF(2026-09-30) — 접힌 마디 윗 윤곽 재추적. 사용자 지적: 검지 뒤로 솟는 접힌 가운데·약지 마디가
#     둥근 돔이 아니라 뾰족한 삼각 스파이크(왼쪽 절벽 + 반경 ~4px 꼭짓점). 원인 = 마디 왼쪽의 밝은 역광 테두리
#     (L 218~229, 채도 ≈5 — 배경 베이지와 구별 안 됨)를 GrabCut 이 배경으로 버려 홈 → 절벽 → 꼭짓점이 생겼다.
#     사진 근거 윤곽 = 「바탕 변형본과 다르거나(d>12) 피부 채도(a+b>12)」인 첫 화소(열마다, 기존 윗선 −10~+8 안).
#     그 윤곽을 열 방향 σ 로 평활해(돔) 구간 끝 8열은 기존 윗선과 섞는다. 🔴 GrabCut 재추출 아님(두 번 실패).
kx0, kx1 = map(int, A.knuckle_zone.split(','))
chk = (la[:, :, 1] - 128) + (la[:, :, 2] - 128)
ev = []
for X in range(kx0, kx1 + 1):
    t0 = int(np.argmax(mh[:, X] > 0))
    y = max(0, t0 - 10)
    while y < t0 + 8 and not (d[y, X] > 12 or chk[y, X] > 12):
        y += 1
    ev.append((t0, y))
ev = np.array(ev, np.float64)
old_t, ev_t = ev[:, 0], ev[:, 1]
rk = int(3 * A.knuckle_sigma)
ker = np.exp(-0.5 * (np.arange(-rk, rk + 1) / A.knuckle_sigma) ** 2); ker /= ker.sum()
sm_t = np.convolve(np.pad(ev_t, rk, mode='edge'), ker, mode='valid')
nz = len(sm_t); ramp = np.clip(np.minimum(np.arange(nz), np.arange(nz)[::-1]) / 8.0, 0, 1)
new_t = old_t * (1 - ramp) + sm_t * ramp
for i, X in enumerate(range(kx0, kx1 + 1)):
    tn = int(round(new_t[i])); to = int(old_t[i])
    mh[:tn, X] = 0
    if tn < to:
        mh[tn:to, X] = 1
knuckle_trace = {"zone": [kx0, kx1], "oldTop": old_t.astype(int).tolist(), "evidenceTop": ev_t.astype(int).tolist(),
                 "newTop": np.round(new_t, 1).tolist()}
# c) 윤곽 매끈하게(계단 제거) → 가장 큰 덩어리·구멍 메우기
mh = (cv2.GaussianBlur(mh.astype(np.float32), (0, 0), 1.2) > 0.5).astype(np.uint8)
mh = fill(biggest(mh))
mh[:, A.cut_x:] = 0
# d) 알파 = 안쪽 거리 기반 램프(가장자리 1px 을 옅게 → 후광 띠 제거, 1.5px 페더).
#    🔴 소매 절단선은 오른쪽으로 이어지는 면이다 → 거리 계산 때 절단선 오른쪽을 복제해 이음매가 반투명해지지 않게
mext = mh.copy()
mext[:, A.cut_x:A.cut_x + 40] = mh[:, A.cut_x - 1:A.cut_x]
din = cv2.distanceTransform(mext, cv2.DIST_L2, 5)
alpha = cv2.GaussianBlur(np.clip((din - 0.6) / 1.5, 0, 1).astype(np.float32), (0, 0), 0.7)  # 계단 완화
alpha[:, A.cut_x:] = 0
# e) 색 오염 제거(defringe): 가장자리 3px 안쪽 화소 색을 안쪽(≥3px) 화소의 정규화 흐림 색으로 당긴다
core = (din >= 3).astype(np.float32)
num = cv2.GaussianBlur(a.astype(np.float32) * core[..., None], (0, 0), 2.0)
den = cv2.GaussianBlur(core, (0, 0), 2.0)[..., None]
inside = np.where(den > 1e-3, num / np.maximum(den, 1e-3), a.astype(np.float32))
wdf = np.clip((3.0 - din) / 2.0, 0, 1)[..., None] * (mh[..., None] > 0)
a_h = (a.astype(np.float32) * (1 - wdf) + inside * wdf).round().clip(0, 255).astype(np.uint8)

# 5) 손 컷아웃 + 소매 연장(거울 반복)
#    (bbox·손끝은 기존 m 기준 — prompts.json handLayer 원점·크기·손끝 불변)
ys, xs = np.nonzero(m)
bx0, by0, bx1, by1 = xs.min() - 4, ys.min() - 4, A.cut_x, ys.max() + 4
rgba = np.dstack([a_h[by0:by1, bx0:bx1],(alpha[by0:by1, bx0:bx1] * 255).round().astype(np.uint8)])
blk = 60
# 소매 위·아래 경계의 기울기(절단면 앞 80px 에서 측정) — 연장부가 팔 방향으로 이어지게
def band(col):
    yy = np.nonzero(col > 128)[0]
    return (yy.min(), yy.max()) if len(yy) else (0, 0)
# 기울기는 레인 V 의 알파(기존 m 의 0.8px 흐림)로 잰다 — 연장부 기하·컷아웃 크기(prompts.json size) 불변
alpha_v = (cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.8)[by0:by1, bx0:bx1] * 255).round()
t0, b0_ = band(alpha_v[:, -80]); t1, b1 = band(alpha_v[:, -1])
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
    json.dump(knuckle_trace, open(A.debug.rsplit('.', 1)[0] + '-knuckle.json', 'w'))
if A.debug:
    e = cv2.Canny(m * 255, 50, 150) > 0; v = a.copy(); v[e] = (0, 255, 0)
    cv2.imwrite(A.debug, v[420:880, 700:1400])
print(json.dumps(info))
