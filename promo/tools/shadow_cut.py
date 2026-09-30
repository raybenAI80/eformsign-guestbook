"""레인 HS(2026-09-30) — 손 그림자 격자 경계 직선 절단 판정 보조(check-hand-motion.mjs 가 부른다).

  python tools/shadow_cut.py --dist <hand cutout png> <pad> <step> <out.json>
      그림자 격자(컷아웃 사각형을 사방 pad 만큼 넓힌 것, HandLayer buildGrid 와 같은 꼭짓점)의 **바깥 변 꼭짓점**마다
      손 알파(>2) 까지의 거리(컷아웃 px)를 쓴다. 게이트는 이 거리가 그 꼭짓점의 흐림 반경 이하이면 「격자 변에서 잘림」으로 본다.
  python tools/shadow_cut.py --video <구간 mp4> <items.json>
      items = [{frame, main60, pts:[[x,y,nx,ny],...]}] — 옛 격자 변(컷아웃 사각형 변)의 그림자 투영점(렌더 px)과 바깥 법선.
      그 선을 가로지르는 **계단**(법선 단면에서 2px 안에 ≥10 레벨·안쪽 반그늘 기울기의 2.2배 이상 상승 + 바깥 5px 평평 + 안쪽이 다시 밝아지지 않음 + 밝기 ≥80 — 가는 선·글자·서식 칸 제외)이 이웃 표본 2개 이상 이어지면 절단.
      exit 1 = 절단 프레임 있음. 마지막 줄 = 요약.
"""
import sys, json
import numpy as np, cv2

if sys.argv[1] == '--dist':
    png, pad, step, out = sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
    a = cv2.imread(png, cv2.IMREAD_UNCHANGED)[..., 3]
    h, w = a.shape
    P = pad + 2
    big = np.full((h + 2 * P, w + 2 * P), 255, np.uint8)
    big[P:P + h, P:P + w][a > 2] = 0
    dt = cv2.distanceTransform(big, cv2.DIST_L2, 5)
    nu = -(-(w + 2 * pad) // step) + 1
    nv = -(-(h + 2 * pad) // step) + 1
    U = [min(w + pad, i * step - pad) for i in range(nu)]
    V = [min(h + pad, j * step - pad) for j in range(nv)]
    pts = []
    ring = [(u, V[0]) for u in U] + [(U[-1], v) for v in V[1:]] + [(u, V[-1]) for u in reversed(U[:-1])] + [(U[0], v) for v in reversed(V[1:-1])]
    for u, v in ring:
        x = min(max(int(round(u)) + P, 0), big.shape[1] - 1)
        y = min(max(int(round(v)) + P, 0), big.shape[0] - 1)
        pts.append([u, v, float(dt[y, x])])
    json.dump({'w': w, 'h': h, 'pad': pad, 'step': step, 'ring': pts}, open(out, 'w'))
    print(f'ring {len(pts)} pts · min dist {min(p[2] for p in pts):.1f}px')
    sys.exit(0)

if sys.argv[1] == '--video':
    vid, jf = sys.argv[2], sys.argv[3]
    items = json.load(open(jf, encoding='utf-8'))
    want = {it['frame']: it for it in items}
    cap = cv2.VideoCapture(vid)
    i = 0; seen = 0; cut = []; worst = (0, None)
    last = max(want) if want else -1
    while i <= last:
        ok, fr = cap.read()
        if not ok: break
        it = want.get(i)
        if it:
            seen += 1
            L = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY).astype(np.float32)
            F = fr.astype(np.int16)
            H, W = L.shape

            def lum(x, y):
                xi, yi = int(round(x)), int(round(y))
                if not (0 <= xi < W and 0 <= yi < H): return None
                b, g, r = F[yi, xi]
                if r > 150 and r - b > 28 and r > g > b and r - g < 60: return None  # 손(피부) 위는 판정 제외
                return L[yi, xi]

            run = 0; best = 0
            for x, y, nx, ny in it['pts']:
                # 법선 방향 1px 간격 단면 p[-6..+8]. 계단 = 2px 안에 ≥10 레벨 오르되 안쪽 반그늘 기울기(2px 당)의 2.2배 이상 가파르고, 그 바깥 5px 가 평평(≤3)하며,
                # 안쪽 4px 가 계단 밑보다 밝지 않다(그림자 반그늘 — 가는 선·서식 칸 테두리·글자는 안쪽이 다시 밝아 제외).
                pr = [lum(x + k * nx, y + k * ny) for k in range(-6, 9)]
                hit = False
                if None not in pr and min(pr) >= 80:
                    for j in range(4, len(pr) - 7):
                        jump, ramp = pr[j + 2] - pr[j], max(1.0, (pr[j] - pr[j - 4]) / 2)
                        if jump >= 10 and jump >= 2.2 * ramp and max(pr[j + 2:j + 7]) - min(pr[j + 2:j + 7]) <= 3 and max(pr[j - 4:j + 1]) <= pr[j] + 4:
                            hit = True; break
                run = run + 1 if hit else 0
                best = max(best, run)
            if best >= 2:
                cut.append(it['main60'])
            if best > worst[0]: worst = (best, it['main60'])
        i += 1
    print(f"shadow-cut frames {seen}/{len(want)} · cut frames {len(cut)} {cut[:12]}{'…' if len(cut) > 12 else ''} · longest run {worst[0]} pts at main60 f{worst[1]}")
    sys.exit(1 if cut or seen < len(want) else 0)
