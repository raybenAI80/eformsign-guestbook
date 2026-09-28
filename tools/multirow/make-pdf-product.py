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

for p in range(lay['pages']):
    pg = doc.new_page(width=W, height=H)
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
