# Barricade in 8 facings (Nov 7), from the user's ChatGPT sheet tools/art/objects/barricade-8dir.png (2 rows x 4, pure black background):
#   row 1: D (horizontal), DR ("/"), R (vertical), DL ("\")      row 2: U (horizontal), UR ("\"), L (vertical), UL ("/")
#   (the line is built ACROSS the way you face, so facing down-right gives a "/" line)
# Writes client/assets/sprites/objects/barricade-<r|dr|d|dl|l|ul|u|ur>.png: 110x110 cells, the sprite centred in the cell
# (the client draws the cell's bottom 45px below the structure's centre, so the posts' feet sit about 20px below it, as before). One scale for all (the horizontal one comes out 96px wide, like before).
import os
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(here, '..', 'client', 'assets', 'sprites', 'objects')
a = np.array(Image.open(os.path.join(here, 'art', 'objects', 'barricade-8dir.png')).convert('RGB')).astype(int)
fg = a.max(2) > 16; lab, n = ndimage.label(fg); sz = ndimage.sum(fg, lab, range(1, n + 1)); fg = np.isin(lab, [i + 1 for i in range(n) if sz[i] >= 40])   # black (also between the planks) -> see-through

def runs(occ, n):
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
NAMES = [['d', 'dr', 'r', 'dl'], ['u', 'ur', 'l', 'ul']]
cells = {}
for ri, (y0, y1) in enumerate(runs(fg.any(1), 2)):
    for ci, (x0, x1) in enumerate(runs(fg[y0:y1].any(0), 4)):
        m = fg[y0:y1, x0:x1]; ys, xs = np.where(m); m = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        rgb = a[y0 + ys.min():y0 + ys.max() + 1, x0 + xs.min():x0 + xs.max() + 1]
        cells[NAMES[ri][ci]] = np.dstack([rgb, m * 255]).astype(np.uint8)
SC = 96 / cells['d'].shape[1]
for k, rgba in cells.items():
    im = Image.fromarray(rgba); im = im.resize((round(im.width * SC), round(im.height * SC)), Image.LANCZOS)
    q = np.array(im); q[..., 3] = np.where(q[..., 3] > 110, 255, 0); im = Image.fromarray(q)
    cell = Image.new('RGBA', (110, 110)); cell.alpha_composite(im, ((110 - im.width) // 2, (110 - im.height) // 2))
    cell.save(os.path.join(OUT, f'barricade-{k}.png')); print(k, im.size)
