"""레인 V2(2026-09-30) — 이폼사인 작성 화면 캡처에서 **「다음 입력 칸」 안내 화살표**(분홍 ↓)를 지운다.

왜: 이폼사인 외부 작성 화면은 다음에 채울 칸 위에 분홍 화살표(#F37B7C 계열, 약 38x70px)를
   튀기듯 띄운다. 캡처(fill-seq·B03·C02)에 그대로 찍혀, 영상에서는 손끝 바로 앞에 붉은 표식이
   따라다니는 것처럼 보였다(오케스트레이터 판정 v33v-fill-f094-crop200.png).
   🔴 원본 캡처는 지우지 않는다 — 이 도구는 prescale-shots.mjs 가 `_scaled/` 사본을 만들기 **전에**
   원본 해상도 사본을 만들어 거기서 지운다(파생물만 바뀐다).

판정(원본 캡처 화소):
  핵심색 = |r-243|<=14, |g-122|<=18, |b-123|<=18 (필수 표시 * 의 붉은색 240,79,79 는 g 가 멀어 제외)
  화살표 = 핵심색을 6px 팽창해 묶은 성분 중 bbox 폭 18~64 · 높이 30~110 · 핵심 화소 >= 250
  지움  = 핵심색 4px 팽창 + 핵심 8px 안의 분홍 기운 화소(글자 위 반투명 겹침)를 cv2.inpaint(TELEA, 반경 4).
  덤    = 브라우저 맞춤법 물결 밑줄(빨강, 높이<=8·폭>=3x높이)도 같이 지운다(「김수정」 아래 — 같은 붉은 표식 계열).

  python tools/remove-guide-arrow.py --batch <list.json> <out-dir>   # prescale-shots.mjs 가 부른다
        list.json = [[원본 절대경로, 상대경로], ...] → 화살표가 있는 것만 <out-dir>/<상대경로> 로 쓰고
        표준출력 마지막 줄에 JSON {상대경로: 지운 화살표 수}
  python tools/remove-guide-arrow.py --check <png>...             # 게이트: 화살표 성분 수(원본 해상도 기준)
  python tools/remove-guide-arrow.py --check-scaled <png>...      # 게이트: 축소 사본의 분홍 화소 수
  python tools/remove-guide-arrow.py --check-video <mp4>          # 렌더 판정: 왼쪽 칸 분홍 화소가 있는 프레임 수(0 이어야)
"""
import json
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as nd


def core_mask(bgr):
    b, g, r = (bgr[..., i].astype(np.int16) for i in range(3))
    return (np.abs(r - 243) <= 14) & (np.abs(g - 122) <= 18) & (np.abs(b - 123) <= 18)


def arrows(bgr):
    core = core_mask(bgr)
    grp, n = nd.label(nd.binary_dilation(core, iterations=6))
    out = []
    for i, sl in enumerate(nd.find_objects(grp)):
        sub = (grp[sl] == i + 1) & core[sl]
        c = int(sub.sum())
        ys, xs = np.nonzero(sub)
        if not c:
            continue
        w, h = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
        if 18 <= w <= 64 and 30 <= h <= 110 and c >= 250:
            m = np.zeros(core.shape, bool)
            m[sl] = sub
            out.append(({"x": int(sl[1].start + xs.min()), "y": int(sl[0].start + ys.min()), "w": w, "h": h, "core": c}, m))
    return out


def tint(bgr):
    """분홍 기운(빨강이 초록·파랑보다 큼) — 반투명 화살표가 회색 글자 위에 겹친 화소도 잡는다."""
    b, g, r = (bgr[..., i].astype(np.int16) for i in range(3))
    return (r - np.maximum(g, b)) > 12


