# Cuts Viktor's extra sheets (his walk/shoot/knife use extract-directions.py; turret + robots use extract-zombie-dirs.py):
#   fx/turret-deploy.png   6 frames (floor plate -> ready)       fx/turret-dead.png  4 frames (sparks -> wreck)
#   fx/robots-dead.png     3 rows (assault, support, hunter) x 4 frames
#   fx/viktor-fx.png       4 rows x 6: red laser + impact, blue heal ring, blue shield bubble, orange summon flash
#   icons/heavyTurret.png, icons/robotSquad.png
# Usage: python3 tools/extract-viktor.py
import os, importlib.util
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py'))
xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)
C = os.path.join(here, '..', 'client', 'assets'); FX = os.path.join(C, 'sprites', 'fx')

def load(n): return np.array(Image.open(os.path.join(here, 'art', n + '.png')).convert('RGB')).astype(int)

def rgba(src, glow=None):
    """Cut out the magenta. glow=(r,g,b) multipliers: keep magenta-blended glow pixels, recoloured."""
    fg = xd.foreground(src); r, g, b = src[..., 0], src[..., 1], src[..., 2]
    tint = (r - g > 25) & (b - g > 25)
    if glow is not None: fg |= tint & (g > 70)
    fg = ndimage.binary_opening(fg, iterations=1) | (fg & ~tint)
    out = src.copy()
    p = fg & tint
    if glow is not None:
        v = out[p].max(1, keepdims=True).astype(float); out[p] = np.clip(v * np.array(glow), 0, 255).astype(int)
    else: out[p] = (out[p] * .35).astype(int)
    a = np.zeros(src.shape[:2] + (4,), np.uint8); a[..., :3] = np.clip(out, 0, 255); a[..., 3] = fg * 255
    if glow is not None: a[..., 3][p] = np.clip((src[p][:, 1] - 50) * 2.4 + 70, 70, 255).astype(np.uint8)
    return a

def frames_in(band, n):
    occ = xd.foreground(band).sum(0) > 1
    runs = xd.squeeze(xd.runs_of(occ, 14, 8), n)
    return [[0 if i == 0 else (runs[i - 1][1] + runs[i][0]) // 2, band.shape[1] if i == n - 1 else (runs[i][1] + runs[i + 1][0]) // 2] for i in range(len(runs))]

def sheet(src, rows, nper, cell, scale, out, glow=None, bottom=True, rowglow=None):
    S = Image.new('RGBA', (cell[0] * max(nper), cell[1] * len(rows)))
    for ri, (y0, y1) in enumerate(rows):
        band = src[max(0, y0 - 8):y1 + 8]
        for ci, (xa, xb) in enumerate(frames_in(band, nper[ri])):
            a = rgba(band[:, xa:xb], (rowglow[ri] if rowglow else glow))
            ys, xs = np.where(a[..., 3] > 0)
            if not len(ys): continue
            img = Image.fromarray(a[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
            img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
            arr = np.array(img); arr[..., 3] = np.where(arr[..., 3] > 60, arr[..., 3], 0); img = Image.fromarray(arr)
            x = ci * cell[0] + (cell[0] - img.width) // 2
            y = ri * cell[1] + (cell[1] - 6 - img.height if bottom else (cell[1] - img.height) // 2)
            S.alpha_composite(img, (x, max(ri * cell[1], y)))
    S.save(os.path.join(FX, out)); print(out, S.size)

rows_of = lambda src, n, gap=20: xd.squeeze(xd.runs_of(xd.foreground(src).sum(1) > 2, gap, 20), n)
# turret deploy (6) + destroyed (4): same scale as the turret sheet (0.624 of the sheet's art at 82px height)
dp = load('viktor-turret-deploy'); r = rows_of(dp, 2)
sheet(dp, [r[0]], [6], (170, 130), .47 * 77 / 127, 'turret-deploy.png', glow=(1.0, .7, .3))
sheet(dp, [r[1]], [4], (170, 130), .47 * 77 / 127, 'turret-dead.png', glow=(.55, .55, .55))
rd = load('viktor-robots-dead'); r = rows_of(rd, 3)
sheet(rd, r, [4, 4, 4], (110, 90), .30, 'robots-dead.png', glow=(.55, .55, .55))
fx = load('viktor-fx'); r = rows_of(fx, 4, 30)
sheet(fx, r, [6, 6, 6, 6], (180, 110), .62, 'viktor-fx.png', bottom=False,
      rowglow=[(1.0, .35, .25), (.45, .8, 1.0), (.45, .8, 1.0), (1.0, .75, .3)])
# icons: two objects, square
ic = load('viktor-icons'); a = rgba(ic)
lab, n = ndimage.label(a[..., 3] > 0); sizes = ndimage.sum(a[..., 3] > 0, lab, range(1, n + 1))
cols = xd.squeeze(xd.runs_of((a[..., 3] > 0).sum(0) > 2, 30, 30), 2)
for (x0, x1), name in zip(cols, ['heavyTurret', 'robotSquad']):
    part = a[:, x0:x1]; ys, xs = np.where(part[..., 3] > 0); part = part[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    img = Image.fromarray(part); k = 58 / max(img.size)
    img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    arr = np.array(img); arr[..., 3] = (arr[..., 3] > 100) * 255
    can = Image.new('RGBA', (64, 64)); can.alpha_composite(Image.fromarray(arr), ((64 - img.width) // 2, (64 - img.height) // 2))
    can.save(os.path.join(C, 'icons', name + '.png')); print('icon', name)
