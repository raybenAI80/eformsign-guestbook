"""
v3.3 레인 T3 — Paper→Designer 종이 텍스처에서 **손·펜·책 가장자리(지면이 아닌 화소)** 를 지면 색으로 메운다.

  python tools/mask-page-texture.py <raw.png> <out.png>     # 메우기 (make-page-texture.mjs 가 부른다)
  python tools/mask-page-texture.py --check <out.png>       # 게이트: 남은 비지면 화소 수 (exit 1 = 초과)

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
        print(f"텍스처 비지면 화소 {n} (허용 {MAX_RESIDUAL}) · 잉크 화소 {int(ink.sum())}")
        sys.exit(0 if n <= MAX_RESIDUAL and ink.sum() > 0 else 1)
    src, out = sys.argv[1], sys.argv[2]
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
    Image.fromarray(np.clip(res + 0.5, 0, 255).astype(np.uint8)).save(out)
    print(f"손/펜/모서리 메움 {int(mask.sum())} 화소 ({mask.mean() * 100:.2f}%) → {out}")


main()
