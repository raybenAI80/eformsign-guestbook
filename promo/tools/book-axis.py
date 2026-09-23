# -*- coding: utf-8 -*-
"""책 방향 채점 — 지면의 괘선 방향(화소 측정)과 「책→쓰는 사람」 방향의 각도차.

정상 배치: 펼침면의 아래 긴 변이 쓰는 사람 배 쪽, 책등이 사람에서 멀어짐
        => 괘선(글줄)은 사람의 좌↔우로 흐르므로, 「책→사람」 벡터와 괘선 방향은 수직.
판정: |angle(bookToWriter, ruleDir) - 90| <= tol  (기본 20도)

usage: python tools/book-axis.py <img> --roi x0,y0,x1,y1 --writer x,y [--book x,y] [--out overlay.png]
  --roi    : 펼침면(지면)만 들어가는 사각형. 괘선 방향은 이 안에서 화소로 측정한다.
  --writer : 쓰는 사람 몸통(어깨 사이) 중심 좌표(주석 입력).
  --book   : 지면 중심. 생략하면 ROI 안 밝은 화소의 무게중심(화소 측정).
"""
import argparse, math, sys
import numpy as np
from PIL import Image, ImageDraw

def parse_xy(s):
    a = [float(v) for v in s.replace(' ', '').split(',')]
    return a

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('img')
    ap.add_argument('--roi', required=True)
    ap.add_argument('--writer', required=True)
    ap.add_argument('--book')
    ap.add_argument('--tol', type=float, default=20.0)
    ap.add_argument('--out')
    a = ap.parse_args()

    im = Image.open(a.img).convert('RGB')
    W, H = im.size
    x0, y0, x1, y1 = [int(v) for v in parse_xy(a.roi)]
    arr = np.asarray(im.crop((x0, y0, x1, y1)), dtype=np.float64)
    g = arr.mean(axis=2)
    mx = arr.max(axis=2); mn = arr.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    paper = (g > 190) & (sat < 0.16)

    # 괘선 = 저대비 선형 구조. 구조텐서로 지배 방향(그래디언트에 수직) 추정
    gy, gx = np.gradient(g)
    w = paper.astype(np.float64)
    # 아주 강한 경계(책 테두리·손)는 제외해 괘선만 남긴다
    mag = np.hypot(gx, gy)
    w = w * (mag > 0.6) * (mag < 12.0)
    # 방향 히스토그램(180빈, 그래디언트 크기 가중) 의 최빈 방향을 1차 추정으로 쓴다.
    # 구조텐서 단일 추정은 책 테두리·나뭇결에 끌려간다.
    sel = w > 0
    ang_g = (np.degrees(np.arctan2(gy[sel], gx[sel])) + 180.0) % 180.0
    hist, _ = np.histogram(ang_g, bins=180, range=(0, 180), weights=mag[sel])
    k = np.array([1, 2, 3, 4, 5, 4, 3, 2, 1], dtype=np.float64); k /= k.sum()
    hs = np.convolve(np.r_[hist[-4:], hist, hist[:4]], k, mode='valid')
    theta_grad = math.radians(float(np.argmax(hs)) + 0.5)
    theta_line = theta_grad + math.pi / 2
    coh = float(hs.max() / max(hs.mean(), 1e-9)) / 10.0

    ys, xs = np.nonzero(paper)
    if a.book:
        bx, by = parse_xy(a.book)
    else:
        bx, by = x0 + xs.mean(), y0 + ys.mean()
    wx, wy = parse_xy(a.writer)

    vbw = (wx - bx, wy - by)                       # 책 -> 쓰는 사람
    vline = (math.cos(theta_line), math.sin(theta_line))
    dot = abs(vbw[0] * vline[0] + vbw[1] * vline[1]) / (math.hypot(*vbw) * 1.0)
    ang = math.degrees(math.acos(max(-1.0, min(1.0, dot))))   # 0..90
    diff = abs(ang - 90.0)
    ok = diff <= a.tol

    # 책등 방향 = 괘선에 수직, 사람에서 멀어지는 쪽으로 부호 맞춤
    vs = (-vline[1], vline[0])
    if vs[0] * vbw[0] + vs[1] * vbw[1] > 0:
        vs = (-vs[0], -vs[1])

    print('image=%s' % a.img)
    print('ruleAngleDeg=%.1f  coherence=%.3f' % (math.degrees(theta_line) % 180.0, coh))
    print('bookCenter=%.0f,%.0f  writer=%.0f,%.0f' % (bx, by, wx, wy))
    print('angle(bookToWriter, ruleDir)=%.1f  |diff from 90|=%.1f  tol=%.1f  PASS=%s'
          % (ang, diff, a.tol, ok))
    print('spineVec(사람에서 멀어지는 쪽)=%.2f,%.2f' % vs)

    if a.out:
        ov = im.copy(); d = ImageDraw.Draw(ov)
        d.rectangle([x0, y0, x1, y1], outline=(255, 160, 0), width=3)
        L = 260
        d.line([bx - vline[0] * L, by - vline[1] * L, bx + vline[0] * L, by + vline[1] * L],
               fill=(0, 200, 255), width=5)                      # 괘선 방향(하늘)
        d.line([bx, by, bx + vs[0] * L, by + vs[1] * L], fill=(255, 0, 255), width=6)  # 책등(자홍)
        d.line([bx, by, wx, wy], fill=(0, 255, 0), width=6)      # 책->사람(초록)
        r = 9
        d.ellipse([bx - r, by - r, bx + r, by + r], fill=(255, 0, 0))
        d.ellipse([wx - r, wy - r, wx + r, wy + r], fill=(0, 255, 0))
        ov.save(a.out)
        print('overlay=%s' % a.out)
    sys.exit(0 if ok else 1)

main()
