"""
v3.3 레인 T3 — Paper→Designer 종이 텍스처에서 **손·펜·책 가장자리(지면이 아닌 화소)** 를 지면 색으로 메운다.

  python tools/mask-page-texture.py <raw.png> <out.png>     # 메우기 (make-page-texture.mjs 가 부른다)
  python tools/mask-page-texture.py --check <out.png>       # 게이트: 남은 비지면 화소 수 + 가장자리 띠 (exit 1 = 초과)
  python tools/mask-page-texture.py <raw> <out> --edge-crop 0.19   # 레인 V2: 오른쪽·위 가장자리 잘라내고 원래 크기로

레인 V2(2026-09-30) 가장자리 크롭: 읽는 쪽 사진의 오른쪽 끝(x≈1015/1240 부터)에 제본 쪽 굴곡 띠(열 평균 밝기
  228.9→221.6 로 꺼졌다 올라오는 기울기)와 위쪽 옅은 곡선(책 모서리 메운 자리, x 1040~1160·y<60 밝기 231~237)이 남았다.
  오른쪽 F·W 와 위 F·H 를 **같은 비율**로 잘라 종이 비율(620:880)을 지키고 원래 크기로 균등 확대한다(손글씨는 모양 그대로 1/(1-F) 배).
  손글씨 경계(잉크 bbox)가 잘리면 실패한다. 게이트 = --check 의 「가장자리 띠」(edge_band() 지표 오른쪽 ≤ 3 · 위 ≤ 6).

판정(화소 단위, 0~255):
  잉크   = 파랑 쪽(b - r > 12) 이고 어둡다(max < 190)                 → 보존(손글씨 #1B2A49)
  비지면 = 잉크가 아니면서 ① 피부·나무색(채도 > 0.16, 색상 0~50°·330~360°)
           또는 ② 지면보다 확연히 어둡다(밝기 < 208 — 괘선 골은 213 이상)                   → 손·손가락·펜·책 모서리 그림자
메우기 = 비지면을 14px 팽창한 마스크 밖 화소만으로 한 **정규화 가우시안 흐림**(σ 24px) — 주변 지면의
        밝기 기울기가 이어진다. 괘선(밝기 ~220)은 비지면 판정에 걸리지 않으므로 그대로 남는다.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

MAX_RESIDUAL = 0  # 게이트 허용 비지면 화소 수(메운 뒤)
EDGE_BAND_MAX = (3.0, 6.0)  # 가장자리 띠 허용(오른쪽, 위) — edge_band() 지표


def edge_band(a):
    """가장자리 띠 지표(밝기 단위). 오른쪽 = 오른쪽 20% 열 중앙값 프로파일의 직선 적합 잔차 최대
    (제본 띠는 꺼졌다 올라오는 V 자라 직선에서 벗어난다. 종이 전체의 완만한 조명 기울기는 직선이라 0 에 가깝다).
    위 = 위 10% 를 40px 칸으로 나눈 칸 평균의 평면 적합 잔차 최대(국소 옅은 곡선만 튄다).
    실측(레인 V2): T3 텍스처 오른쪽 6.89·위 8.17 → 크롭 후 1.57·4.74."""
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    H, W = lum.shape
    x = np.arange(int(W * 0.8), W)
    col = np.median(lum[:, x], axis=0)
    right = float(np.abs(col - np.polyval(np.polyfit(x, col, 1), x)).max())
    t = lum[: int(H * 0.10) // 40 * 40, : W // 40 * 40]
    blk = t.reshape(t.shape[0] // 40, 40, t.shape[1] // 40, 40).mean(axis=(1, 3))
    yy, xx = np.mgrid[: blk.shape[0], : blk.shape[1]]
    A = np.c_[yy.ravel(), xx.ravel(), np.ones(blk.size)]
    k = np.linalg.lstsq(A, blk.ravel(), rcond=None)[0]
    top = float(np.abs(blk.ravel() - A @ k).max())
    return right, top


def crop_edges(a, f):
    H, W = a.shape[:2]
    ink, _, _ = classify(a)
    ys, xs = np.nonzero(ink)
    x1, y0 = int(round(W * (1 - f))), int(round(H * f))
    if xs.max() >= x1 - 24 or ys.min() <= y0 + 24:
        raise SystemExit(f"가장자리 크롭 {f} 이 손글씨를 자른다(잉크 x≤{xs.max()} y≥{ys.min()} / 자름 x<{x1} y≥{y0})")
    im = Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8)).crop((0, y0, x1, H)).resize((W, H), Image.LANCZOS)
    print(f"가장자리 크롭 오른쪽 {W - x1}px·위 {y0}px ({f * 100:.1f}%) → {W}x{H} 로 균등 확대 x{1 / (1 - f):.3f}")
    res = np.asarray(im).astype(float)
    # 확대(lanczos) 링잉으로 생긴 드문 어두운 화소는 지면 중앙값으로(잉크 3px 보호는 classify 가 한다)
    _, bad, _ = classify(res)
    res[bad] = np.median(res[~bad], axis=0)
    return res


def classify(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1)
    mn = a.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    # 색상(도)
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    ink = ((b - r) > 12) & (mx < 190)
    warm = (sat > 0.16) & ((h <= 50) | (h >= 330))
    dark = lum < 208
    # 손글씨 획 가장자리(안티앨리어싱)는 잉크 쪽으로 친다 — 글자 주변 3px 보호
    near_ink = ndimage.binary_dilation(ink, iterations=3)
    return ink, (~near_ink) & (warm | dark), near_ink


def main():
    if sys.argv[1] == "--check":
        a = np.asarray(Image.open(sys.argv[2]).convert("RGB")).astype(float)
        ink, bad, _ = classify(a)
        n = int(bad.sum())
        er, et = edge_band(a)
        print(f"텍스처 비지면 화소 {n} (허용 {MAX_RESIDUAL}) · 잉크 화소 {int(ink.sum())} · 가장자리 띠 오른쪽 {er:.1f} 위 {et:.1f} (허용 {EDGE_BAND_MAX[0]}·{EDGE_BAND_MAX[1]})")
        sys.exit(0 if n <= MAX_RESIDUAL and ink.sum() > 0 and er <= EDGE_BAND_MAX[0] and et <= EDGE_BAND_MAX[1] else 1)
    src, out = sys.argv[1], sys.argv[2]
    edge = float(sys.argv[sys.argv.index("--edge-crop") + 1]) if "--edge-crop" in sys.argv else 0.0
    a = np.asarray(Image.open(src).convert("RGB")).astype(float)
    ink, bad, near_ink = classify(a)
    mask = ndimage.binary_dilation(bad, iterations=14) & ~near_ink
    keep = (~mask).astype(float)
    sig = 24
    num = np.stack([ndimage.gaussian_filter(a[..., c] * keep, sig) for c in range(3)], -1)
    den = ndimage.gaussian_filter(keep, sig)[..., None]
    fill = num / np.maximum(den, 1e-6)
    # 넓은 비지면(전폭 책 모서리)은 흐림 창에 지면이 없을 수 있다 → 전체 지면 중앙값으로 보탠다
    paper = np.median(a[~mask], axis=0)
    fill = np.where(den > 0.02, fill, paper)
    res = np.where(mask[..., None], fill, a)
    # 메운 뒤에도 어두운 잔여(흐림에 섞인 그림자)는 지면 중앙값으로 끌어올린다
    _, bad2, _ = classify(res)
    bad2 &= mask
    res[bad2] = paper
    if edge > 0:
        res = crop_edges(res, edge)
    Image.fromarray(np.clip(res + 0.5, 0, 255).astype(np.uint8)).save(out)
    print(f"손/펜/모서리 메움 {int(mask.sum())} 화소 ({mask.mean() * 100:.2f}%) → {out}")


main()
