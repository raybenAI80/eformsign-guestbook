# Background PDF for the product guestbook (design layouts from layout-product.json, resolved by build.mjs).
# python make-pdf-product.py <resolved-layout.json> <out.pdf>
# Fonts are embedded from TTF files (layout.font / fontBold) — the builtin 'korea' CJK font of the probe
# (make-pdf.py) rendered with wide, uneven letter spacing in the completed PDF (v7-ext-i-complete-p1.png).
import json, os, sys, fitz

lay = json.load(open(sys.argv[1], encoding='utf-8'))
out = sys.argv[2]
C = lay['colors']
def rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
FR, FB = fitz.Font(fontfile=lay['font']), fitz.Font(fontfile=lay['fontBold'])
doc = fitz.open()
W, H = lay['pageW'], lay['pageH']
cols = lay['cols']; x0, x1 = cols[0]['x0'], cols[-1]['x1']
rpp, n, rh = lay['rowsPerPage'], lay['rows'], lay['rowH']
ht, hh = lay['headerTop'], lay['headerH']

def text(pg, x, y, s, size, color, bold=False, align='left'):
    f = FB if bold else FR
    w = f.text_length(s, fontsize=size)
    if align == 'center': x -= w / 2
    elif align == 'right': x -= w
    tw = fitz.TextWriter(pg.rect)
    tw.append((x, y), s, font=f, fontsize=size)
    tw.write_text(pg, color=rgb(color))

def reception(pg):
    # D안(방향 1 기업 리셉션): 흰 상단(오른쪽 기관 로고·기관명 값칸은 OZR), 네이비 밴드(제목·방문일/장 번호 라벨), 얇은 괘선 표
    b = lay['band']; top, bh = b['top'], b['h']
    pg.draw_rect(fitz.Rect(x0, top, x1, top + bh), color=None, fill=rgb(C['band']), width=0)
    text(pg, x0 + 16, b['titleBaseline'], lay['title'], b['titleSize'], C['title'], bold=True)
    # letter-spaced English sub title
    xx = x0 + 16
    for ch in lay['titleEn']:
        text(pg, xx, b['enBaseline'], ch, b['enSize'], C['bandSub'])
        xx += FR.text_length(ch, fontsize=b['enSize']) + 1.6
    for hf in lay.get('headerFields', []):
        if hf.get('label'):
            text(pg, hf['box'][2], top + 14, hf['label'], 7.5, C['bandSub'], align='right')
    fs_ = [hf for hf in lay.get('headerFields', []) if hf.get('label')]
    if len(fs_) > 1:
        xr = (fs_[0]['box'][2] + fs_[1]['box'][0]) / 2
        pg.draw_line((xr, top + 10), (xr, top + bh - 8), color=rgb(C['bandRule']), width=0.8)
    body_top = ht + hh; body_bot = body_top + rpp * rh
    pg.draw_line((x0, ht), (x1, ht), color=rgb(C['outer']), width=1.6)
    pg.draw_line((x0, body_top), (x1, body_top), color=rgb(C['outer']), width=0.8)
    for c in cols:
        text(pg, (c['x0'] + c['x1']) / 2, ht + hh / 2 + lay['headerSize'] * 0.36, c['label'], lay['headerSize'], C['headerText'], bold=True, align='center')
    for i in range(1, rpp + 1):
        y = body_top + i * rh
        pg.draw_line((x0, y), (x1, y), color=rgb(C['grid'] if i < rpp else C['outer']), width=0.6 if i < rpp else 0.9)
    for c in cols[1:]:
        pg.draw_line((c['x0'], body_top + 8), (c['x0'], body_bot - 8), color=rgb(C['vgrid']), width=0.5)
    g = lay.get('purposeGeo')
    pc = next((c for c in cols if c.get('type') == 'purpose'), None)
    for i in range(rpp):
        t = body_top + i * rh
        text(pg, (cols[0]['x0'] + cols[0]['x1']) / 2, t + rh / 2 + lay['numberSize'] * 0.36, str(i + 1), lay['numberSize'], C['number'], align='center')
        if pc and g:
            X = pc['x0']; bs = g['box']
            # v5 inline: options + other on one top line (same formula as layout.mjs purposeItems)
            labs = pc['options'] + ([pc['otherLabel']] if g.get('inline') else [])
            items = [(X + g['itemX0'] + k * g['itemDX'] + g['boxDX'], t + g['topCY'], lab) for k, lab in enumerate(labs)]
            if not g.get('inline'):
                items.append((X + g['otherBoxDX'], t + g['botCY'], pc['otherLabel']))
            for cx, cy, lab in items:
                # printBox false (v5): the OZ checkbox draws its own box at the component centre -> printing one here doubles the border
                if g.get('printBox', True):
                    pg.draw_rect(fitz.Rect(cx - bs / 2, cy - bs / 2, cx + bs / 2, cy + bs / 2), color=rgb(C['optBox']), width=0.7)
                text(pg, cx + bs / 2 + g['labelGap'] - 4, cy + g['labelSize'] * 0.36, lab, g['labelSize'], C['optLabel'])
            ot = g['otherText']
            if g.get('otherHint'):
                hs = g.get('otherHintSize', 7)
                text(pg, X + g['itemX0'], t + ot[3] - 3, g['otherHint'], hs, C['optLabel'])
            pg.draw_line((X + ot[0], t + ot[3]), (X + ot[2], t + ot[3]), color=rgb(C['grid']), width=0.6)
    text(pg, x0, lay['noteY'], lay['privacyNote'], lay['noteSize'], C['note'])