def squiggles(bgr):
    """브라우저 맞춤법 검사 물결 밑줄(빨강, 높이 <= 8px, 폭 >= 3x높이). 필수 표시 * (정사각)은 제외."""
    b, g, r = (bgr[..., i].astype(np.int16) for i in range(3))
    red = (r > 180) & (r - g > 50) & (np.abs(g - b) < 40)
    lab, n = nd.label(nd.binary_dilation(red, structure=np.ones((3, 11), bool)))
    out = np.zeros(red.shape, bool)
    cnt = 0
    for i, sl in enumerate(nd.find_objects(lab)):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        px = (lab[sl] == i + 1) & red[sl]
        # 밀도 조건: 물결 밑줄은 폭의 절반 이상이 빨강이다. ClearType 글자 가장자리의 흩어진 붉은 화소는 걸리지 않는다
        if h <= 8 and w >= 20 and w >= 3 * h and px.sum() >= 0.5 * w:
            out[sl] |= px
            cnt += 1
    return out, cnt


def clean(bgr):
    found = arrows(bgr)
    sq, nsq = squiggles(bgr)
    if not found and not nsq:
        return bgr, []
    core = np.zeros(bgr.shape[:2], bool)
    for _, m in found:
        core |= m
    # 핵심색 4px 팽창 + (핵심 8px 안의 분홍 기운 화소) — 글자 위에 겹친 반투명 부분까지
    mask = nd.binary_dilation(core, iterations=4) | (tint(bgr) & nd.binary_dilation(core, iterations=8))
    mask = nd.binary_dilation(mask, iterations=1) | nd.binary_dilation(sq, iterations=2)
    res = cv2.inpaint(bgr, mask.astype(np.uint8) * 255, 4, cv2.INPAINT_TELEA)
    return res, [f[0] for f in found] + [{"squiggle": nsq}] * (1 if nsq else 0)


def pinkish(bgr):
    """축소·흐림 뒤에도 남는 화살표 색(분홍: 빨강이 초록·파랑보다 확연히 크고 초록≈파랑)."""
    b, g, r = (bgr[..., i].astype(np.int16) for i in range(3))
    return (r > 200) & (r - g > 45) & (np.abs(g - b) < 22)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    a = sys.argv[1:]
    if a[0] == "--batch":
        items = json.load(open(a[1], encoding="utf-8"))
        out_dir = a[2]
        report = {}
        for src, rel in items:
            im = cv2.imread(src, cv2.IMREAD_COLOR)
            if im is None:
                continue
            res, found = clean(im)
            if not found:
                continue
            dst = os.path.join(out_dir, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            cv2.imwrite(dst, res)
            report[rel] = len(found)
        print(json.dumps(report, ensure_ascii=False))
        return
    if a[0] in ("--check", "--check-scaled"):
        bad = 0
        for p in a[1:]:
            im = cv2.imread(p, cv2.IMREAD_COLOR)
            n = (len(arrows(im)) + squiggles(im)[1]) if a[0] == "--check" else int(pinkish(im).sum())
            if n:
                bad += 1
                print(f"  X {p}: {n}")
        print(f"화살표 검사 {len(a) - 1}장 · 남은 장 {bad}")
        sys.exit(1 if bad else 0)
    if a[0] == "--check-video":
        # 렌더 판정: 왼쪽 칸(1114px)에서 안내 화살표 색(분홍 핵심색에 가까운 채도 높은 분홍) 화소 수를 프레임마다 센다.
        # 손 피부(r-g 30~70)와 가르려고 핵심색 거리 기준을 쓴다: |r-243|<=22·|g-122|<=30·|b-123|<=30 (축소·흐림 여유).
        cap = cv2.VideoCapture(a[1])
        per, f = [], 0
        while True:
            ok, fr = cap.read()
            if not ok:
                break
            L = fr[:, :1114].astype(np.int16)
            b, g, r = L[..., 0], L[..., 1], L[..., 2]
            m = (np.abs(r - 243) <= 22) & (np.abs(g - 122) <= 30) & (np.abs(b - 123) <= 30)
            per.append(int(m.sum()))
            f += 1
        bad = [(i, n) for i, n in enumerate(per) if n > 0]
        print(f"영상 {a[1]} {f}프레임 · 분홍 화소 있는 프레임 {len(bad)} · 최대 {max(per) if per else 0}" + (f" · 예 {bad[:8]}" if bad else ""))
        sys.exit(1 if bad else 0)
    raise SystemExit(__doc__)


main()
