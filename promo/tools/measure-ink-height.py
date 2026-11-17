#!/usr/bin/env python3
"""방명록 손글씨가 화면에서 **몇 px 로 보이는지** 잰다.

왜 있나: 2026-09-21 v1 검수에서 "손글씨가 읽히지 않는다"는 판정이 나왔는데,
근거가 육안이었다. 글자 크기는 괘선 간격(pitch)에 묶여 있고 pitch 는 카메라
배율에 묶여 있으므로, 배율을 올릴지 말지는 **숫자**로 정해야 한다.

방법
  1. 스틸에서 지면 영역만 자른다(--crop). 지면 밖의 어두운 사진 화소를 배제한다.
  2. 잉크 화소를 고른다 — 손글씨는 #1B2A49(남색 계열) 가 종이 위에 0.85 로 얹힌
     것이라 **파랑이 빨강보다 뚜렷이 크다**. 생성 이미지의 그림자·나무 카운터는
     반대로 r >= b 인 세피아 계열이라 이 한 조건이 대부분을 갈라낸다.
     (조건: b - r >= --blue, 밝기 <= --lum)
  3. 행별 잉크 화소 수 프로파일 → 연속 구간(run) = 글줄 한 줄.
     run 높이의 중앙값·최댓값이 "화면에서 보이는 글자 높이"다.

🔴 이 값은 x-height 가 아니라 **먹이 닿는 전체 높이**다(한글은 x-height 개념이
   흐리다). v2 목표 ≥22px 도 같은 기준으로 읽는다.

사용:
  python tools/measure-ink-height.py --img out/check/v2-paper-max.png \
      --crop 300,520,1700,1080 --overlay out/check/v2-paper-inkrows.png
"""
import argparse
import sys

import numpy as np
from PIL import Image


def parse_crop(s, w, h):
    if not s:
        return (0, 0, w, h)
    p = [int(round(float(v))) for v in s.split(",")]
    if len(p) != 4:
        raise SystemExit("--crop 은 x0,y0,x1,y1 네 개여야 한다")
    x0, y0, x1, y1 = p
    return (max(0, x0), max(0, y0), min(w, x1), min(h, y1))


def runs_of(mask_rows, min_count):
    """행별 개수 배열 → (start, end_exclusive, peak) 구간 목록"""
    out = []
    start = None
    for i, c in enumerate(mask_rows):
        if c >= min_count and start is None:
            start = i
        elif c < min_count and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(mask_rows)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--img", required=True)
    ap.add_argument("--crop", default="")
    ap.add_argument("--blue", type=float, default=10.0, help="b-r 최소값")
    ap.add_argument("--lum", type=float, default=150.0, help="밝기 상한")
    ap.add_argument("--min-count", type=int, default=3, help="한 행이 글줄로 인정되는 잉크 화소 수")
    ap.add_argument("--min-height", type=int, default=2, help="이보다 얇은 run 은 잡음으로 버린다")
    ap.add_argument("--overlay", default="", help="근거 이미지 경로(잉크 화소를 붉게 칠한다)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    im = Image.open(a.img).convert("RGB")
    W, H = im.size
    x0, y0, x1, y1 = parse_crop(a.crop, W, H)
    arr = np.asarray(im.crop((x0, y0, x1, y1))).astype(np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b

    ink = (b - r >= a.blue) & (lum <= a.lum)
    rows = ink.sum(axis=1)
    rr = [(s, e) for (s, e) in runs_of(rows, a.min_count) if e - s >= a.min_height]
    heights = [e - s for (s, e) in rr]

    print(f"image     {a.img}  ({W}x{H})")
    print(f"crop      x[{x0},{x1}) y[{y0},{y1})  = {x1-x0}x{y1-y0}")
    print(f"filter    (b-r)>={a.blue}  lum<={a.lum}  minCount={a.min_count}  minHeight={a.min_height}")
    print(f"ink px    {int(ink.sum())}")
    print(f"글줄 run  {len(rr)}개")
    for s, e in rr:
        print(f"   y {y0+s:4d}..{y0+e:4d}   높이 {e-s:3d}px   화소 {int(rows[s:e].sum()):5d}")
    if heights:
        hs = np.array(heights, dtype=np.float32)
        print(f"높이  중앙값 {float(np.median(hs)):.1f}px · 평균 {float(hs.mean()):.1f}px "
              f"· 최소 {int(hs.min())}px · 최대 {int(hs.max())}px")
    else:
        print("높이  (잉크 run 없음 — crop 이나 임계값을 확인하라)")

    if a.overlay:
        ov = np.asarray(im.convert("RGB")).copy()
        sub = ov[y0:y1, x0:x1]
        sub[ink] = [255, 40, 40]
        ov[y0:y1, x0:x1] = sub
        Image.fromarray(ov).save(a.overlay)
        print(f"overlay   {a.overlay}")

    return 0 if heights else 1


if __name__ == "__main__":
    sys.exit(main())
