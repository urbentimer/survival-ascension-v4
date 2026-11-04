# Sofea's helicopter machine gun effects (ChatGPT sheets on magenta, tools/art/sofea-gun):
#   python3 tools/extract-heli-gun.py tools/art/sofea-gun
# Writes sprites/fx/sofea-gun.webp, 8 frames per row:
#   row 0 muzzle flash  cells 128x64   (muzzle-grow.png, 1 row x 8)       the barrel tip = cell (6, 32); it blasts to the RIGHT
#   row 1 tracer burst  cells 192x40   (flash-tracer-impact.png row 2)     streaks fly RIGHT; the client stretches it muzzle -> target
#   row 2 bullet impact cells 96x72    (flash-tracer-impact.png row 3)     dust + sparks, bottom-centre = cell (48, 66)
# Glow / smoke painted over the magenta is un-mixed (alpha from how far a pixel is from magenta), so it stays see-through.
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage
root = sys.argv[1] if len(sys.argv) > 1 else 'tools/art/sofea-gun'
here = os.path.dirname(os.path.abspath(__file__)); A = os.path.join(here, '..', 'client', 'assets')

def unmix(path):
    a = np.array(Image.open(os.path.join(root, path)).convert('RGB')).astype(float) / 255; r, g, b = a[..., 0], a[..., 1], a[..., 2]
    al = np.clip(1 - np.clip(np.minimum(r, b) - g, 0, 1) * 1.08, 0, 1)
    al[(r > .85) & (b > .85) & (g < .25)] = 0; al[al < .08] = 0
    col = np.clip((a - (1 - al)[..., None] * np.array([1, 0, 1])) / np.maximum(al, 1e-3)[..., None], 0, 1)
    col[..., 2] = np.minimum(col[..., 2], np.maximum(col[..., 1], col[..., 0] * .55))   # no pink / purple left
    lum = col.max(-1); pinkish = np.clip((col[..., 2] - col[..., 1] * .55) / .2, 0, 1)    # fire has almost no blue; pink-ish or dim = smoke
    smoke = np.maximum(np.clip((.62 - lum) / .25, 0, 1), pinkish)[..., None]   # -> grey-brown
    grey = col.mean(-1, keepdims=True) * np.array([1.0, .93, .85])
    col = col * (1 - smoke * .85) + grey * smoke * .85
    return np.dstack([col * 255, al * 255]).astype(np.uint8)

def frames(rgba, rows, cols, row):   # one row of an even grid -> list of (image, bbox) cut from fixed column windows
    H, W = rgba.shape[:2]; ph, pw = H / rows, W / cols; out = []
    y0, y1 = round(row * ph), round((row + 1) * ph)
    for c in range(cols):
        cell = rgba[y0:y1, round(c * pw):round((c + 1) * pw)]; m = cell[..., 3] > 25
        ys, xs = np.where(m); out.append((cell, (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)))
    return out

def row_atlas(fr, cw, ch, anchor, fit):
    sc = min((cw - 8) / max(b[2] - b[0] for _, b in fr), (ch - 6) / max(b[3] - b[1] for _, b in fr)) * fit
    strip = Image.new('RGBA', (cw * len(fr), ch))
    cy = np.mean([(b[1] + b[3]) / 2 for _, b in fr])   # the row's centre line (all frames sit on it)
    for i, (cell, (x0, y0, x1, y1)) in enumerate(fr):
        im = Image.fromarray(np.ascontiguousarray(cell[y0:y1, x0:x1])); im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
        if anchor == 'tip': px, py = 6, round(ch / 2 - (cy - y0) * sc)           # left tip at x=6, the shared centre line at mid-height
        elif anchor == 'centre': px, py = (cw - im.width) // 2, round(ch / 2 - (cy - y0) * sc)
        else: px, py = (cw - im.width) // 2, ch - 6 - im.height                    # bottom
        strip.alpha_composite(im, (i * cw + max(0, px), max(0, py)))
    return strip, sc

ROWS = [(128, 64), (192, 40), (96, 72)]
atlas = Image.new('RGBA', (max(w for w, _ in ROWS) * 8, sum(h for _, h in ROWS)))
mz = unmix('muzzle-grow.png'); fti = unmix('flash-tracer-impact.png')
oy = 0
for (cw, ch), (src, rows, row, anchor, fit) in zip(ROWS, [(mz, 1, 0, 'tip', 1), (fti, 3, 1, 'tip', 1), (fti, 3, 2, 'bottom', 1)]):
    strip, sc = row_atlas(frames(src, rows, 8, row), cw, ch, anchor, fit); atlas.alpha_composite(strip, (0, oy)); print(f'row y={oy}: {cw}x{ch} scale {sc:.3f}'); oy += ch
p = os.path.join(A, 'sprites', 'fx', 'sofea-gun.webp'); atlas.save(p, quality=88, method=6)
print('->', p, os.path.getsize(p) // 1024, 'KB')
