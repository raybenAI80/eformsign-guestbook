"""레인 HS(2026-09-30) — 손 그림자 직선 끊김 판정 자료. 본편 1920 원본 프레임에서 200% 크롭, 왼쪽 v3.5 · 오른쪽 v3.5.1.

  python tools/v35hs-judge.py <v3.5 본편 mp4> <v3.5.1 본편 mp4> <출력 디렉터리> [motion.json]

motion.json = check-hand-motion.mjs 가 쓴 out/check/v33v-motion.json 의 shadowEdge
  (crossQuadFrames = 옛 격자 변 그림자가 화면 사각형 경계에 걸친 프레임 · render.summary 는 참고).
산출: v35hs-cross-fNNNN-vs-crop200.png — 경계에 걸친 프레임 전부 + 935 + extra 프레임(인자 --extra 1,2,3)
      v35hs-cross-index.txt — 파일 목록과 프레임 출처
크롭 중심 = 게이트가 쓴 out/check/v35hs-shadow-edge.json 의 그 프레임 「옛 격자 변 그림자 투영점」 중앙값(= v3.5 에서 직선이 생기던 자리).
      없으면 두 영상 차 최대 덩어리 중심.
"""
import sys, os, json
import numpy as np, cv2

old_v, new_v, out = sys.argv[1:4]
rest = sys.argv[4:]
mj = rest[0] if rest and not rest[0].startswith('--') else 'out/check/v33v-motion.json'
extra = []
if '--extra' in rest: extra = [int(x) for x in rest[rest.index('--extra') + 1].split(',') if x]
os.makedirs(out, exist_ok=True)
S = json.load(open(mj, encoding='utf-8'))['shadowEdge']
cross = sorted({f for v in S['crossQuadFrames'].values() for f in v['main60']})
want = sorted(set(cross) | {935} | set(extra))


def frames(path, want):
    cap = cv2.VideoCapture(path); i = 0; got = {}; ws = set(want)
    while True:
        ok, fr = cap.read()
        if not ok or i > max(want): break
        if i in ws: got[i] = fr
        i += 1
    return got


A = frames(old_v, want); B = frames(new_v, want)


EDGE = {}
ef = os.path.join(os.path.dirname(mj), 'v35hs-shadow-edge.json')
if os.path.exists(ef):
    for it in json.load(open(ef, encoding='utf-8')):
        P = [q for q in it['pts'] if q[0] > -1e3]
        if P: EDGE[it['main60']] = (int(np.median([q[0] for q in P])), int(np.median([q[1] for q in P])))


def diff_center(f):
    d = np.abs(cv2.GaussianBlur(A[f], (0, 0), 1.5).astype(int) - cv2.GaussianBlur(B[f], (0, 0), 1.5)).max(2)
    d[:, 1114:] = 0
    n, _, st, cen = cv2.connectedComponentsWithStats((d > 12).astype(np.uint8))
    return tuple(int(v) for v in cen[1 + int(np.argmax(st[1:, 4]))]) if n > 1 else None


def tip_of(fr):
    L = fr[:, :1114].astype(np.int16); b, g, r = L[..., 0], L[..., 1], L[..., 2]
    m = ((r > 150) & (r - b > 28) & (r > g) & (g > b) & (r - g < 60)).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    if n < 2 or st[1:, 4].max() < 1500: return None
    k = 1 + np.argmax(st[1:, 4]); ys, xs = np.nonzero(lab == k)
    j = np.argmin(xs); return int(xs[j]), int(ys[j])


def crop(fr, c, w=420, h=280):
    x0 = int(min(max(0, c[0] - w // 2), 1114 - w)); y0 = int(min(max(0, c[1] - h // 2), 1080 - h))
    return cv2.resize(fr[y0:y0 + h, x0:x0 + w], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)


def lab(img, t):
    cv2.putText(img, t, (10, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2); return img


idx = []
for f in want:
    if f not in A or f not in B: continue
    c = EDGE.get(f) or diff_center(f)
    if not c: continue
    t = c
    gap = np.full((560, 8, 3), 255, np.uint8)
    img = np.hstack([lab(crop(A[f], c), f'v3.5 f{f}'), gap, lab(crop(B[f], c), f'v3.5.1 f{f}')])
    name = f'v35hs-cross-f{f:04d}-vs-crop200.png'
    cv2.imwrite(os.path.join(out, name), img)
    src = 'cross-quad' if f in cross else ('brief-935' if f == 935 else 'extra')
    idx.append(f'{name}\t{src}\tcenter={t}' + ('' if f in EDGE else ' (diff)'))
open(os.path.join(out, 'v35hs-cross-index.txt'), 'w', encoding='utf-8').write('\n'.join(idx) + '\n')
print(f'judge files {len(idx)} · cross-quad {len(cross)} · want {len(want)}')
