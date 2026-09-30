"""레인 B 후보 2 — 태블릿 층·바탕 층 분리용 소재 만들기 (판정용 후보, 본편 미사용).

사용:
  python tools/cand-b-tablet-layer.py --preview   # 화면 사각형 + 태블릿 몸체 다각형을 사진 위에 그려 out/check/v33b/ 에
  python tools/cand-b-tablet-layer.py --build     # 바탕 층(태블릿 자리 inpaint) public/gen/cand/gen-03-plate-bg.png
                                                 # + 몸체 다각형 src/cand-tablet-body.json

태블릿 몸체 = 화면 사각형(public/gen/prompts.json scene 3 screenQuad)을 베젤 폭만큼 바깥으로 민 것.
베젤 폭은 사각형 각 변의 바깥 법선 방향으로 BEZEL px(육안 오버레이로 맞춤).
"""
import json, sys, pathlib
import numpy as np, cv2

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLATE = ROOT / "public/gen/gen-03-plate.png"
BEZEL = {"top": 26, "right": 30, "bottom": 30, "left": 28}

def quad():
    j = json.loads((ROOT / "public/gen/prompts.json").read_text(encoding="utf-8"))
    s = next(s for s in j["scenes"] if s["scene"] == 3)
    return np.array(s["screenQuad"]["points"], dtype=np.float64)

def offset_quad(q, b):
    # 변 = tl-tr(top), tr-br(right), br-bl(bottom), bl-tl(left). 각 변을 바깥 법선으로 밀고 교점을 다시 구한다
    c = q.mean(axis=0)
    names = ["top", "right", "bottom", "left"]
    lines = []
    for i in range(4):
        a, d = q[i], q[(i + 1) % 4]
        t = (d - a) / np.linalg.norm(d - a)
        n = np.array([t[1], -t[0]])
        if np.dot(n, (a + d) / 2 - c) < 0:
            n = -n
        lines.append((a + n * b[names[i]], t))
    pts = []
    for i in range(4):
        (p1, t1), (p2, t2) = lines[i - 1], lines[i]
        A = np.array([t1, -t2]).T
        s = np.linalg.solve(A, p2 - p1)
        pts.append(p1 + t1 * s[0])
    return np.array(pts)

def main():
    q = quad()
    body = offset_quad(q, BEZEL)
    img = cv2.imread(str(PLATE))
    out = ROOT / "out/check/v33b"
    out.mkdir(parents=True, exist_ok=True)
    if "--preview" in sys.argv:
        v = img.copy()
        cv2.polylines(v, [q.astype(np.int32)], True, (0, 0, 255), 1, cv2.LINE_AA)
        cv2.polylines(v, [body.astype(np.int32)], True, (0, 255, 0), 1, cv2.LINE_AA)
        crop = v[200:800, 400:1000]
        crop = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        cv2.imwrite(str(out / "cand-2-body-overlay-200.png"), crop)
        print("preview", out / "cand-2-body-overlay-200.png", body.round(1).tolist())
    if "--build" in sys.argv:
        H, W = img.shape[:2]
        # 앞 층(가까운 층) = 카운터 윗면 아래 + 태블릿 몸체 + 받침대. 먼 층 = 창·로비 안쪽.
        # 카운터 뒷변 = 사진 (200,700)→(1160,530) 직선(육안, _plate-grid.png). x>1180 은 다루지 않는다(판 밖).
        init = np.full((H, W), cv2.GC_PR_BGD, np.uint8)
        yy, xx = np.mgrid[0:H, 0:W]
        edge = 700 - 0.177 * (xx - 200)
        init[(yy > edge + 14)] = cv2.GC_FGD
        init[(yy > edge - 10) & (yy <= edge + 14)] = cv2.GC_PR_FGD
        init[(yy < edge - 60)] = cv2.GC_BGD
        tb = np.zeros((H, W), np.uint8)
        cv2.fillPoly(tb, [body.astype(np.int32)], 1)
        core = offset_quad(q, {k: 4 for k in BEZEL})
        tc = np.zeros((H, W), np.uint8)
        cv2.fillPoly(tc, [core.astype(np.int32)], 1)
        init[tb == 1] = cv2.GC_PR_FGD
        init[tc == 1] = cv2.GC_FGD
        # 받침대 기둥(태블릿 아래 가운데 → 카운터) 은 확실한 앞 층
        cv2.rectangle(init, (575, 690), (625, 745), cv2.GC_FGD, -1)
        # 오른쪽 사람(x>1180)은 이 후보에서 먼 층에 섞이지 않게 앞 층 취급(판 밖, 영향 없음)
        init[:, 1180:] = cv2.GC_FGD
        bgm, fgm = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
        m = init.copy()
        cv2.grabCut(img, m, None, bgm, fgm, 4, cv2.GC_INIT_WITH_MASK)
        fg = np.where((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
        # 가장 큰 덩어리만 + 작은 구멍 메움
        n, lab, st, _ = cv2.connectedComponentsWithStats(fg)
        big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        fg = np.where(lab == big, 255, 0).astype(np.uint8)
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
        alpha = cv2.GaussianBlur(fg, (0, 0), 1.2)
        rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
        rgba[:, :, 3] = alpha
        cv2.imwrite(str(ROOT / "public/gen/cand/gen-03-plate-fg.png"), rgba)
        # 먼 층: 앞 층 자리를 inpaint(층 어긋남 최대 폭보다 넓게 30px 번짐)
        hole = cv2.dilate(fg, np.ones((61, 61), np.uint8))
        small = cv2.resize(img, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
        hs = cv2.resize(hole, (W // 2, H // 2), interpolation=cv2.INTER_NEAREST)
        fill = cv2.inpaint(small, hs, 7, cv2.INPAINT_TELEA)
        fill = cv2.resize(fill, (W, H), interpolation=cv2.INTER_CUBIC)
        bg = np.where(hole[:, :, None] > 0, fill, img)
        cv2.imwrite(str(ROOT / "public/gen/cand/gen-03-plate-bg.png"), bg)
        v = img.copy(); v[fg == 0] = (v[fg == 0] * 0.35).astype(np.uint8)
        cv2.imwrite(str(out / "cand-2-fg-mask-check.png"), v)
        print("built fg/bg", int((fg > 0).sum()))

if __name__ == "__main__":
    main()
