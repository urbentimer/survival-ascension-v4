# Sofea's mecha lightsaber slash (user's sheet, tools/art/saber-slash/slash.png: 2 rows x 4 frames of a green energy arc on a
# baked-in light checkerboard). The glow is un-mixed from the white background (alpha = how far a pixel is from white).
#   python3 tools/extract-saber-slash.py
# Writes client/assets/sprites/fx/sofea-slash.webp: 8 frames, cells 256x256. The arc bulges UP (toward the swing direction);
# the swing's pivot (her shoulder) = cell (128, PIVOT_Y), printed below; the arc's top is ~REACH px above the pivot.
import os
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(here, 'art', 'saber-slash', 'slash.png')
OUT = os.path.join(here, '..', 'client', 'assets', 'sprites', 'fx', 'sofea-slash.webp')
C = 256
a = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32) / 255
al = np.clip((1 - a.min(-1) - .09) / .91 * 1.15, 0, 1)            # white / light grey checkerboard -> 0
col = np.clip((a - (1 - al)[..., None]) / np.maximum(al, 1e-3)[..., None], 0, 1)
col[..., 1] = np.maximum(col[..., 1], col[..., 0] * .9)            # keep it green / lime, no muddy brown
# the white-hot core and sparkle centres are as white as the background, so the un-mix makes them holes: fill the holes
# that are surrounded by glow (a grey closing of the alpha) and colour them white-hot
from scipy import ndimage
near = ndimage.binary_dilation(al > .45, iterations=6)                       # right next to strong glow
hole = (al < .3) & near & (a.min(-1) > .9)                                     # ...but as white as the paper: the hot core
hole = ndimage.binary_opening(hole, iterations=1) | (hole & ndimage.binary_dilation(al > .6, iterations=2))
soft = ndimage.gaussian_filter(hole.astype(np.float32), 1.2)
al = np.maximum(al, np.clip(soft * 1.4, 0, .95))
col = col * (1 - soft[..., None]) + np.array([.9, 1, .8]) * soft[..., None]
rgba = np.dstack([np.clip(col, 0, 1), al]) * 255
H, W = a.shape[:2]; ph, pw = H / 2, W / 4
S = int(min(ph, pw))
cells = [rgba[round(r * ph):round(r * ph) + S, round(c * pw):round(c * pw) + S] for r in range(2) for c in range(4)]
# one shared placement for all frames (so it doesn't wobble): the union bbox of the fullest frames
m = np.zeros(cells[0].shape[:2], bool)
for c in cells[2:6]: m |= c[..., 3] > 40
ys, xs = np.where(m); x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
cx, pivot = (x0 + x1) / 2, y1 + (y1 - y0) * .15                     # the arc's ends point down at its pivot
sc = (C - 12) / max(x1 - x0, 1)
atlas = Image.new('RGBA', (C * 8, C))
PIVOT_Y = None
for i, c in enumerate(cells):
    im = Image.fromarray(np.ascontiguousarray(c.astype(np.uint8))).resize((round(c.shape[1] * sc), round(c.shape[0] * sc)), Image.LANCZOS)
    ox = round(C / 2 - cx * sc); oy = round(C * .78 - pivot * sc); PIVOT_Y = round(C * .78)
    tmp = Image.new('RGBA', (C * 3, C * 3)); tmp.alpha_composite(im, (C + ox, C + oy)); cell = tmp.crop((C, C, 2 * C, 2 * C))
    atlas.alpha_composite(cell, (i * C, 0))
atlas.save(OUT, quality=80, method=6, alpha_quality=90)
print('->', os.path.relpath(OUT), os.path.getsize(OUT) // 1024, 'KB; pivot', (C // 2, PIVOT_Y), 'reach', round((pivot - y0) * sc), 'px')
