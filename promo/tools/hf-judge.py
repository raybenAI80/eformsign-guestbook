"""레인 HF(2026-09-30) — 접힌 마디 실루엣 판정 자료(전부 본편 1920 원본 프레임에서 200%, 알파는 400%).

  python tools/hf-judge.py <이전 본편 mp4> <새 본편 mp4> <이전 hand-03.png> <새 hand-03.png> <출력 디렉터리>

산출
  hf-knuckle-fNNNN-before-after-crop200.png   접힌 마디 부위: 왼쪽 = 이전, 오른쪽 = 새 (프레임 631·683·734·813·1000)
  hf-alpha-knuckle-before-after-crop400.png   hand-03.png 알파(위)·원본 사진 위 윤곽선(아래), 왼쪽 이전·오른쪽 새
크롭 자리 = 두 영상 프레임 차(흐림 후 >12)의 가장 큰 덩어리 중심(바뀐 곳 = 마디), 없으면 프레임 631 기준 자리.
"""
import sys, os
import numpy as np, cv2

old_v, new_v, old_h, new_h, out = sys.argv[1:6]
os.makedirs(out, exist_ok=True)
FR = [631, 683, 734, 813, 949, 1000]  # 1000 = 브리프 지정이나 손이 화면에 없다(대조 0) → Repeat 접촉 949 추가


def frames(path, want):
    cap = cv2.VideoCapture(path); i = 0; got = {}
    while True:
        ok, fr = cap.read()
        if not ok or i > max(want): break
        if i in want: got[i] = fr
        i += 1
    return got


A = frames(old_v, set(FR)); B = frames(new_v, set(FR))
CW, CH = 180, 120
for f in FR:
    a, b = A[f], B[f]
    d = np.abs(cv2.GaussianBlur(a, (0, 0), 1.5).astype(int) - cv2.GaussianBlur(b, (0, 0), 1.5)).max(2)
    m = (d > 12).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    if n > 1:
        j = 1 + int(np.argmax(st[1:, 4])); cx, cy = cen[j]
    else:
        cx, cy = 660, 450
    x0 = int(np.clip(cx - CW / 2, 0, 1920 - CW)); y0 = int(np.clip(cy - CH / 2, 0, 1080 - CH))
    ca = cv2.resize(a[y0:y0 + CH, x0:x0 + CW], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
    cb = cv2.resize(b[y0:y0 + CH, x0:x0 + CW], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
    s = np.hstack([ca, np.full((CH * 2, 6, 3), 255, np.uint8), cb])
    cv2.putText(s, f'f{f} before (x{x0},y{y0})', (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
    cv2.putText(s, 'after', (CW * 2 + 12, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
    cv2.imwrite(os.path.join(out, f'hf-knuckle-f{f:04d}-before-after-crop200.png'), s)
    print(f, 'crop', x0, y0, 'changed px', int(m.sum()))

# 알파 400%: 컷아웃 (70..190, 0..50) = 사진 (853..973, 500..550)
g = cv2.imread('public/gen/gen-03.png')[500:550, 853:973]
rows = []
for h in (old_h, new_h):
    al = cv2.imread(h, cv2.IMREAD_UNCHANGED)[0:50, 70:190, 3]
    e = cv2.Canny(al, 60, 160) > 0
    ov = g.copy(); ov[e] = (0, 0, 255)
    rows.append(np.vstack([cv2.cvtColor(al, cv2.COLOR_GRAY2BGR), ov]))
s = np.hstack([cv2.resize(rows[0], None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST), np.full((400, 8, 3), 255, np.uint8),
               cv2.resize(rows[1], None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)])
cv2.imwrite(os.path.join(out, 'hf-alpha-knuckle-before-after-crop400.png'), s)
print('alpha ok')
