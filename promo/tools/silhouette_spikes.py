"""레인 HF(2026-09-30) — 손 실루엣 「뾰족한 꼭짓점」 검사(공용 모듈 + CLI).

사용자 지적: 접힌 가운데·약지 마디(검지 뒤 손등 쪽 윗 윤곽)가 둥글지 않고 삼각형 스파이크로 튀어나왔다.
사람 손 윤곽은 손끝을 빼면 볼록 곡선이다 → 윤곽을 따라 호 길이 ±K px 의 두 현이 이루는 **안쪽 각(내각)**을
재서, 볼록 꼭짓점의 내각이 한도보다 작으면 스파이크.

  python tools/silhouette_spikes.py <hand.png> [--origin 783,500 --tip 790,510 --cut-x 1245] [--dump-contour out.json]

지표
  minInteriorDeg  제외 구역 밖 볼록 꼭짓점 내각 최솟값(°)  — 한도 SPIKE_MIN_DEG 미만이면 불통과
  spikes          한도 미만 꼭짓점 목록(컷아웃 좌표 x,y · 내각)
대상 = 손등 쪽 윗 윤곽(각 열의 맨 윗 윤곽, 바깥 법선 위) · 검지 손끝 반경 TIP_R 밖 · 커프 앞(DORSAL_X1)
  🔴 손가락 끝(엄지·접힌 손가락 끝)은 반경 4~6px 로 원래 뾰족하다(k=8 내각 112~124°) → 전체 윤곽에 각도 한도를
     걸면 정상 손가락 끝이 걸린다. 사람 손 윗 윤곽에는 끝이 없으므로 거기만 본다.
"""
import argparse, json, sys
import numpy as np, cv2

K_ARC = 8          # 현 길이(px, 호 길이) — 화소 계단(1~2px)보다 크고 마디 곡률 반경(~10px)과 비슷
SPIKE_MIN_DEG = 140  # 실측(2026-09-30, k=8, 윗 윤곽): 684cbc0·77259b6 마디 74.8° · 레인 H 본(d6ead93) 119.3° · 레인 HF 수정본 최솟값 151.4°(둘째 마디) → 사이 140
TIP_R = 30
DORSAL_X1 = 245   # 컷아웃 x — 이 오른쪽은 소매(뜨개 커프 윗모서리는 원래 각진 천 모서리라 대상 아님)


def contour_points(alpha, thr=128):
    m = (alpha >= thr).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)[:, 0, :].astype(np.float64)
    # 호 길이 1px 재표본 + 가벼운 평활(화소 계단 제거, σ=1.5px)
    d = np.sqrt((np.diff(np.vstack([c, c[:1]]), axis=0) ** 2).sum(1))
    s = np.concatenate([[0], np.cumsum(d)])
    total = s[-1]
    n = int(total)
    t = np.linspace(0, total, n, endpoint=False)
    cc = np.vstack([c, c[:1]])
    x = np.interp(t, s, cc[:, 0]); y = np.interp(t, s, cc[:, 1])
    pts = np.stack([x, y], 1)
    sig = 1.5; r = int(3 * sig)
    ker = np.exp(-0.5 * (np.arange(-r, r + 1) / sig) ** 2); ker /= ker.sum()
    pad = np.vstack([pts[-r:], pts, pts[:r]])
    sm = np.stack([np.convolve(pad[:, i], ker, mode='valid') for i in range(2)], 1)
    return sm


def interior_angles(pts, k=K_ARC):
    """각 점의 내각(°). 윤곽 방향과 무관하게 볼록=180 미만, 오목=180 초과."""
    n = len(pts)
    a = np.roll(pts, k, 0) - pts
    b = np.roll(pts, -k, 0) - pts
    ang = np.degrees(np.arccos(np.clip((a * b).sum(1) / (np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1) + 1e-9), -1, 1)))
    cross = a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]
    # 윤곽 방향(부호 면적)으로 볼록 판별
    area = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
    convex = np.sign(cross) == np.sign(area) * -1
    return np.where(convex, ang, 360 - ang)


