"""레인 v3.5(2026-09-30) — 손 1B + 종이 전환 깊이(후보 4) 본편 판정 자료. 전부 본편 1920 원본 프레임에서 200% 크롭.

  python tools/v35-judge.py <v3.4.1 본편 mp4> <v3.5 본편 mp4> <출력 디렉터리> [motion.json]

motion.json = check-hand-motion.mjs 가 쓴 out/check/v33v-motion.json (hand3d.rollPeak / pressPeak 로 ② 프레임을 고른다).
산출(파일명 = 본편 프레임):
  ① v35-edge-fNNNN-crop200.png (경계 교차 4) · v35-contour-{tip,cuff}-fNNNN-crop200.png (손톱·소매 각 2프레임 = 4)
     v35-shadow-fNNNN-crop200.png (3) · v35-knuckle-fNNNN-vs-crop200.png (접힌 마디 5, 왼쪽 v3.4.1 · 오른쪽 v3.5)
  ② v35-roll-fNNNN-vs-crop200.png (구름 최대 부근 3) · v35-press-fNNNN-vs-crop200.png (접촉 눌림 2)
  ③ v35-paper-full-fNNNN.png (380·395·399·410 원본) · v35-paper-fNNNN-vs.png (원본 50% 좌우, 흐름용)
     v35-paper-fNNNN-vs-crop200.png (종이 자리 200% 좌우) · v35-paper-ink-f0395-crop200.png · v35-paper-caption-fNNNN-crop200.png
  ④ v35-sheet-{fill,repeat,paper}.png (4열 대조시트, 흐름용 — 판정 근거 아님)
"""
import sys, os, json
import numpy as np, cv2

old_v, new_v, out = sys.argv[1:4]
mj = sys.argv[4] if len(sys.argv) > 4 else 'out/check/v33v-motion.json'
os.makedirs(out, exist_ok=True)
dur = json.load(open('src/scene-durations.json', encoding='utf-8'))['scenes']
FILL0, REP0 = dur['fill']['startFrame'], dur['repeat']['startFrame']
REP2 = REP0 + round(dur['repeat']['frames'] * 0.55)
M = json.load(open(mj, encoding='utf-8'))['hand3d']
starts = {'fill': FILL0, 'repeat-1': REP0, 'repeat-2': REP2}
ROLL = sorted(starts[k] + v['f'] for k, v in (M.get('rollPeakToTap') or M['rollPeak']).items() if v)
PRESS = sorted({starts[k] + v['f'] for k, v in M['pressPeak'].items() if k in ('fill', 'repeat-1')})
EDGE = [631, 734, 813, 1079]
CONTOUR = [683, 1000]
SHADOW = [611, 715, 1060]
KNUCKLE = [631, 683, 734, 813, 949]
PAPER = [380, 395, 399, 410]
SHEET_F = list(range(FILL0, REP0, 12)); SHEET_R = list(range(REP0, dur['manage']['startFrame'], 11)); SHEET_P = list(range(340, 431, 6))
ROLL_WIN = {f + d for f in ROLL for d in range(-24, 25)}
need_new = set(sorted(ROLL_WIN)) | set(EDGE + CONTOUR + SHADOW + KNUCKLE + ROLL + PRESS + PAPER + SHEET_F + SHEET_R + SHEET_P)
need_old = set(KNUCKLE + PRESS + PAPER) | ROLL_WIN


def frames(path, want):
    cap = cv2.VideoCapture(path); i = 0; got = {}
    while True:
        ok, fr = cap.read()
        if not ok or i > max(want): break
        if i in want: got[i] = fr
        i += 1
    return got


B = frames(new_v, need_new); A = frames(old_v, need_old)


def skin_box(fr):
    L = fr[:, :1114].astype(np.int16); b, g, r = L[..., 0], L[..., 1], L[..., 2]
    m = ((r > 150) & (r - b > 28) & (r > g) & (g > b) & (r - g < 60)).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    if n < 2 or st[1:, 4].max() < 1500: return None
    k = 1 + np.argmax(st[1:, 4]); ys, xs = np.nonzero(lab == k)
    j = np.argmin(xs); tip = (int(xs[j]), int(ys[j]))
    j = np.argmin(ys); top = (int(xs[j]), int(ys[j]))
    j = np.argmax(xs); cuff = (int(xs[j]), int(ys[j]))
    return tip, top, cuff


