# Cuts the spitter acid sheet: left = projectile flying (8 directions x 6 frames, growing),
# right = impact (6 frames: splash -> puddle; all rows are the same, so row 1 is used).
#   client/assets/sprites/fx/acid-fly.png    (8 rows: down, downRight, right, upRight, up, upLeft, left, downLeft)
#   client/assets/sprites/fx/acid-splash.png (1 row x 6 frames; frame 6 = the puddle)
# Usage: python3 tools/extract-acid.py tools/art/spitter-acid.png
import sys, os, json, importlib.util
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py'))
xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)

src = np.array(Image.open(sys.argv[1]).convert('RGB')).astype(int)
H, W, _ = src.shape
# paint out the thin dark table lines (rows/columns that are mostly dark) so frames separate cleanly
dark = src.max(2) < 110
for y in range(H):
    if dark[y].mean() > .45: src[y] = (255, 0, 255)
for x in range(W):
    if dark[:, x].mean() > .45: src[:, x] = (255, 0, 255)
STD = {'D': 0, 'DR': 1, 'R': 2, 'UR': 3, 'U': 4, 'UL': 5, 'L': 6, 'DL': 7}
ORDER = ['U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL']
out_dir = os.path.join(here, '..', 'client', 'assets', 'sprites', 'fx'); os.makedirs(out_dir, exist_ok=True)

def cutout(region, scale, cell, outline=True):
    fg = xd.foreground(region)
    fg = ndimage.binary_opening(fg, iterations=1)
    ys, xs = np.where(fg)
    if not len(ys): return None
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub = fg[y0:y1, x0:x1]; rgb = region[y0:y1, x0:x1].copy()
    pink = (rgb[..., 0] - rgb[..., 1] > 22) & (rgb[..., 2] - rgb[..., 1] > 22)   # magenta-tinted fringe/fumes -> acid green
    rgb[pink & sub] = (150, 200, 40)
    rgba = np.zeros(sub.shape + (4,), np.uint8); rgba[..., :3] = np.clip(rgb, 0, 255); rgba[..., 3] = sub * 255
    img = Image.fromarray(rgba)
    img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    a = np.array(img); a[..., 3] = (a[..., 3] > 100) * 255
    img = Image.fromarray(a)
    c = Image.new('RGBA', cell); c.alpha_composite(img, ((cell[0] - img.width) // 2, (cell[1] - img.height) // 2)); return c

# rows: find the 8 bands of the left half by gaps
left = src[80:, 120:810]; fgL = xd.foreground(left)
rows = xd.squeeze(xd.runs_of(fgL.sum(1) > 1, 8, 15), 8)
assert len(rows) == 8, rows
FLY = (64, 64); fly = Image.new('RGBA', (FLY[0] * 6, FLY[1] * 8))
for ri, (ya, yb) in enumerate(rows):
    band = left[max(0, ya - 4):yb + 4]
    cols = xd.squeeze(xd.runs_of(xd.foreground(band).sum(0) > 1, 10, 6), 6)
    for ci, (xa, xb) in enumerate(cols[:6]):
        f = cutout(band[:, max(0, xa - 3):xb + 3], 0.55, FLY)
        if f: fly.alpha_composite(f, (ci * FLY[0], STD[ORDER[ri]] * FLY[1]))
fly.save(os.path.join(out_dir, 'acid-fly.png'))
# impact: first row of the right half
right = src[80 + rows[0][0] - 6: 80 + rows[0][1] + 10, 820:W]
cols = xd.squeeze(xd.runs_of(xd.foreground(right).sum(0) > 1, 8, 6), 6)
SPL = (120, 60); spl = Image.new('RGBA', (SPL[0] * 6, SPL[1]))
for ci, (xa, xb) in enumerate(cols[:6]):
    f = cutout(right[:, max(0, xa - 3):xb + 3], 1.0, SPL)
    if f: spl.alpha_composite(f, (ci * SPL[0], 0))
spl.save(os.path.join(out_dir, 'acid-splash.png'))
print('acid ->', os.path.relpath(out_dir), '(fly 8x6 @64px, splash 6 @120x60)')
