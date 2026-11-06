# Barricade + electric fence in 8 facings (Nov 7), from the user's ChatGPT sheets (2 rows x 4, pure black background):
#   tools/art/objects/barricade-8dir.png, fence-8dir.png
#   row 1: D (horizontal), DR ("/"), R (vertical), DL ("\")      row 2: U (horizontal), UR ("\"), L (vertical), UL ("/")
#   (the line is built ACROSS the way you face, so facing down-right gives a "/" line)
# Writes client/assets/sprites/objects/<barricade|fence>-<r|dr|d|dl|l|ul|u|ur>.png: 110x110 cells, the sprite centred in the cell
# (the client draws the cell's bottom 45px below the structure's centre). One scale for all (the horizontal one is 96px wide), then the
# horizontal + diagonal ones are squashed to 72% height so they're shorter than the survivors (the vertical ones keep their height:
# that's their length); the squashed sprite keeps its bottom where it was, so the posts' feet don't move.
# The fence's electric glow (blue on black) is kept see-through: alpha from its brightness. Run: python3 tools/extract-line8.py
import os
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(here, '..', 'client', 'assets', 'sprites', 'objects')
NAMES = [['d', 'dr', 'r', 'dl'], ['u', 'ur', 'l', 'ul']]
SQUASH = .72

def runs(occ, n):   # the n runs of occupied pixels (closest runs merged until there are n)
    r, x = [], 0
    while x < len(occ):
        if occ[x]:
            s = x
            while x < len(occ) and occ[x]: x += 1
            r.append([s, x])
        x += 1
    while len(r) > n:
        g = [r[i + 1][0] - r[i][1] for i in range(len(r) - 1)]; i = int(np.argmin(g)); r[i][1] = r[i + 1][1]; del r[i + 1]
    return r

def extract(name, glow):
    a = np.array(Image.open(os.path.join(here, 'art', 'objects', f'{name}-8dir.png')).convert('RGB')).astype(float); mx = a.max(2)
    fg = mx > 16; lab, n = ndimage.label(fg); sz = ndimage.sum(fg, lab, range(1, n + 1)); fg = np.isin(lab, [i + 1 for i in range(n) if sz[i] >= 40])   # black (also between the planks) -> see-through
    alpha = fg * 255.0; rgb = a.copy()
    if glow:   # blue glow on black: alpha from brightness, colour un-darkened
        blue = fg & (a[..., 2] > a[..., 0] + 30) & (a[..., 2] > a[..., 1] + 20)
        k = np.clip(mx / 170, 0, 1); alpha = np.where(blue, k * 255, alpha)
        rgb = np.where(blue[..., None], np.clip(a / np.maximum(k, 1e-3)[..., None], 0, 255), a)
    cells = {}
    for ri, (y0, y1) in enumerate(runs(fg.any(1), 2)):
        for ci, (x0, x1) in enumerate(runs(fg[y0:y1].any(0), 4)):
            ys, xs = np.where(fg[y0:y1, x0:x1]); sl = (slice(y0 + ys.min(), y0 + ys.max() + 1), slice(x0 + xs.min(), x0 + xs.max() + 1))
            cells[NAMES[ri][ci]] = np.dstack([rgb[sl], alpha[sl]]).astype(np.uint8)
    sc = 96 / cells['d'].shape[1]
    for k, rgba in cells.items():
        im = Image.fromarray(rgba); full_h = round(im.height * sc); sq = 1 if k in ('r', 'l') else SQUASH
        im = im.resize((round(im.width * sc), round(im.height * sc * sq)), Image.LANCZOS)
        q = np.array(im)
        q[..., 3] = np.where(q[..., 3] > 110, 255, 0) if not glow else np.where(q[..., 3] > 200, 255, np.where(q[..., 3] < 25, 0, q[..., 3]))
        cell = Image.new('RGBA', (110, 110)); im = Image.fromarray(q); cell.alpha_composite(im, ((110 - im.width) // 2, (110 - full_h) // 2 + full_h - im.height))
        cell.save(os.path.join(OUT, f'{name}-{k}.png')); print(name, k, im.size)

extract('barricade', False)
extract('fence', True)
