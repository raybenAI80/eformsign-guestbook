"""레인 V — 구간 렌더에서 손 스틸과 손끝 200% 크롭을 뽑는다(판정 자료).
  python tools/hand-stills.py out/check/v33v-fill.mp4 fill 6,22,42,94
손끝 = 왼쪽 칸(1114px)의 피부색 최대 성분의 가장 왼쪽 점. 크롭 = 손끝 중심 400x260 → 2배.
"""
import sys, subprocess, os
import numpy as np, cv2
video, name, frames = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')]
# 레인 V2: 선택 인자 — 파일 접두어(기본 v33v) · 영상 첫 프레임의 장면 로컬 번호(구간 렌더가 장면 중간에서 시작할 때)
prefix = sys.argv[4] if len(sys.argv) > 4 else 'v33v'
offset = int(sys.argv[5]) if len(sys.argv) > 5 else 0
out = os.path.join(os.path.dirname(video))
tips = []
for f in frames:
    png = os.path.join(out, f'{prefix}-{name}-f{f:03d}.png')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{(f - offset + 0.5) / 30:.4f}', '-i', video, '-frames:v', '1', png], check=True)
    im = cv2.imread(png)
    L = im[:, :1114].astype(np.int16)
    b, g, r = L[..., 0], L[..., 1], L[..., 2]
    skin = ((r > 150) & (r - b > 28) & (r > g) & (g > b) & (r - g < 60)).astype(np.uint8)
    skin = cv2.morphologyEx(skin, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(skin)
    if n < 2 or st[1:, 4].max() < 1500:
        tips.append((f, None)); continue
    k = 1 + np.argmax(st[1:, 4]); ys, xs = np.nonzero(lab == k)
    i = np.argmin(xs); tx, ty = int(xs[i]), int(ys[i])
    tips.append((f, (tx, ty)))
    x0 = min(max(0, tx - 160), 1114 - 400); y0 = min(max(0, ty - 110), 1080 - 260)
    crop = cv2.resize(im[y0:y0 + 260, x0:x0 + 400], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    cv2.imwrite(os.path.join(out, f'{prefix}-{name}-f{f:03d}-crop200.png'), crop)
for f, t in tips:
    print(name, f, t)

# 바탕 연속성: 손·화면·자막과 겹치지 않는 창·화분 조각(20..300 x 20..260)의 연속 프레임 평균차.
# 사진이 바뀌거나(손이 다른 사진) 두 사진이 겹치면 이 값이 튄다. 느린 줌만 있으면 ≤1.
cap = cv2.VideoCapture(video); prev = None; ds = []
while True:
    ok, fr = cap.read()
    if not ok: break
    p = fr[20:260, 20:300].astype(np.int16)
    if prev is not None: ds.append(float(np.abs(p - prev).mean()))
    prev = p
print(f'{name} background-step max={max(ds):.2f} mean={np.mean(ds):.3f} frames={len(ds) + 1} (limit 1.5)')