for p in range(lay['pages']):
    pg = doc.new_page(width=W, height=H)
    if lay.get('style') == 'reception':
        reception(pg)
        for lg in lay.get('logos', []):
            f = lg['file'] if os.path.isabs(lg['file']) else os.path.normpath(os.path.join(os.path.dirname(lay['file']), lg['file']))
            pix = fitz.Pixmap(f); h = lg['h']; w = h * pix.width / pix.height
            lx = x1 - w if lg.get('right') else lg['x']
            ly = lg['yCenter'] - h / 2 if 'yCenter' in lg else lg['y']
            pg.insert_image(fitz.Rect(lx, ly, lx + w, ly + h), filename=f, keep_proportion=True)
        continue
    first = p * rpp + 1; last = min(n, first + rpp - 1); k = last - first + 1
    text(pg, x0, lay['titleY'], lay['title'], lay['titleSize'], C['title'], bold=True)
    text(pg, x0, lay['subtitleY'], lay['subtitle'], lay['subtitleSize'], C['subtitle'])
    pg.draw_line((x0, lay['accentY']), (x0 + 36, lay['accentY']), color=rgb(C['accent']), width=2.5)
    if lay['pages'] > 1:
        text(pg, x1, lay['titleY'], f"{p + 1} / {lay['pages']}", 10, C['number'], align='right')
    body_top = ht + hh; body_bot = body_top + k * rh
    pg.draw_rect(fitz.Rect(x0, ht, x1, body_top), color=None, fill=rgb(C['headerBg']), width=0)
    for i in range(k):
        if (first + i) % 2 == 0:
            t = body_top + i * rh
            pg.draw_rect(fitz.Rect(x0, t, x1, t + rh), color=None, fill=rgb(C['zebra']), width=0)
    for c in cols:
        text(pg, (c['x0'] + c['x1']) / 2, ht + hh / 2 + lay['headerSize'] * 0.36, c['label'], lay['headerSize'], C['headerText'], bold=True, align='center')
    for i in range(1, k + 1):
        y = body_top + i * rh
        if i < k: pg.draw_line((x0, y), (x1, y), color=rgb(C['grid']), width=0.6)
    pg.draw_line((x0, body_top), (x1, body_top), color=rgb(C['outer']), width=0.9)
    for c in cols[1:]:
        pg.draw_line((c['x0'], ht), (c['x0'], body_bot), color=rgb(C['grid']), width=0.6)
    pg.draw_rect(fitz.Rect(x0, ht, x1, body_bot), color=rgb(C['outer']), width=0.9)
    for i in range(k):
        t = body_top + i * rh
        text(pg, (cols[0]['x0'] + cols[0]['x1']) / 2, t + rh / 2 + lay['numberSize'] * 0.36, str(first + i), lay['numberSize'], C['number'], align='center')
    text(pg, x0, lay['noteY'], lay['privacyNote'], lay['noteSize'], C['note'])
    # logos (layout "logos": [{file, h, x|right, y|yCenter}]) — PNG with alpha, aspect kept; file relative to the layout json
    for lg in lay.get('logos', []):
        f = lg['file'] if os.path.isabs(lg['file']) else os.path.normpath(os.path.join(os.path.dirname(lay['file']), lg['file']))
        pix = fitz.Pixmap(f); h = lg['h']; w = h * pix.width / pix.height
        lx = x1 - w if lg.get('right') else lg['x']
        ly = lg['yCenter'] - h / 2 if 'yCenter' in lg else lg['y']
        pg.insert_image(fitz.Rect(lx, ly, lx + w, ly + h), filename=f, keep_proportion=True)
doc.subset_fonts()
doc.save(out, garbage=4, deflate=True)
print('ok', out, 'pages', lay['pages'])
