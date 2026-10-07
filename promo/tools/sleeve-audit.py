"""레인 main60-sleeve(2026-10-07) — 본편 Main60 손 층 소매 연장부 줄무늬 감사(렌더 스틸 전/후 대조).

왜: hand-03.png 연장부 알파가 가는 띠 3개뿐이던 결함(레인 D3c 발견)이 본편 장면에 실제로 드러나는지,
    고친 뒤 바뀐 화소가 연장부 투영 자리에만 있는지를 **렌더 화소로** 판정한다(축소 시트가 아닌 200% 크롭).

🔴 함정: 메모리가 빠듯하면 기본 GL(angle, D3D11)이 GL_OUT_OF_MEMORY → WebGL 컨텍스트 소실로 **손 없는 스틸**을
   조용히 내보낸다(exit 0). 그래서 렌더는 --gl=swangle(소프트웨어)로 고정하고, 로그에서 컨텍스트 소실을 찾으면 실패로 본다(swangle 도 간헐 소실·exit 1·3 이 나서 4회 재시도).

대조 실험(2026-10-07 실측): render 의 tag 는 임의 문자열이라 대조 손을 넣고 `render ctrlo ...` 처럼 찍어 비교할 수 있다.
   연장부(열 456+)를 전면 불투명으로 바꾼 손 → 26프레임 diff 0, 손 열 380~455 알파 0 → f715 에서 화면 x1034~1113 변경.
   즉 Main60 에서는 연장부가 사진 칸(오른쪽 경계 x≈1114) 밖이라 화면에 나오지 않는다 — 판정 전 이 양성/음성 대조를 먼저 돌린다.
   대조 손을 public/gen/hand-03.png 에 넣었다면 끝나고 반드시 되돌린다(재개 워커가 대조판을 정답으로 오인할 뻔했다).

사용(promo/ 에서):
  python tools/sleeve-audit.py render before 590 611 ...     # out/sleeve-audit/before-fNNN.png + crop-before-fNNN.png
  python tools/sleeve-audit.py judge before after 590 611 ...  # 전/후 화소 diff·줄무늬 판정 JSON(stdout) + diff-fNNN.png
  python tools/sleeve-audit.py sheet before after 590 611 ...  # out/sleeve-audit/sheet.png (전 | 후 | diff, 200% 크롭)
"""
import json, os, subprocess, sys
import numpy as np, cv2

OUT = 'out/sleeve-audit'
ROI = (700, 520, 1120, 900)  # 화면 좌표 x0,y0,x1,y1 — 왼쪽 사진 칸(폭 ~1114) 오른쪽 아래, 소매가 지나는 자리


def crop200(im):
    x0, y0, x1, y1 = ROI
    return cv2.resize(im[y0:y1, x0:x1], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)


def render(tag, frames):
    os.makedirs(OUT, exist_ok=True)
    pn = 'pnpm.cmd' if os.name == 'nt' else 'pnpm'
    # 🔴 remotion bundle 은 메모리 압박에서 webpack 캐시 읽기(ArrayBuffer) 실패가 반복돼 스틸마다 직접 묶는다(느리지만 안정)
    for f in frames:
        p = f'{OUT}/{tag}-f{f:04d}.png'
        for attempt in range(4):  # 메모리 압박으로 브라우저 기동이 간헐 실패 → 재시도
            if os.path.exists(p):
                os.remove(p)
            r = subprocess.run([pn, 'exec', 'remotion', 'still', 'Main60', p, '--frame', str(f), '--gl=swangle', '--log=verbose'],
                               capture_output=True, text=True, encoding='utf-8', errors='replace')
            log = r.stdout + r.stderr
            lost = ('CONTEXT_LOST' in log) or ('GL_OUT_OF_MEMORY' in log)
            if r.returncode == 0 and not lost and os.path.exists(p):
                break
        else:
            print(json.dumps({"frame": f, "error": "render", "exit": r.returncode, "contextLost": lost, "tail": log[-600:]}))
            sys.exit(1)
        cv2.imwrite(f'{OUT}/crop-{tag}-f{f:04d}.png', crop200(cv2.imread(p)))
        print(json.dumps({"frame": f, "still": p}), flush=True)


def runs(col):
    on = np.concatenate([[0], col.astype(np.int8), [0]])
    return int((np.diff(on) == 1).sum())


def judge(ta, tb, frames):
    rows = []
    for f in frames:
        a = cv2.imread(f'{OUT}/{ta}-f{f:04d}.png').astype(np.int16)
        b = cv2.imread(f'{OUT}/{tb}-f{f:04d}.png').astype(np.int16)
        d = np.abs(a - b).max(2)
        m = d > 8
        cv2.imwrite(f'{OUT}/diff-f{f:04d}.png', (m * 255).astype(np.uint8))
        n = int(m.sum())
        row = {"frame": f, "changedPx": n, "bbox": None, "stripeColumns": 0, "maxRunsPerColumn": 0, "outsideRoiPx": 0}
        if n:
            ys, xs = np.nonzero(m)
            row["bbox"] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
            x0, y0, x1, y1 = ROI
            inroi = np.zeros_like(m); inroi[y0:y1, x0:x1] = True
            row["outsideRoiPx"] = int((m & ~inroi).sum())
            # 줄무늬 = 전 스틸에서 바뀐 화소가 한 열 안에 **여러 가로 띠**로 끊겨 나타난다(소매 면이면 한 덩어리)
            mm = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
            rc = [runs(mm[:, x] > 0) for x in range(mm.shape[1])]
            row["maxRunsPerColumn"] = int(max(rc))
            row["stripeColumns"] = int(sum(1 for r in rc if r >= 2))
        row["stripe"] = bool(row["stripeColumns"] >= 5)
        rows.append(row)
        print(json.dumps(row), flush=True)
    return rows


def sheet(ta, tb, frames):
    tiles = []
    for f in frames:
        a = cv2.imread(f'{OUT}/crop-{ta}-f{f:04d}.png'); b = cv2.imread(f'{OUT}/crop-{tb}-f{f:04d}.png')
        dm = cv2.imread(f'{OUT}/diff-f{f:04d}.png', 0)
        dv = crop200(cv2.cvtColor(dm, cv2.COLOR_GRAY2BGR)) if dm is not None else np.zeros_like(a)
        row = np.concatenate([a, np.full((a.shape[0], 8, 3), 255, np.uint8), b, np.full((a.shape[0], 8, 3), 255, np.uint8), dv], 1)
        cv2.putText(row, f'f{f} before | after | diff', (12, 36), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 0, 255), 3)
        tiles.append(row); tiles.append(np.full((8, row.shape[1], 3), 255, np.uint8))
    s = np.concatenate(tiles, 0)
    s = cv2.resize(s, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)  # 시트는 흐름용(판정 근거 = crop-*.png 200%)
    cv2.imwrite(f'{OUT}/sheet.png', s)
    print(f'{OUT}/sheet.png', s.shape)


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'render':
        render(sys.argv[2], [int(x) for x in sys.argv[3:]])
    elif cmd == 'judge':
        rows = judge(sys.argv[2], sys.argv[3], [int(x) for x in sys.argv[4:]])
        json.dump(rows, open(f'{OUT}/judge.json', 'w'), indent=1)
    elif cmd == 'sheet':
        sheet(sys.argv[2], sys.argv[3], [int(x) for x in sys.argv[4:]])
