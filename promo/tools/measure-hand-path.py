"""레인 V(2026-09-30) — 손이 누를 자리를 **캡처 화소에서 파생**해 src/hand-path.json 에 쓴다.

🔴 손 좌표를 코드에 손으로 박지 않는다. 캡처를 다시 찍으면 이 도구를 다시 돌린다.
  - fill-seq: 연속 프레임 차분 → 글자가 새로 생긴 자리(=그 입력 칸)를 묶어 「탭」 이벤트로.
    화면 전체가 바뀌는 프레임(서명 창 열림·닫힘)은 'screen' 으로 따로 둔다.
  - 버튼(서명 창 확인·전송 확인·감사 화면·카운트다운 「계속 작성하기」): 파란 버튼 색 성분 중
    가장 큰 것(viewport 안).
출력 좌표는 모두 **원본 캡처 화소**다. 사진 좌표 변환은 src/hand.ts 가 screenCrop+호모그래피로 한다.
"""
import json, os, sys
import numpy as np
from PIL import Image
import cv2

ROOT = os.path.join(os.path.dirname(__file__), '..')
SHOTS = os.path.join(ROOT, 'public', 'shots')
GEO = json.load(open(os.path.join(ROOT, 'src', 'scene-geometry.json'), encoding='utf-8'))

def gray(rel):
    return np.asarray(Image.open(os.path.join(SHOTS, rel)).convert('L'), dtype=np.int16)

def rgb(rel):
    return np.asarray(Image.open(os.path.join(SHOTS, rel)).convert('RGB'), dtype=np.int16)

