# Marcus's dash body frames (user's ChatGPT sheet, Nov 5): tools/art/marcus-dash.png, 8 rows x 5 columns on flat magenta.
#   rows DOWN, DOWN-RIGHT, RIGHT, UP-RIGHT, UP, UP-LEFT, LEFT, DOWN-LEFT; cols CROUCH, LUNGE, STRETCH, SLIDE (+dust), RECOVER
# The left rows are made by mirroring the right ones (the sheet's left rows kick their dust out in front).
# Scaled like his weapon sheets (same source scale as marcus-v3-gun.png -> 54px body), cells 112x88, feet at (56, 80) = dir8 cells.
#   python3 tools/extract-marcus-dash.py  ->  client/assets/sprites/dir8/assault-dash.webp (5 cols x 8 rows)
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(here, 'art', 'marcus-dash.png'); GUN = os.path.join(here, 'art', 'marcus-v3-gun.png')
OUT = os.path.join(here, '..', 'client', 'assets', 'sprites', 'dir8', 'assault-dash.webp')
CW, CH, AX, FY, COLS, ROWS = 112, 88, 56, 80, 5, 8
MIRROR_OF = {5: 3, 6: 2, 7: 1}

def fg(a):
    r, g, b = [a[..., i].astype(int) for i in range(3)]
    core = (r > 200) & (b > 200) & (g < 90); soft = (r > 140) & (b > 140) & (g < 130) & (abs(r - b) < 110)
    bg = core.copy()
    for _ in range(3): bg = ndimage.binary_dilation(bg) & (core | soft)
    m = ~(bg | core); lab, n = ndimage.label(m); sz = ndimage.sum(m, lab, range(1, n + 1))
    return np.isin(lab, [i + 1 for i in range(n) if sz[i] > 25])

def bands(occ, n):   # n runs of occupied pixels (merge the closest until n)
    runs, x = [], 0
    while x < len(occ):
        if occ[x]:
            s0 = x
            while x < len(occ) and occ[x]: x += 1
            runs.append([s0, x])
        x += 1
    while len(runs) > n:
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]; i = int(np.argmin(gaps)); runs[i][1] = runs[i + 1][1]; del runs[i + 1]
    return runs

def body_heights(path, ncols):   # body heights of the first column's frames (to match scales between sheets)
    a = np.array(Image.open(path).convert('RGB')); m = fg(a)
    rows = bands(m.any(1), 8); hs = []
    for y0, y1 in rows:
        cols = bands(m[y0:y1].any(0), ncols); x0, x1 = cols[-1 if ncols == 5 else 0]
        ys = np.where(m[y0:y1, x0:x1].any(1))[0]; hs.append(ys[-1] - ys[0] + 1)
    return np.median(hs)

a = np.array(Image.open(SRC).convert('RGB')); m = fg(a)
gun_h = body_heights(GUN, 6); dash_h = body_heights(SRC, 5)   # gun idle vs dash RECOVER (both standing)
sc = 54 / gun_h * (gun_h / dash_h if abs(dash_h / gun_h - 1) > .12 else 1)   # same source scale unless the sheet came out at a different size
print(f'gun idle {gun_h:.0f}px, dash recover {dash_h:.0f}px -> scale {sc:.3f}')
atlas = Image.new('RGBA', (CW * COLS, CH * ROWS), (0, 0, 0, 0))
rows = bands(m.any(1), ROWS); assert len(rows) == ROWS, rows
cells = {}
for ri, (y0, y1) in enumerate(rows):
    cols = bands(m[y0:y1].any(0), COLS); assert len(cols) == COLS, (ri, cols)
    for ci, (x0, x1) in enumerate(cols):
        sub = m[y0:y1, x0:x1]; lab, n = ndimage.label(sub); sz = ndimage.sum(sub, lab, range(1, n + 1))
        body = lab == (int(np.argmax(sz)) + 1); ys, xs = np.where(body)
        foot = ys.max(); bx = (xs.min() + xs.max()) / 2   # feet = bottom of the body, x = body centre (dust doesn't move the anchor)
        rgba = np.dstack([a[y0:y1, x0:x1], (sub * 255).astype(np.uint8)])
        im = Image.fromarray(rgba).resize((max(1, round(rgba.shape[1] * sc)), max(1, round(rgba.shape[0] * sc))), Image.LANCZOS)
        q = np.array(im); q[..., 3] = np.where(q[..., 3] > 110, 255, 0); im = Image.fromarray(q)
        cells[(ri, ci)] = (im, round(bx * sc), round(foot * sc))
for ri in range(ROWS):
    for ci in range(COLS):
        src = MIRROR_OF.get(ri); im, bx, foot = cells[(src if src is not None else ri, ci)]
        if src is not None: im = im.transpose(Image.FLIP_LEFT_RIGHT); bx = im.width - bx
        ox, oy = AX - bx, FY - foot
        if ox < 0 or oy < 0 or ox + im.width > CW or oy + im.height > CH: print('  clipped', ri, ci, ox, oy, im.size)
        cell = Image.new('RGBA', (CW, CH)); cell.paste(im, (ox, oy), im); atlas.alpha_composite(cell, (ci * CW, ri * CH))
atlas.save(OUT, quality=88, alpha_quality=90, method=6); print('->', os.path.relpath(OUT), atlas.size, os.path.getsize(OUT) // 1024, 'KB')
