# Cuts Raven's (Scout) effect sheets and skill cards. Her katana/gun/flaming-katana atlas uses extract-directions.py,
# her Shadow Pass dash uses extract-zombie-dirs.py (see the notes at the bottom).
#   fx/raven-shadow.png  5 rows x 4: activation ring, purple slash arc, afterimage, vanish, reappear   (140x100 cells)
#   fx/raven-fire.png    4 rows: ignite burst (5), fire slash arc (4), burning loop (6), burn out (4)  (120x90 cells)
#   icons/card-shadowPass.png, icons/card-bladeStorm.png
# Usage: python3 tools/extract-raven.py
import os, importlib.util
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py'))
xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)
C = os.path.join(here, '..', 'client', 'assets'); FX = os.path.join(C, 'sprites', 'fx')
load = lambda n: np.array(Image.open(os.path.join(here, 'art', n + '.png')).convert('RGB')).astype(int)

def rgba(part, glow):
    fg = xd.foreground(part); r, g, b = part[..., 0], part[..., 1], part[..., 2]
    tint = (r - g > 25) & (b - g > 25)                       # glow blended into the magenta: keep, recolour, see-through
    bg = (r > 205) & (b > 205) & (g < 95) & (abs(r - b) < 45)              # the magenta itself (purple smoke is darker / bluer)
    fg |= tint & ~bg
    out = part.copy(); p = tint & fg
    v = out[p].max(1, keepdims=True).astype(float); out[p] = np.clip(v * np.array(glow), 0, 255).astype(int)
    a = np.zeros(part.shape[:2] + (4,), np.uint8); a[..., :3] = np.clip(out, 0, 255); a[..., 3] = fg * 255
    dist = np.sqrt(((part[p] - np.array([255, 0, 255])) ** 2).sum(1))      # further from magenta = more solid
    a[..., 3][p] = np.clip(dist * 1.6, 40, 245).astype(np.uint8)
    return a

def sheet(name, counts, scales, cell, out, glow, rowglow=None):
    src = load(name); r, g, b = src[..., 0], src[..., 1], src[..., 2]
    ink = xd.foreground(src) | ((r - g > 25) & (b - g > 25) & (g > 45) & ~((r > 225) & (g < 45) & (b > 225)))
    rows = xd.squeeze(xd.runs_of(ink.sum(1) > 1, 25, 6), len(counts)); print(name, rows)
    S = Image.new('RGBA', (cell[0] * max(counts), cell[1] * len(counts)))
    for ri, ((y0, y1), n) in enumerate(zip(rows, counts)):
        band = src[max(0, y0 - 10):y1 + 10]
        W = band.shape[1]; bink = ink[max(0, y0 - 10):y1 + 10]
        runs = xd.squeeze(xd.runs_of(bink.sum(0) > 0, 30, 4), n)          # the gaps between frames, if they're clear
        if len(runs) == n: bounds = [[0 if i == 0 else (runs[i - 1][1] + runs[i][0]) // 2, W if i == n - 1 else (runs[i][1] + runs[i + 1][0]) // 2] for i in range(n)]
        else: bounds = [[round(i * W / n), round((i + 1) * W / n)] for i in range(n)]   # otherwise: evenly spaced
        for ci, (xa, xb) in enumerate(bounds):
            a = rgba(band[:, xa:xb], (rowglow or {}).get(ri, glow)); ys, xs = np.where(a[..., 3] > 0)
            if not len(ys): continue
            img = Image.fromarray(a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]); k = scales[ri]
            img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
            img = img.crop((max(0, (img.width - cell[0]) // 2), max(0, img.height - cell[1]), max(0, (img.width - cell[0]) // 2) + min(img.width, cell[0]), img.height))
            S.alpha_composite(img, (ci * cell[0] + (cell[0] - img.width) // 2, ri * cell[1] + cell[1] - 4 - img.height))
    S.save(os.path.join(FX, out)); print(out, S.size)

PURPLE, FIRE = (.8, .5, 1.0), (1.0, .55, .2)
sheet('raven-shadow-fx', [4, 4, 4, 4, 4], [.30, .32, .42, .34, .32], (140, 100), 'raven-shadow.png', PURPLE)
sheet('raven-fire-fx', [5, 4, 6, 4], [.30, .30, .26, .26], (120, 90), 'raven-fire.png', FIRE, rowglow={0: (.85, .5, 1.0)})
cards = Image.open(os.path.join(here, 'art', 'raven-cards.png')).convert('RGB')
for name, box in [('shadowPass', (24, 40, 863, 845)), ('bladeStorm', (911, 40, 1750, 845))]:
    cards.crop(box).resize((152, 152), Image.LANCZOS).save(os.path.join(C, 'icons', f'card-{name}.png')); print('card', name)
# Atlas + dash (run these too when the sheets change):
#   python3 tools/extract-directions.py scout gun=tools/art/raven-gun.png katana=tools/art/raven-katana.png%219x149.9 fire=tools/art/raven-fire-katana.png%219x149.9
#   python3 tools/extract-zombie-dirs.py raven-dash tools/art/raven-dash.png rows=D,DR,R,UR,U,UL,L,DL cols=4 pitch=280 height=44 refcol=0 cellw=150 cellh=100

# Dante's Demo Ripple pieces: crate burst (6), grenade flying right (4), landing marker (3), big explosion (6), small explosion (5), smoke + scorch (4)
if __name__ == '__main__':
    sheet('dante-demo-fx', [6, 4, 3, 6, 5, 4], [.42, .32, .30, .40, .32, .32], (130, 110), 'dante-demo.png', (1.0, .45, .3))
