"""레인 V — 구간 렌더에서 손 스틸과 손끝 200% 크롭을 뽑는다(판정 자료).
  python tools/hand-stills.py out/check/v33v-fill.mp4 fill 6,22,42,94
손끝 = 왼쪽 칸(1114px)의 피부색 최대 성분의 가장 왼쪽 점. 크롭 = 손끝 중심 400x260 → 2배.
"""
import sys, subprocess, os, json
import numpy as np, cv2

if len(sys.argv) > 1 and sys.argv[1] == '--judge':
    # 레인 H3D(2026-09-30): 판정 자료 일괄 — 전부 **본편 1920 원본 프레임**에서 200% 크롭(축소 없음).
    #   python tools/hand-stills.py --judge <본편 v3.4 mp4> <본편 v3.3 mp4(2D 대조)> <출력 디렉터리> [접두어=v33h3d]
    # 산출(파일명에 본편 프레임 번호):
    #   ① <p>-edge-fNNNN-crop200.png   화면 경계를 넘는 프레임(edgeCross) — 손끝~너클이 화면 변을 지나는 자리
    #   ② <p>-contour-{tip,top,cuff}-fNNNN-crop200.png   손가락 윤곽·손톱 / 손등 윗선 / 소매 경계
    #   ③ <p>-shadow-fNNNN-crop200.png   그림자와 윤곽이 겹치는 손가락 아래
    #   ④ <p>-sheet-{fill,repeat}.png   4열 대조시트(왼쪽 칸 원본 크기 0.5 축소 — 흐름용, 판정 근거 아님)
    #   ⑤ <p>-vs-fNNNN.png   같은 프레임 v3.3(2D, 왼쪽) 대 v3.4(3D, 오른쪽) 200% 크롭
    # 원본 프레임도 같이 남긴다: <p>-full-fNNNN.png
    v34, v33, outdir = sys.argv[2], sys.argv[3], sys.argv[4]
    P = sys.argv[5] if len(sys.argv) > 5 else 'v33h3d'
    os.makedirs(outdir, exist_ok=True)
    EDGE = [631, 734, 755, 813, 938, 1079]
    CONTOUR = [595, 683, 723, 1000]
    SHADOW = [611, 715, 763, 1060]
    VS = [734, 813, 1079]
    FILL = (588, 878); REP = (878, 1098)
    SHEET_F = list(range(FILL[0], FILL[1], 12)); SHEET_R = list(range(REP[0], REP[1], 11))
    need = set(EDGE + CONTOUR + SHADOW + VS + SHEET_F + SHEET_R)
    def frames(path, want):
        cap = cv2.VideoCapture(path); i = 0; got = {}
        while True:
            ok, fr = cap.read()
            if not ok: break
            if i in want: got[i] = fr
            i += 1
        return got
    A = frames(v34, need); B = frames(v33, set(VS))
    def skin_box(fr):
        L = fr[:, :1114].astype(np.int16); b, g, r = L[..., 0], L[..., 1], L[..., 2]
        m = ((r > 150) & (r - b > 28) & (r > g) & (g > b) & (r - g < 60)).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(m)
        if n < 2 or st[1:, 4].max() < 1500: return None
        k = 1 + np.argmax(st[1:, 4]); ys, xs = np.nonzero(lab == k)
        j = np.argmin(xs); tip = (int(xs[j]), int(ys[j]))
        j = np.argmin(ys); top = (int(xs[j]), int(ys[j]))
        j = np.argmax(xs); cuff = (int(xs[j]), int(ys[j]))
        return tip, top, cuff
    def crop(fr, c, w=400, h=260, dx=0, dy=0):
        x0 = min(max(0, c[0] - w // 2 + dx), 1114 - w); y0 = min(max(0, c[1] - h // 2 + dy), 1080 - h)
        return cv2.resize(fr[y0:y0 + h, x0:x0 + w], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC), (x0, y0)
    def lab(img, t):
        cv2.putText(img, t, (10, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2); return img
    wrote = []
    def save(name, img):
        cv2.imwrite(os.path.join(outdir, name), img); wrote.append(name)
    for f in EDGE:
        b = skin_box(A[f]); save(f'{P}-full-f{f:04d}.png', A[f])
        c = ((b[0][0] + b[1][0]) // 2, (b[0][1] + b[1][1]) // 2) if b else (600, 500)
        save(f'{P}-edge-f{f:04d}-crop200.png', lab(crop(A[f], c, 480, 300, dx=60)[0], f'v3.4 main60 f{f} edge'))
    for f in CONTOUR:
        b = skin_box(A[f]); save(f'{P}-full-f{f:04d}.png', A[f])
        if not b: continue
        save(f'{P}-contour-tip-f{f:04d}-crop200.png', lab(crop(A[f], b[0], 240, 160, dx=60)[0], f'v3.4 f{f} fingertip/nail'))
        save(f'{P}-contour-top-f{f:04d}-crop200.png', lab(crop(A[f], b[1], 280, 180)[0], f'v3.4 f{f} top contour'))
        save(f'{P}-contour-cuff-f{f:04d}-crop200.png', lab(crop(A[f], b[2], 280, 220, dx=-60)[0], f'v3.4 f{f} sleeve edge'))
    for f in SHADOW:
        b = skin_box(A[f]); save(f'{P}-full-f{f:04d}.png', A[f])
        c = b[0] if b else (600, 500)
        save(f'{P}-shadow-f{f:04d}-crop200.png', lab(crop(A[f], c, 320, 200, dx=110, dy=40)[0], f'v3.4 f{f} shadow'))
    for f in VS:
        b = skin_box(A[f]); c = ((b[0][0] + b[1][0]) // 2, (b[0][1] + b[1][1]) // 2) if b else (600, 500)
        l, _ = crop(B[f], c, 360, 260, dx=40); r, _ = crop(A[f], c, 360, 260, dx=40)
        save(f'{P}-vs-f{f:04d}.png', np.hstack([lab(l, f'v3.3 2D f{f}'), np.full((l.shape[0], 8, 3), 255, np.uint8), lab(r, f'v3.4 3D f{f}')]))
    for nm, fl in (('fill', SHEET_F), ('repeat', SHEET_R)):
        tiles = [lab(cv2.resize(A[f][:, :1114], None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA), f'f{f}') for f in fl]
        while len(tiles) % 4: tiles.append(np.zeros_like(tiles[0]))
        save(f'{P}-sheet-{nm}.png', np.vstack([np.hstack(tiles[i:i + 4]) for i in range(0, len(tiles), 4)]))
    print(f'judge files {len(wrote)} · frames {len(A)}/{len(need)} · vs {len(B)}/{len(VS)}')
    raise SystemExit(0 if len(A) == len(need) and len(B) == len(VS) else 1)

if len(sys.argv) > 1 and sys.argv[1] == '--straight-cut':
    # 레인 H3D(2026-09-30): 화면 변 직선 절단 검사(렌더 판정). check-hand-motion.mjs 가 경계 교차 프레임마다
    # 화면 사각형(본편 화소 좌표)을 json 으로 넘긴다. 각 변을 따라 1px 간격으로, 변 안쪽 4px·바깥쪽 4px 의 피부 여부를 본다.
    #   안쪽만 피부(바깥은 아님) + 변 ±1.5px 급한 색 계단 = 손이 변에서 끊긴 자리(레인 H3D 1차: 색 계단 조건 없이는 자막 흰 띠·손가락 아랫선이 오탐 14프레임). 그런 표본이 변을 따라 연속 CUT_LIMIT px 이상이면 「직선 절단」.
    #   (손이 변을 비스듬히 지나면 끊긴 표본은 몇 px 뿐이다 — 윤곽이 변과 평행하게 겹치는 곳만 길어진다.)
    #   python tools/hand-stills.py --straight-cut <구간 mp4> <quads.json> [--selftest]
    # --selftest = 음성 대조: 화면 밖(왼쪽 칸)을 회색으로 칠해 손을 변에서 자른 합성 → 절단이 검출되어야 한다(exit 1).
    CUT_LIMIT = 14
    STEP_MIN = 45  # BGR 합 |차|
    video, jf = sys.argv[2], sys.argv[3]
    selftest = '--selftest' in sys.argv
    items = json.load(open(jf, encoding='utf-8'))
    want = {it['frame']: it for it in items if it['frame'] >= 0}
    cap = cv2.VideoCapture(video); i = 0; seen = 0; worst = (0, None); cut_frames = []
    def skin_of(fr):
        L = fr[:, :1114].astype(np.int16); b, g, r = L[..., 0], L[..., 1], L[..., 2]
        m = ((r > 150) & (r - b > 28) & (r > g) & (g > b) & (r - g < 60)).astype(np.uint8)
        return cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    while True:
        ok, fr = cap.read()
        if not ok: break
        it = want.get(i)
        if it is not None:
            q = np.array(it['quad'], dtype=np.float64)
            if selftest:
                poly = np.zeros(fr.shape[:2], np.uint8); cv2.fillPoly(poly, [np.round(q).astype(np.int32)], 1)
                band = (poly == 0); band[:, 1114:] = False
                fr = fr.copy(); fr[band] = (60, 60, 60)
            sk = skin_of(fr); H, W = sk.shape
            c = q.mean(0); best = 0
            for e in range(4):
                a, bb = q[e], q[(e + 1) % 4]
                d = bb - a; ln = np.hypot(*d); t = d / ln
                n = np.array([t[1], -t[0]])
                if np.dot((a + bb) / 2 - c, n) < 0: n = -n
                run = 0
                for s in range(int(ln)):
                    p = a + t * s
                    pi, po = p - 4 * n, p + 4 * n
                    xi, yi, xo, yo = int(round(pi[0])), int(round(pi[1])), int(round(po[0])), int(round(po[1]))
                    if not (0 <= xi < W and 0 <= yi < H and 0 <= xo < W and 0 <= yo < H):
                        run = 0; continue
                    # 끊긴 자리 = 안쪽 피부 · 바깥 피부 아님 · **변 바로 앞뒤(±1.5px)에 급한 색 계단**(잘린 알파는 계단, 자연 윤곽·자막 띠의 흐림은 완만)
                    a1, b1 = p - 1.5 * n, p + 1.5 * n
                    step = np.abs(fr[int(round(a1[1])), int(round(a1[0]))].astype(np.int16) - fr[int(round(b1[1])), int(round(b1[0]))].astype(np.int16)).sum()
                    if sk[yi, xi] and not sk[yo, xo] and step > STEP_MIN:
                        run += 1; best = max(best, run)
                    else:
                        run = 0
            seen += 1
            if best >= CUT_LIMIT: cut_frames.append(it['main60'])
            if best > worst[0]: worst = (best, it['main60'])
        i += 1
    print(f"straight-cut frames {seen}/{len(want)} · cut frames {len(cut_frames)} · longest run {worst[0]}px at main60 f{worst[1]} (limit {CUT_LIMIT}px){' · selftest' if selftest else ''}"
          + (f" · cut main60 {cut_frames[:12]}" if cut_frames else ''))
    raise SystemExit(1 if cut_frames or seen < len(want) else 0)

if len(sys.argv) > 1 and sys.argv[1] == '--edge-sheets':
    # 레인 H(2026-09-30): 손이 화면 경계를 넘는 프레임 **전부**(check-hand-motion.mjs 가 out/check/v33v-motion.json
    # edgeCross 에 쓴 본편 프레임 번호)를 본편에서 읽어, 손끝~너클 200% 크롭을 24장씩 대조시트로 묶는다.
    # 원본 크기 스틸은 8프레임마다 1장(전수 원본 PNG 는 수백 MB 라 시트로 대신한다).
    #   python tools/hand-stills.py --edge-sheets out/main60-v3.3.mp4 out/check/v33h
    video, outdir = sys.argv[2], sys.argv[3]
    os.makedirs(outdir, exist_ok=True)
    ec = json.load(open('out/check/v33v-motion.json', encoding='utf-8'))['edgeCross']
    want = sorted({f for v in ec.values() for f in v['main60']})
    cap = cv2.VideoCapture(video); i = 0; tiles = []; full = 0; ws = set(want)
    while True:
        ok, fr = cap.read()
        if not ok: break
        if i in ws:
            L = fr[:, :1114].astype(np.int16); b, g, r = L[..., 0], L[..., 1], L[..., 2]
            skin = ((r > 150) & (r - b > 28) & (r > g) & (g > b) & (r - g < 60)).astype(np.uint8)
            skin = cv2.morphologyEx(skin, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
            n, lab, st, _ = cv2.connectedComponentsWithStats(skin)
            if n >= 2 and st[1:, 4].max() >= 1500:
                k = 1 + np.argmax(st[1:, 4]); ys, xs = np.nonzero(lab == k); j = np.argmin(xs); tx, ty = int(xs[j]), int(ys[j])
            else:
                tx, ty = 500, 500
            x0 = min(max(0, tx - 60), 1114 - 320); y0 = min(max(0, ty - 90), 1080 - 200)
            t = cv2.resize(fr[y0:y0 + 200, x0:x0 + 320], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
            cv2.putText(t, f'main60 f{i}', (8, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
            tiles.append(t)
            if (i - want[0]) % 8 == 0:
                cv2.imwrite(os.path.join(outdir, f'v33h-edge-full-f{i:04d}.png'), fr); full += 1
        i += 1
    sheets = 0
    for s in range(0, len(tiles), 24):
        grp = tiles[s:s + 24]
        while len(grp) % 4: grp.append(np.zeros_like(tiles[0]))
        rows = [np.hstack(grp[r:r + 4]) for r in range(0, len(grp), 4)]
        cv2.imwrite(os.path.join(outdir, f'v33h-edge-sheet-{s // 24:02d}.jpg'), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88]); sheets += 1
    print(f'edge frames {len(tiles)}/{len(want)} · sheets {sheets} · full stills {full}')
    raise SystemExit(0 if len(tiles) == len(want) else 1)

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
