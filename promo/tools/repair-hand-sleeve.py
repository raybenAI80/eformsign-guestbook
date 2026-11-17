"""레인 D3c(2026-10-06) — 손 층 소매 연장부 수선 사본(실제 화면 편 Demo53 전용).

🔴 왜: hand-03.png 의 소매 연장부(절단선 오른쪽 420px)는 make-hand-layer.py 가 알파를 **절단 직전 마지막 열**
   (흐림으로 반투명, 대부분 α<128)에서 따와 가는 띠 3개만 불투명하다. 손이 원래 자리보다 왼쪽에 오면(arrive)
   그 띠가 바탕 위에 계단식 가로 줄무늬로 드러난다(d3b-crop-arrive-sleeve.png). 바탕(gen-03-plate)은 깨끗하다.
   본편(Main60)은 hand-03.png 를 그대로 쓴다 — 이 도구는 원본을 덮어쓰지 않고 사본만 만든다.

방법: 연장부(--seam-x 부터 끝까지)를 소매 **안쪽** 열 묶음(--seam-x - --inset 앞 --blk 열)을 가로로 늘려 다시 채운다.
   알파 = 안쪽 기준 열의 불투명 띠(α>128 → 255, 위·아래 2px 침식 후 1px 페더), 팔 방향 기울기만큼 아래로 민다.

사용:
  python tools/repair-hand-sleeve.py                               # 기본값 = hand-03.png → hand-03-demo.png
  python tools/repair-hand-sleeve.py --check public/gen/hand-03-demo.png   # 연장부 띠 판정만(불통과 exit 1)
"""
import argparse, json, sys
import numpy as np, cv2

ap = argparse.ArgumentParser()
ap.add_argument('--src', default='public/gen/hand-03.png')
ap.add_argument('--out', default='public/gen/hand-03-demo.png')
ap.add_argument('--seam-x', type=int, default=456, help='연장부 시작 열(컷아웃 좌표). 원본 절단선 462 보다 반투명 이음매만큼 앞')
ap.add_argument('--inset', type=int, default=0, help='기준 열을 seam-x 에서 이만큼 더 안쪽으로')
ap.add_argument('--blk', type=int, default=60, help='가로로 늘릴 안쪽 열 묶음 폭')
ap.add_argument('--check', default=None, metavar='PNG')
A = ap.parse_args()


def bands(alpha_col):
    """불투명(α>128) 구간 [(y0,y1)...]"""
    on = alpha_col > 128
    out, y = [], 0
    while y < len(on):
        if on[y]:
            y0 = y
            while y < len(on) and on[y]:
                y += 1
            out.append((y0, y - 1))
        else:
            y += 1
    return out


def check(path, seam_x):
    a = cv2.imread(path, cv2.IMREAD_UNCHANGED)[:, :, 3]
    bad = []
    for x in range(seam_x, a.shape[1]):
        b = bands(a[:, x])
        # 연장부 각 열은 불투명 띠 1개, 두께 ≥ 120px(소매 두께 ~168px, 캔버스 높이 때문에 끝으로 갈수록 좁아짐)여야 한다
        if len(b) != 1 or (b[0][1] - b[0][0]) < 120:
            bad.append(x)
    res = {"file": path, "columns": a.shape[1] - seam_x, "badColumns": len(bad), "firstBad": bad[:5]}
    print(json.dumps(res, ensure_ascii=False))
    return 0 if not bad else 1


if A.check:
    sys.exit(check(A.check, A.seam_x))

img = cv2.imread(A.src, cv2.IMREAD_UNCHANGED)
H, W = img.shape[:2]
ref = A.seam_x - 1 - A.inset
src_cols = img[:, ref - A.blk + 1: ref + 1].copy()  # 안쪽 blk 열
ext_n = W - A.seam_x


def band_one(col):
    b = bands(col)
    return max(b, key=lambda t: t[1] - t[0]) if b else (0, 0)


# 팔 방향 기울기 — 위·아래 경계를 따로 잰다(팔이 화면 밖으로 갈수록 굵어진다: 위 경계가 더 가파름).
#   🔴 한 기울기로 np.roll 하면 아래 경계가 캔버스 높이(343)를 넘어 위로 감겨 들어온다(첫 시도 46열 불통과).
t0, b0 = band_one(img[:, ref - 80, 3]); ta, ba = band_one(img[:, ref, 3])
st, sb = (ta - t0) / 80.0, (ba - b0) / 80.0
bot_max = H - 3
if ba + sb * ext_n > bot_max:  # 캔버스 안에 머물게 아래 기울기만 줄인다(크기 = prompts.json size 불변)
    sb = (bot_max - ba) / ext_n
slope = (st + sb) / 2
ys = np.arange(H, dtype=np.float32)

cols = []
for j in range(ext_n):
    k = int(A.blk - 1 - (j * A.blk) // ext_n)  # 거울 반복 대신 가로 늘임(대칭 무늬 방지)
    c = src_cols[:, k].astype(np.float32)
    d = j + 1 + A.inset
    top, bot = ta + st * d, ba + sb * d
    # 세로 재표본: 새 [top,bot] → 기준 열 [ta,ba]
    sy = ta + (ys - top) * (ba - ta) / max(1e-3, bot - top)
    col = np.stack([np.interp(sy, ys, c[:, ch]) for ch in range(3)], 1)
    a = np.clip(np.minimum(ys - (top + 1.5), (bot - 1.0) - ys) + 0.5, 0, 1)  # 위·아래 테두리 침식 + 1px 페더
    cols.append(np.concatenate([col, (a * 255)[:, None]], 1).round().clip(0, 255).astype(np.uint8)[:, None])
ext = np.concatenate(cols, 1)
ext[:, :, :3] = cv2.GaussianBlur(ext[:, :, :3], (0, 0), sigmaX=4, sigmaY=1.2)  # 늘인 결을 누그러뜨린다
out = img.copy()
out[:, A.seam_x:] = ext
# 이음매: 원본 마지막 6열(반투명)과 겹치는 자리는 연장부가 덮는다. premultiplied 업로드라 투명 화소 색은 무관.
cv2.imwrite(A.out, out)
print(json.dumps({"src": A.src, "out": A.out, "seamX": A.seam_x, "refCol": ref, "slopeTop": round(st, 4), "slopeBottom": round(sb, 4),
                  "band": [int(ta), int(ba)], "size": [W, H]}, ensure_ascii=False))
