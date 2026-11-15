# Briggs's E "STEEL BOOMERANG" (Nov 15; it replaced the Manhole Frisbee): the user's boomerang (seen from straight above) + the skill card.
#   python3 tools/extract-boomerang.py
# Sources (tools/art/briggs): boomerang-art.png (1254 x 1254, magenta), boomerang-card.png. (The throw pose: tools/clean-briggs-throw.py + cut-briggs.sh.)
# Writes client/assets/sprites/fx/boomerang.webp: ONE square cell (CELL px) with the boomerang's CENTRE OF MASS in the middle (a boomerang spins
# round its centre of mass, which sits inside the V, not at its bounding box's centre), drawn at 2x the size the game shows it (it's rotated
# every frame: the extra pixels keep it crisp), and client/assets/icons/card-steelBoomerang.png (152 x 152).
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'briggs'); A = os.path.join(here, '..', 'client', 'assets')
CELL = 112
a = np.array(Image.open(os.path.join(ART, 'boomerang-art.png')).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
fg = ~((r - g > 60) & (b - g > 60) & (np.abs(r - b) < 90)); fg = ndimage.binary_opening(fg, iterations=1)
lab, n = ndimage.label(fg); sz = ndimage.sum(fg, lab, range(1, n + 1)); fg = lab == 1 + int(np.argmax(sz)); fg = ndimage.binary_fill_holes(fg)   # just the boomerang
pink = fg & (r > g + 18) & (b > g + 18)   # its glowing edges blended over magenta: despill to fiery orange
a[..., 2] = np.where(pink, np.minimum(b, (g * .55).astype(int)), b); a[..., 0] = np.where(pink, np.maximum(r, g + 40), r)
ys, xs = np.where(fg); cy, cx = ys.mean(), xs.mean(); half = max(np.abs(xs - cx).max(), np.abs(ys - cy).max()) + 10
side = int(np.ceil(2 * half)); sq = np.zeros((side, side, 4), np.float32); ox, oy = int(round(cx - side / 2)), int(round(cy - side / 2))
rgba = np.dstack([a, fg * 255]).astype(np.float32)
ya, yb, xa, xb = max(0, oy), min(a.shape[0], oy + side), max(0, ox), min(a.shape[1], ox + side); sq[ya - oy:yb - oy, xa - ox:xb - ox] = rgba[ya:yb, xa:xb]
al = sq[..., 3:4] / 255; pm = np.dstack([np.clip(sq[..., :3] * al, 0, 255), sq[..., 3:4]]).astype(np.uint8)
s = np.array(Image.fromarray(pm, 'RGBA').resize((CELL, CELL), Image.LANCZOS)).astype(np.float32); al = s[..., 3:4] / 255
rgb = np.where(al > .02, s[..., :3] / np.maximum(al, .02), 0)
img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.0, percent=120, threshold=2))
out = Image.fromarray(np.dstack([np.array(img), (np.clip((al[..., 0] - .12) / .76, 0, 1) * 255).astype(np.uint8)]), 'RGBA')
out.save(os.path.join(A, 'sprites', 'fx', 'boomerang.webp'), quality=94, alpha_quality=100, method=6)
w = (xs.max() - xs.min()) / side * CELL; print('boomerang cell', CELL, 'from', side, 'px; its width in the cell %.1f px (%.2f of the cell)' % (w, w / CELL))
card = Image.open(os.path.join(ART, 'boomerang-card.png')).convert('RGB').resize((152, 152), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.0, percent=60, threshold=2))
card.save(os.path.join(A, 'icons', 'card-steelBoomerang.png')); print('card 152x152')
