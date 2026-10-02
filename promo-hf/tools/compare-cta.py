"""Remotion vs HyperFrames CTA parity sheet + numbers.

Usage (from repo root):
  python promo-hf/tools/compare-cta.py \
      --remotion-still promo/out/hf-trial/remotion-f1688.png \
      --hf-still promo-hf/out/still/frame-00-at-0.767s.png \
      --remotion-mp4 promo/out/hf-trial/remotion-cta.mp4 \
      --hf-mp4 promo-hf/out/hf-cta.mp4 \
      --out promo-hf/out/compare

Writes sheet.png (labelled side-by-side + diff heatmap), crops-200.png (logo / lead / panel
edge at 200%), and prints a JSON summary: still diff bbox + mean abs diff, per-frame mp4 diff,
and audio RMS per 0.5 s window.
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, FPS, N = 1920, 1080, 30, 135


def font(size):
    for p in ["C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/arial.ttf"]:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()


def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(np.int16)


def diff_stats(a, b, thr=8):
    d = np.abs(a - b).max(axis=2)
    ys, xs = np.nonzero(d > thr)
    bbox = None if len(xs) == 0 else [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
    return {
        "mean_abs": round(float(np.abs(a - b).mean()), 3),
        "max_abs": int(d.max()),
        "px_over_thr": int((d > thr).sum()),
        "thr": thr,
        "bbox_over_thr": bbox,
    }, d


def frames(mp4):
    cmd = ["ffmpeg", "-v", "error", "-i", mp4, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)


def audio_rms(mp4, win=0.5):
    cmd = ["ffmpeg", "-v", "error", "-i", mp4, "-f", "f32le", "-ac", "1", "-ar", "48000", "-"]
    x = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32)
    n = int(48000 * win)
    out = []
    for i in range(0, min(len(x), int(4.5 * 48000)), n):
        seg = x[i : i + n]
        rms = float(np.sqrt(np.mean(seg.astype(np.float64) ** 2))) if len(seg) else 0.0
        out.append(round(20 * np.log10(rms + 1e-9), 2))
    return out


def label(img, text, color=(255, 255, 255), bg=(17, 24, 38)):
    bar = 64
    canvas = Image.new("RGB", (img.width, img.height + bar), bg)
    canvas.paste(img, (0, bar))
    ImageDraw.Draw(canvas).text((20, 10), text, fill=color, font=font(36))
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--remotion-still", required=True)
    ap.add_argument("--hf-still", required=True)
    ap.add_argument("--remotion-mp4")
    ap.add_argument("--hf-mp4")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    r, h = load(a.remotion_still), load(a.hf_still)
    stats, d = diff_stats(r, h)
    summary = {"still": stats}

    # sheet: Remotion | HyperFrames | diff heatmap (x8)
    ri = Image.fromarray(r.astype(np.uint8)).resize((960, 540), Image.LANCZOS)
    hi = Image.fromarray(h.astype(np.uint8)).resize((960, 540), Image.LANCZOS)
    heat = np.clip(d * 8, 0, 255).astype(np.uint8)
    di = Image.fromarray(heat).convert("RGB").resize((960, 540), Image.LANCZOS)
    tiles = [
        label(ri, "Remotion 4.0.484 · Main60 f1688 (CTA f23)"),
        label(hi, "HyperFrames 0.8.108 · CTA t=0.767s (f23)"),
        label(di, f"|diff|x8 · mean {stats['mean_abs']} · max {stats['max_abs']}"),
    ]
    sheet = Image.new("RGB", (960 * 3 + 40, tiles[0].height + 20), (40, 40, 40))
    for i, t in enumerate(tiles):
        sheet.paste(t, (10 + i * 970, 10))
    sheet.save(out / "sheet.png")

    # 200% crops: logo, slogan+lead (caption), panel bottom-right edge/shadow
    regions = {
        "logo": (640, 225, 1280, 390),
        "slogan+lead": (680, 445, 1240, 645),
        "panel edge+shadow": (1440, 860, 1620, 980),
    }
    rows = []
    for name, (x0, y0, x1, y1) in regions.items():
        cw, ch = (x1 - x0) * 2, (y1 - y0) * 2
        rc = Image.fromarray(r[y0:y1, x0:x1].astype(np.uint8)).resize((cw, ch), Image.NEAREST)
        hc = Image.fromarray(h[y0:y1, x0:x1].astype(np.uint8)).resize((cw, ch), Image.NEAREST)
        row = Image.new("RGB", (cw * 2 + 30, ch + 64), (40, 40, 40))
        row.paste(label(rc, f"Remotion · {name} 200%"), (0, 0))
        row.paste(label(hc, f"HyperFrames · {name} 200%"), (cw + 30, 0))
        rows.append(row)
        sub, _ = diff_stats(r[y0:y1, x0:x1], h[y0:y1, x0:x1])
        summary.setdefault("crops", {})[name] = sub
    crops = Image.new("RGB", (max(x.width for x in rows), sum(x.height + 20 for x in rows)), (40, 40, 40))
    y = 0
    for row in rows:
        crops.paste(row, (0, y))
        y += row.height + 20
    crops.save(out / "crops-200.png")

    if a.remotion_mp4 and a.hf_mp4:
        fr, fh = frames(a.remotion_mp4), frames(a.hf_mp4)
        n = min(len(fr), len(fh))
        per = [float(np.abs(fr[i].astype(np.int16) - fh[i].astype(np.int16)).mean()) for i in range(n)]
        worst = int(np.argmax(per))
        summary["mp4"] = {
            "frames": [len(fr), len(fh)],
            "mean_abs_all": round(float(np.mean(per)), 3),
            "mean_abs_f23": round(per[23], 3) if n > 23 else None,
            "worst_frame": worst,
            "worst_mean_abs": round(per[worst], 3),
            "per_frame_every10": [round(per[i], 2) for i in range(0, n, 10)],
        }
        summary["audio_rms_db_per_0.5s"] = {"remotion": audio_rms(a.remotion_mp4), "hf": audio_rms(a.hf_mp4)}
    (out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