def crop(fr, c, w, h, dx=0, dy=0, xmax=1114):
    x0 = int(min(max(0, c[0] - w // 2 + dx), xmax - w)); y0 = int(min(max(0, c[1] - h // 2 + dy), 1080 - h))
    return cv2.resize(fr[y0:y0 + h, x0:x0 + w], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)


def lab(img, t):
    cv2.putText(img, t, (10, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2); return img


wrote = []


def save(name, img):
    cv2.imwrite(os.path.join(out, name), img); wrote.append(name)


def gap(img):
    return np.full((img.shape[0], 8, 3), 255, np.uint8)


def vs(f, c, w, h, dx=0, dy=0, xmax=1114, tag=''):
    l = lab(crop(A[f], c, w, h, dx, dy, xmax), f'v3.4.1 f{f} {tag}'); r = lab(crop(B[f], c, w, h, dx, dy, xmax), f'v3.5 f{f} {tag}')
    return np.hstack([l, gap(l), r])


def diff_center(f, fb=(600, 500)):
    """두 영상 차(흐림 후 >12) 가장 큰 덩어리 중심 = 바뀐 곳(손). 피부색 검출이 실패하는 옅은 손 프레임용"""
    d = np.abs(cv2.GaussianBlur(A[f], (0, 0), 1.5).astype(int) - cv2.GaussianBlur(B[f], (0, 0), 1.5)).max(2)
    n, _, st, cen = cv2.connectedComponentsWithStats((d > 12).astype(np.uint8))
    return tuple(int(v) for v in cen[1 + int(np.argmax(st[1:, 4]))]) if n > 1 else fb


def diff_area(f):
    d = np.abs(cv2.GaussianBlur(A[f], (0, 0), 1.5).astype(int) - cv2.GaussianBlur(B[f], (0, 0), 1.5)).max(2)
    n, _, st, _ = cv2.connectedComponentsWithStats((d > 12).astype(np.uint8))
    return int(st[1:, 4].max()) if n > 1 else 0


def mid(b):
    return ((b[0][0] + b[1][0]) // 2, (b[0][1] + b[1][1]) // 2)


# ① 손 크롭
for f in EDGE:
    b = skin_box(B[f]); save(f'v35-edge-f{f:04d}-crop200.png', lab(crop(B[f], mid(b) if b else (600, 500), 480, 300, dx=60), f'v3.5 f{f} edge'))
for f in CONTOUR:
    b = skin_box(B[f])
    if not b: continue
    save(f'v35-contour-tip-f{f:04d}-crop200.png', lab(crop(B[f], b[0], 240, 160, dx=60), f'v3.5 f{f} nail'))
    save(f'v35-contour-cuff-f{f:04d}-crop200.png', lab(crop(B[f], b[2], 280, 220, dx=-60), f'v3.5 f{f} sleeve'))
for f in SHADOW:
    b = skin_box(B[f]); save(f'v35-shadow-f{f:04d}-crop200.png', lab(crop(B[f], b[0] if b else (600, 500), 320, 200, dx=110, dy=40), f'v3.5 f{f} shadow'))
for f in KNUCKLE:
    b = skin_box(B[f]) or skin_box(A[f]); save(f'v35-knuckle-f{f:04d}-vs-crop200.png', vs(f, b[1] if b else (660, 450), 280, 180, tag='knuckle'))
# ② 1B 특유
# 구름 최대 프레임에 손이 줌 화면 밖이면(재시작 장면 진입 중) 가장 가까운, 두 판의 손이 달라 보이는(차 덩어리 >4000px) 프레임으로 옮긴다
def nearest_visible(f0):
    for d in sorted(range(-24, 25), key=abs):
        f = f0 + d
        if f in B and f in A and diff_area(f) > 4000: return f
    return f0
ROLL = [nearest_visible(f) for f in ROLL]
for f in ROLL:
    save(f'v35-roll-f{f:04d}-vs-crop200.png', vs(f, diff_center(f), 420, 280, xmax=1920, tag='roll max'))
for f in PRESS:
    b = skin_box(B[f]); save(f'v35-press-f{f:04d}-vs-crop200.png', vs(f, b[0] if b else diff_center(f), 320, 220, dx=80, xmax=1920, tag='press'))
# ③ 종이 전환 — 자리 = 두 영상 차 덩어리 경계상자(없으면 화면 가운데)
for f in PAPER:
    a, b = A[f], B[f]
    save(f'v35-paper-full-f{f:04d}.png', b)
    ha = cv2.resize(a, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA); hb = cv2.resize(b, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    save(f'v35-paper-f{f:04d}-vs.png', np.hstack([lab(ha, f'v3.4.1 f{f}'), gap(ha), lab(hb, f'v3.5 f{f}')]))
    d = np.abs(cv2.GaussianBlur(a, (0, 0), 1.5).astype(int) - cv2.GaussianBlur(b, (0, 0), 1.5)).max(2)
    ys, xs = np.nonzero(d > 16)
    c = (int((xs.min() + xs.max()) / 2), int((ys.min() + ys.max()) / 2)) if len(xs) > 500 else (960, 470)
    save(f'v35-paper-f{f:04d}-vs-crop200.png', vs(f, c, 560, 470, xmax=1920, tag='paper'))
    # 자막 띠(아래 380px, 가운데 960 폭) 200%
    cap_b = crop(b, (960, 890), 960, 380, xmax=1920)
    save(f'v35-paper-caption-f{f:04d}-crop200.png', lab(cap_b, f'v3.5 f{f} caption band'))
    if f == 395:
        # 손글씨 = 종이 자리(가장 밝은 큰 덩어리) 200%
        g = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
        m = (d > 16).astype(np.uint8)
        n, lb, st, cen = cv2.connectedComponentsWithStats(m)
        cc = tuple(int(v) for v in cen[1 + int(np.argmax(st[1:, 4]))]) if n > 1 else c
        save('v35-paper-ink-f0395-crop200.png', lab(crop(b, cc, 480, 440, xmax=1920), 'v3.5 f395 handwriting'))
# ④ 대조시트
for nm, fl, xw in (('fill', SHEET_F, 1114), ('repeat', SHEET_R, 1114), ('paper', SHEET_P, 1920)):
    tiles = [lab(cv2.resize(B[f][:, :xw], None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA), f'f{f}') for f in fl]
    while len(tiles) % 4: tiles.append(np.zeros_like(tiles[0]))
    save(f'v35-sheet-{nm}.png', np.vstack([np.hstack(tiles[i:i + 4]) for i in range(0, len(tiles), 4)]))
print(f'judge files {len(wrote)} · new {len(B)}/{len(need_new)} · old {len(A)}/{len(need_old)} · roll {ROLL} · press {PRESS}')
raise SystemExit(0 if len(B) == len(need_new) and len(A) == len(need_old) else 1)
