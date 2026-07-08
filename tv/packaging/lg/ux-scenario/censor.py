#!/usr/bin/env python3
"""Censor broadcaster logos / channel names / playlist URLs in the raw
screenshots by repainting each poster tile as the app's own blank placeholder
tile and masking the Accounts URLs. Output -> screenshots/clean/*-clean.png.

Detection: within a per-image content band, poster tiles are brighter than the
near-black gaps between them, so column/row brightness projections recover the
tile grid regardless of what logo sits inside each tile. Every detected cell is
repainted with the sampled empty-tile fill; caption strips below each row are
painted back to background; the top-left (focused) cell keeps a cyan outline.

Run:  python3 censor.py   (needs Pillow)
"""
import os
from PIL import Image, ImageDraw, ImageFilter

def blur_box(im, box, radius):
    x0, y0, x1, y1 = [int(v) for v in box]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(im.size[0], x1), min(im.size[1], y1)
    if x1 <= x0 or y1 <= y0:
        return
    reg = im.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(radius))
    im.paste(reg, (x0, y0))

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.abspath(os.path.join(HERE, ".."))  # tv/packaging/lg
SRC = os.path.join(SHOTS, "screenshots")
OUT = os.path.join(SRC, "clean")
os.makedirs(OUT, exist_ok=True)

BG   = (11, 14, 25)     # app background
FILL = (21, 26, 45)     # empty-tile fill
BORD = (46, 56, 82)     # tile border
CYAN = (101, 208, 234)  # focus outline

# per-image config: content band (fraction of H) where the poster grid lives,
# and the caption strip height (fraction of H) painted out under each tile row.
CFG = {
    "05-movies.png":          dict(top=0.30, bot=0.99, cap=0.045, focus=True),
    "06-series.png":          dict(top=0.28, bot=0.99, cap=0.045, focus=True),
    "07-allmovies.png":       dict(top=0.30, bot=0.99, cap=0.045, focus=True),
    "08-allseries.png":       dict(top=0.30, bot=0.99, cap=0.045, focus=True),
    "09-home-favorites.png":  dict(top=0.28, bot=0.99, cap=0.050, focus=True),
    # 10 is scrolled: one big Watch-History tile (Pluto logo). Repaint it explicitly.
    "10-home-watch-history.png": dict(boxes=[(73, 707, 532, 1396)], cap_boxes=[(55, 575, 440, 625), (60, 1400, 540, 1445)]),
}

def bands(vals, thr, minspan):
    out, inr, start = [], False, 0
    for i, v in enumerate(vals):
        b = v > thr
        if b and not inr: start, inr = i, True
        if not b and inr:
            if i - start >= minspan: out.append((start, i))
            inr = False
    if inr and len(vals) - start >= minspan: out.append((start, len(vals)))
    return out

def repaint_grid(im, cfg):
    W, H = im.size
    px = im.load()
    rad0 = max(6, int(W * 0.006))
    # explicit-box mode (sparse layouts like the scrolled Home)
    R = max(20, int(W * 0.016))   # tile blur strength
    capR = max(12, int(H * 0.012))  # caption/title blur strength
    if cfg.get("boxes"):
        for box in cfg["boxes"]:
            blur_box(im, box, R)
        for box in cfg.get("cap_boxes", []):
            blur_box(im, box, capR)
        return len(cfg["boxes"]), 1
    y0, y1 = int(cfg["top"] * H), int(cfg["bot"] * H)
    # brightness mask (brighter than the near-black gaps)
    def bright(x, y):
        r, g, b = px[x, y]; return (r + g + b) > 78
    step = 3
    # column bands (project over the content band)
    col = [0] * W
    for x in range(0, W, 1):
        c = 0
        for y in range(y0, y1, step):
            if bright(x, y): c += 1
        col[x] = c
    cthr = 0.18 * max(col)
    cols = [c for c in bands(col, cthr, int(W * 0.045))]
    # row bands
    row = [0] * H
    for y in range(y0, y1, 1):
        c = 0
        for x in range(0, W, step):
            if bright(x, y): c += 1
        row[y] = c
    rthr = 0.30 * max(row[y0:y1]) if max(row[y0:y1]) else 1
    rows = [r for r in bands(row[y0:y1], rthr, int(H * 0.06))]
    rows = [(a + y0, b + y0) for a, b in rows]
    cellw = cols[0][1] - cols[0][0] if cols else 0
    gap = (cols[1][0] - cols[0][1]) if len(cols) > 1 else int(cellw * 0.12)
    bl = max(3, int(H * 0.006))  # bleed so no logo sliver peeks past the tile edge
    for (ry0, ry1) in rows:
        for (cx0, cx1) in cols:
            blur_box(im, (cx0, ry0 - bl, cx1, ry1 + bl), R)
        # partial tile scrolled off the right edge
        pxr = cols[-1][1] + gap
        if pxr < W - int(cellw * 0.15):
            blur_box(im, (pxr, ry0 - bl, W, ry1 + bl), R)
        # blur the caption / title strip below this row (channel names)
        ch = int(cfg.get("cap", 0.045) * H)
        if ch:
            blur_box(im, (cols[0][0], ry1 + 2, W, ry1 + ch), capR)
    return len(rows), len(cols)

def censor_accounts(im):
    """Blur the two playlist URLs on the Accounts modal; keep everything else."""
    # URL text regions (measured on 2558x1444), covering the wrapped lines
    for box in [(985, 288, 1385, 358), (985, 428, 1385, 460)]:
        blur_box(im, box, 12)
    return im

for name, cfg in CFG.items():
    im = Image.open(os.path.join(SRC, name)).convert("RGB")
    r, c = repaint_grid(im, cfg)
    dst = os.path.join(OUT, name.replace(".png", "-clean.png"))
    im.save(dst)
    print(f"{name}: {r} rows x {c} cols -> {os.path.basename(dst)}")

im = Image.open(os.path.join(SRC, "11-accounts.png")).convert("RGB")
censor_accounts(im).save(os.path.join(OUT, "11-accounts-clean.png"))
print("11-accounts.png: URLs masked -> 11-accounts-clean.png")
print("done ->", OUT)
