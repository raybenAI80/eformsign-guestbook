"""레인 B(2026-09-30) — 후보 스틸 이름 정리 + base 좌우 비교 + 손 후보 200% 경계 크롭 + 화소 차 통계.

사용: python tools/cand-b-compare.py out/check/v33b
  입력  raw-<id>-f<frame>.png (tools/cand-b-stills.mjs cand) · base-f<frame>.png (… base)
  출력  cand-<번호>-<이름>-f<frame>.png (1920 원본 복사, 축소 없음)
        cmp-<번호>-<이름>-f<frame>.png  (왼쪽 base | 오른쪽 후보, 3840x1080 원본 배율)
        crop200-<번호>-<이름>-f<frame>.png (손 후보: base·후보 차 영역 bbox 를 200% 확대, 위 base / 아래 후보)
"""
import sys, pathlib, shutil
import numpy as np, cv2

NAMES = {
    "hA": "1A-hand-lift", "hB": "1B-hand-tilt-press", "hC": "1C-hand-parallax",
    "c2": "2-tablet-layer", "c3": "3-inbox-cards", "c4": "4-paper-depth",
    "c5": "5-cta-logo3d", "c6": "6-inbox-plate-tilt",
}

def label(img, text):
    cv2.rectangle(img, (0, 0), (len(text) * 19 + 24, 46), (0, 0, 0), -1)
    cv2.putText(img, text, (12, 33), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2, cv2.LINE_AA)
    return img

def hand_box(d, fr):
    """손 크롭 영역 = 1A(hA) 와 base 의 차 영역(손·그림자만 바뀜) + 여유. 1B·1C 도 같은 영역을 써서 나란히 본다
    (1C 는 판 전체가 궤도로 움직여 자기 차 영역이 손이 아니다)."""
    a, b = cv2.imread(str(d / f"base-f{fr}.png")), cv2.imread(str(d / f"raw-hA-f{fr}.png"))
    ys, xs = np.nonzero(cv2.absdiff(a, b).max(axis=2) > 12)
    pad = 130
    x0, x1 = max(0, int(np.percentile(xs, 0.2)) - pad), min(1920, int(np.percentile(xs, 99.8)) + pad)
    y0, y1 = max(0, int(np.percentile(ys, 0.2)) - pad), min(1080, int(np.percentile(ys, 99.8)) + pad)
    return x0, x1, y0, y1

def main(d):
    d = pathlib.Path(d)
    for raw in sorted(d.glob("raw-*-f*.png")):
        cid, fr = raw.stem[4:].split("-f")
        name = NAMES[cid]
        base = d / f"base-f{fr}.png"
        out = d / f"cand-{name}-f{fr}.png"
        shutil.copyfile(raw, out)
        a, b = cv2.imread(str(base)), cv2.imread(str(raw))
        diff = cv2.absdiff(a, b).max(axis=2)
        m = diff > 12
        pct = 100.0 * m.mean()
        cmp = np.hstack([label(a.copy(), f"base f{fr}"), label(b.copy(), f"cand {name} f{fr}")])
        cv2.imwrite(str(d / f"cmp-{name}-f{fr}.png"), cmp)
        line = f"{name} f{fr}: changed(>12) {pct:.2f}% mean|d| {diff.mean():.2f}"
        if cid.startswith("h") and m.any():
            x0, x1, y0, y1 = hand_box(d, fr)
            up = lambda im: cv2.resize(im[y0:y1, x0:x1], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
            crop = np.vstack([label(up(a), f"base 200% x{x0}-{x1} y{y0}-{y1}"), label(up(b), f"{name} 200%")])
            cv2.imwrite(str(d / f"crop200-{name}-f{fr}.png"), crop)
            line += f" bbox x{x0}-{x1} y{y0}-{y1}"
        print(line)

if __name__ == "__main__":
    main(sys.argv[1])