def find_spikes(pts, include, limit=SPIKE_MIN_DEG, k=K_ARC):
    ia = interior_angles(pts, k)
    ia_in = np.where(include, ia, 999)
    spikes = []
    n = len(pts)
    for i in range(n):
        v = ia_in[i]
        if v >= limit:
            continue
        # 국소 최솟값만(±k)
        w = ia_in[[(i + j) % n for j in range(-k, k + 1)]]
        if v <= w.min():
            spikes.append({"x": round(float(pts[i, 0]), 1), "y": round(float(pts[i, 1]), 1), "deg": round(float(v), 1)})
    mn = float(ia_in.min()) if include.any() else 999.0
    return mn, spikes, ia


def outward_up(pts, alpha, thr=128):
    """윤곽 점의 바깥 법선이 위(사진 y−)를 향하는가 = 손등 쪽(윗 윤곽). 손가락 끝(검지·엄지·접힌 손가락 끝)은
    아래·왼쪽을 향하므로 빠진다 — 사람 손 윗 윤곽(검지 윗면·접힌 마디·손등·손목)에는 뾰족한 곳이 없다."""
    t = np.roll(pts, -2, 0) - np.roll(pts, 2, 0)
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
    n = np.stack([t[:, 1], -t[:, 0]], 1)
    h, w = alpha.shape
    def inside(q):
        x = np.clip(np.round(q[:, 0]).astype(int), 0, w - 1); y = np.clip(np.round(q[:, 1]).astype(int), 0, h - 1)
        return alpha[y, x] >= thr
    flip = inside(pts + 3 * n) & ~inside(pts - 3 * n)
    n[flip] *= -1
    # 윗 윤곽 = 그 열의 맨 윗 불투명 화소 근처(엄지·접힌 손가락처럼 검지 아래에 있는 윤곽은 빠진다)
    op = alpha >= thr
    top = np.where(op.any(0), op.argmax(0), h).astype(np.float64)
    xi = np.clip(np.round(pts[:, 0]).astype(int), 0, w - 1)
    return (n[:, 1] < -0.2) & (pts[:, 1] <= top[xi] + 1.5)


def check(path, origin=(783, 500), tip=(790, 510), cut_x=1245, limit=SPIKE_MIN_DEG, dump=None):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    pts = contour_points(im[:, :, 3])
    hand_w = max(1, cut_x - origin[0] - 60)
    tu, tv = tip[0] - origin[0], tip[1] - origin[1]
    include = (pts[:, 0] < min(hand_w, DORSAL_X1)) & (np.hypot(pts[:, 0] - tu, pts[:, 1] - tv) > TIP_R) & outward_up(pts, im[:, :, 3])
    mn, spikes, ia = find_spikes(pts, include, limit)
    if dump:
        json.dump({"file": path, "k": K_ARC, "limit": limit, "points": np.round(pts, 2).tolist(),
                   "include": include.astype(int).tolist()}, open(dump, 'w'))
    return {"minInteriorDeg": round(mn, 1), "spikes": spikes, "limitDeg": limit, "k": K_ARC,
            "pass": mn >= limit}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('png')
    ap.add_argument('--origin', default='783,500')
    ap.add_argument('--tip', default='790,510')
    ap.add_argument('--cut-x', type=int, default=1245)
    ap.add_argument('--limit', type=float, default=SPIKE_MIN_DEG)
    ap.add_argument('--dump-contour', default=None)
    A = ap.parse_args()
    o = tuple(map(int, A.origin.split(','))); t = tuple(map(int, A.tip.split(',')))
    r = check(A.png, o, t, A.cut_x, A.limit, A.dump_contour)
    print(json.dumps(r, ensure_ascii=False))
    sys.exit(0 if r["pass"] else 1)
