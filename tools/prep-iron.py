# IRON (Nov 16): the user's new tank (replaces Briggs, same skills; internal class id stays "juggernaut") -> ready-to-cut art.
#   python3 tools/prep-iron.py   (first step of tools/cut-iron.sh)
# Sources: tools/art/iron/ (design.png = the locked design; the rest made with tools/art/iron/PROMPTS-FULL.md, one new ChatGPT chat each):
#   1-shotgun 2-knife 3-bat 4-axe 7-gauntlets: 5 rows x 6 cols (229px cells); 5-slam 6-throw 8-power: 5 x 4 (280.5 x 280.4);
#   9-hero (lobby), 10-face; card-boomerang / card-unbreakable / card-bareknuckle / card-passive (simple object cards, no character).
#   5 rows = DOWN, DOWN-RIGHT, RIGHT, UP-RIGHT, UP: extract-directions.py mirrors them for the left side.
# Checked on arrival: every sheet's skin / armour colours are within ~2 Lab units of the design (no colour matching needed, unlike the
# Briggs remake); only a little pink (glow over magenta) at edges -> orange (prep-briggs-remake.py's depink, which this replaces).
# Writes tools/art/iron/prep/*.png, tools/art/hero/juggernaut.png, tools/art/faces/juggernaut.png, client/assets/icons/card-*.png
# (the 4 cards: magenta corners -> black like every other card, 152 x 152) and client/assets/sprites/fx/boomerang.webp (cut from the design).
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(here, 'art', 'iron'); P = os.path.join(R, 'prep'); os.makedirs(P, exist_ok=True)
A = os.path.join(here, '..', 'client', 'assets')
load = lambda n: np.array(Image.open(os.path.join(R, n)).convert('RGB')).astype(int)
save = lambda a, path: Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(path)

def background(a):   # magenta-ish connected to the image's edge
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = ((r > 200) & (b > 200) & (g < 90)) | ((r > 140) & (b > 140) & (g < 130) & (np.abs(r - b) < 110))
    lab, _ = ndimage.label(m); edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return np.isin(lab, list(edge)), m

def depink(a):   # pure-magenta pockets (gaps between arm and body) -> exact #FF00FF; pink glow / fringe inside the art -> orange (same lightness)
    a = a.copy(); r, g, b = a[..., 0], a[..., 1], a[..., 2]; bg, m = background(a)
    inner = m & ~bg; lab, n = ndimage.label(inner); gaps = np.zeros_like(inner)
    for i, sl in enumerate(ndimage.find_objects(lab)):
        reg = lab[sl] == i + 1; mr, mg, mb = a[sl][reg].mean(0)
        if abs(mr - mb) < 22 and mg < 28: gaps[sl] |= reg
    a[gaps] = (255, 0, 255)
    near = ndimage.binary_dilation(bg | gaps, iterations=2)
    pink = ~bg & ~gaps & ~near & (r - g > 60) & (b - g > 25) & (b > 80)
    rr = r[pink]; a[pink] = np.stack([rr, np.maximum(g[pink], (rr * .48).astype(int)), np.minimum(b[pink], (rr * .28).astype(int))], -1)
    return a, int(pink.sum()), int(gaps.sum())

for name in ('1-shotgun', '2-knife', '3-bat', '4-axe', '5-slam', '6-throw', '7-gauntlets', '8-power'):
    a, n1, n2 = depink(load(name + '.png')); save(a, os.path.join(P, name + '.png')); print(f'{name}: {n1} pink px -> orange, {n2} gap px -> background')
for src, dst in (('9-hero.png', os.path.join('hero', 'juggernaut.png')), ('10-face.png', os.path.join('faces', 'juggernaut.png'))):
    a, n1, n2 = depink(load(src)); save(a, os.path.join(here, 'art', dst)); print(f'{src}: {n1} pink px -> orange -> tools/art/{dst}')

# cards: the magenta round the octagon -> black (soft edge kept: alpha from the key, composited on black), 152 x 152, light sharpen
for src, dst in (('card-boomerang.png', 'card-steelBoomerang'), ('card-unbreakable.png', 'card-unbreakable'), ('card-bareknuckle.png', 'card-bareKnuckle'), ('card-passive.png', 'card-forcefulBlast')):
    a = load(src).astype(np.float32); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg, _ = background(a.astype(int)); spill = np.clip(np.minimum(r, b) - g, 0, 255) / 255
    al = np.where(bg, 0, 1 - np.clip((spill - .35) / .5, 0, 1) * ndimage.binary_dilation(bg, iterations=3))
    out = a * al[..., None]
    Image.fromarray(out.clip(0, 255).astype(np.uint8)).resize((152, 152), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.0, percent=70, threshold=2)).save(os.path.join(A, 'icons', dst + '.png'))
print('cards: card-steelBoomerang, card-unbreakable, card-bareKnuckle, card-forcefulBlast')

# the flying boomerang (E): cut from the design sheet (top right), centre of MASS in the middle of a 112px cell (it spins round it)
CELL = 112
d = load('design.png'); c = d[90:400, 1470:]; r, g, b = c[..., 0], c[..., 1], c[..., 2]
fg = ~((r - g > 60) & (b - g > 60) & (np.abs(r - b) < 90)); fg = ndimage.binary_opening(fg, iterations=1)
lab, n = ndimage.label(fg); sz = ndimage.sum(fg, lab, range(1, n + 1)); fg = ndimage.binary_fill_holes(lab == 1 + int(np.argmax(sz)))
pink = fg & (r > g + 18) & (b > g + 18); c = c.copy(); c[..., 2] = np.where(pink, np.minimum(b, (g * .55).astype(int)), b); c[..., 0] = np.where(pink, np.maximum(r, g + 40), r)
ys, xs = np.where(fg); cy, cx = ys.mean(), xs.mean(); half = max(np.abs(xs - cx).max(), np.abs(ys - cy).max()) + 8; side = int(np.ceil(2 * half))
sq = np.zeros((side, side, 4), np.float32); ox, oy = int(round(cx - side / 2)), int(round(cy - side / 2)); rgba = np.dstack([c, fg * 255]).astype(np.float32)
ya, yb, xa, xb = max(0, oy), min(c.shape[0], oy + side), max(0, ox), min(c.shape[1], ox + side); sq[ya - oy:yb - oy, xa - ox:xb - ox] = rgba[ya:yb, xa:xb]
al = sq[..., 3:4] / 255; pm = np.dstack([np.clip(sq[..., :3] * al, 0, 255), sq[..., 3:4]]).astype(np.uint8)
s = np.array(Image.fromarray(pm, 'RGBA').resize((CELL, CELL), Image.LANCZOS)).astype(np.float32); al = s[..., 3:4] / 255
rgb = np.where(al > .02, s[..., :3] / np.maximum(al, .02), 0)
img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.0, percent=120, threshold=2))
Image.fromarray(np.dstack([np.array(img), (np.clip((al[..., 0] - .12) / .76, 0, 1) * 255).astype(np.uint8)]), 'RGBA').save(os.path.join(A, 'sprites', 'fx', 'boomerang.webp'), quality=94, alpha_quality=100, method=6)
print('boomerang.webp: from the design sheet, %d px square source -> %d' % (side, CELL))
