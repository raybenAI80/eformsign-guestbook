# Generate the 1-page background PDF for the multirow guestbook probe from layout.json.
import json, sys, fitz
lay = json.load(open(sys.argv[1], encoding='utf-8'))
out = sys.argv[2]
doc = fitz.open(); pg = doc.new_page(width=595, height=842)
F = 'korea'
pg.insert_text((40, 70), lay['title'], fontname=F, fontsize=18)
pg.insert_text((40, 92), lay['subtitle'], fontname=F, fontsize=9, color=(.35, .35, .35))
cols = lay['cols']; y0 = lay['headerTop']; hh = lay['headerH']; rh = lay['rowH']; n = lay['rows']
x_end = cols[-1]['x1']
pg.draw_rect(fitz.Rect(cols[0]['x0'], y0, x_end, y0 + hh), color=(0, 0, 0), fill=(.92, .92, .92), width=.8)
for c in cols:
    pg.insert_textbox(fitz.Rect(c['x0'], y0 + 7, c['x1'], y0 + hh), c['label'], fontname=F, fontsize=10, align=1)
for i in range(n):
    top = y0 + hh + i * rh
    pg.draw_rect(fitz.Rect(cols[0]['x0'], top, x_end, top + rh), color=(0, 0, 0), width=.8)
    pg.insert_textbox(fitz.Rect(cols[0]['x0'], top + rh / 2 - 7, cols[0]['x1'], top + rh), str(i + 1), fontname=F, fontsize=11, align=1)
for c in cols[1:]:
    pg.draw_line((c['x0'], y0), (c['x0'], y0 + hh + n * rh), color=(0, 0, 0), width=.8)
doc.save(out)
print('ok', out)