def blue_button(rel, vp=None, solid=True):
    """이폼사인·래퍼의 파란 기본 버튼(#1b6ee0 계열) 중 가장 큰 성분의 중심."""
    im = rgb(rel)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    m = ((b > 170) & (r < 90) & (g > 80) & (g < 170) & (b - r > 110)).astype(np.uint8)
    if vp:
        keep = np.zeros_like(m); keep[vp['y']:vp['y'] + vp['h'], vp['x']:vp['x'] + vp['w']] = 1; m &= keep
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    best = None
    for i in range(1, n):
        x, y, w, h, a = st[i]
        # solid=False 면 테두리만 파란 버튼(감사 화면)도 받는다
        if 50 <= w <= 700 and 25 <= h <= 200 and w > 1.6 * h and a > (0.6 if solid else 0.02) * w * h:
            if best is None or a > best[4]:
                best = (int(x), int(y), int(w), int(h), int(a))
    if not best:
        return None
    x, y, w, h, _ = best
    return {"point": [x + w // 2, y + h // 2], "box": [x, y, w, h]}

def fill_events():
    seq = GEO['optional']['fillSeq']
    frames = seq['frames']; vp = seq['viewport']
    raw = []
    prev = None
    for i, f in enumerate(frames):
        a = gray(f)
        if prev is not None:
            ys, xs = np.nonzero(np.abs(a - prev) > 40)
            n = len(xs)
            if n == 0:
                pass
            elif n > 300000:
                # 창이 열리며 두 프레임에 걸쳐 바뀌는 경우(어두워짐 → 내용) 하나로 합친다
                if raw and raw[-1]['kind'] == 'screen' and raw[-1]['i'] == i - 1:
                    raw[-1]['end'] = i
                else:
                    raw.append({"i": i, "kind": "screen", "end": i})
            else:
                w, h = xs.max() - xs.min(), ys.max() - ys.min()
                if h <= 280 and w <= 600:
                    raw.append({"i": i, "kind": "type", "n": int(n), "x0": int(xs.min()),
                                "pt": [int(np.median(xs)), int(np.median(ys))]})
        prev = a
    # 같은 줄(|Δy|<45)의 연속 타이핑을 한 칸으로 묶는다
    groups = []
    for e in raw:
        if e['kind'] == 'screen':
            groups.append({"kind": "screen", "i": e['i'], "end": e['end']}); continue
        g = groups[-1] if groups else None
        if g and g['kind'] == 'field' and abs(g['y'] - e['pt'][1]) < 45:
            g['last'] = e['i']; g['count'] += 1; continue
        groups.append({"kind": "field", "i": e['i'], "last": e['i'], "count": 1,
                       "y": e['pt'][1], "n": e['n'], "point": [max(e['x0'], e['pt'][0] - 90), e['pt'][1]]})
    # 칸 사이 초점 이동 프레임(한 장짜리·넓은 변화)은 칸이 아니다
    groups = [g for g in groups if not (g['kind'] == 'field' and g['count'] == 1 and g['n'] > 3000)]
    events = []
    for k, g in enumerate(groups):
        if g['kind'] == 'field':
            events.append({"at": g['i'], "until": g['last'], "kind": "tap", "point": g['point']})
        else:
            # 창이 열리는 순간 = 그 뒤 「창이 닫힌 다음」 첫 칸(서명이 들어가는 칸)을 누른 것
            # 창이 닫히는 순간 = 직전 프레임의 파란 확인 버튼을 누른 것
            opened = sum(1 for x in groups[:k] if x['kind'] == 'screen') % 2 == 0
            if opened:
                later = [x for x in groups[k + 1:] if x['kind'] == 'screen']
                after = [x for x in groups if x['kind'] == 'field' and later and x['i'] > later[0]['i']]
                if after:
                    events.append({"at": g['i'], "kind": "tap", "point": after[0]['point'], "why": "modal-open"})
            else:
                btn = blue_button(frames[g['i'] - 1], vp, solid=True)
                if btn:
                    events.append({"at": g['i'], "kind": "tap", "point": btn['point'], "why": "modal-confirm"})
    # 서명 모양 고르기(창 안 한 장짜리 변화)는 「획」으로 — 그 칸 폭 안에서 좌→우 스윕
    for e in events:
        opens = [x['at'] for x in events if x.get('why') == 'modal-open']
        closes = [x['at'] for x in events if x.get('why') == 'modal-confirm']
        inside = [x['at'] for x in events if opens and closes and opens[0] < x['at'] < closes[0] and 'why' not in x]
        if inside and e['at'] == max(inside) and len(inside) > 1:
            e['kind'] = 'sign'
    # 창이 닫힌 뒤 서명 칸에 서명이 「나타나는」 변화는 손이 한 일이 아니다(확인 버튼의 결과)
    mo = [x['point'] for x in events if x.get('why') == 'modal-open']
    mc = [x['at'] for x in events if x.get('why') == 'modal-confirm']
    events = [x for x in events if not ('why' not in x and mc and x['at'] > mc[0] and x['point'] in mo)]
    return {"frames": len(frames), "events": sorted(events, key=lambda e: e['at'])}

def main():
    cap = GEO['captures']
    opt = GEO['optional']
    out = {
        "$comment": "🔴 손으로 고치지 말고 `python tools/measure-hand-path.py` 로 다시 만든다(캡처 화소 차분·버튼 색 성분). 좌표 = 원본 캡처 화소.",
        "fill": fill_events(),
        "sendConfirm": blue_button('B/B04-send-dialog.png', cap['B04']['viewport']),
        "thanks": {
            "button": blue_button(opt['thanksSeq']['frames'][0], opt['thanksSeq']['viewport'], solid=False),
            "transitionAt": None,
        },
        "countdown": {"button": blue_button(opt['countdown']['frames'][-1], None)},
    }
    # 감사 화면 → 새 서식으로 넘어가는 첫 프레임
    fr = opt['thanksSeq']['frames']; prev = gray(fr[0])
    for i in range(1, len(fr)):
        a = gray(fr[i])
        if (np.abs(a - prev) > 40).sum() > 10000:
            out['thanks']['transitionAt'] = fr[i]; break
        prev = a
    p = os.path.join(ROOT, 'src', 'hand-path.json')
    json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(json.dumps(out)[:2500])

if __name__ == '__main__':
    main()
