# Briggs's E "MANHOLE FRISBEE" (Nov 13): the user's cover / open-manhole image + the skill card.
#   python3 tools/extract-manhole.py
# Sources (tools/art/briggs): manhole-art.png (left: the cover seen from straight above; right: the open manhole), manhole-card.png.
# Writes client/assets/sprites/fx/manhole.webp: 2 cells of 96 x 96 (0 = cover, 1 = hole), each fitted and centred (the game squashes them
# flat onto the ground and spins the cover), and client/assets/icons/card-manholeFrisbee.png (152 x 152).
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'briggs'); A = os.path.join(here, '..', 'client', 'assets')
CELL = 96
def resize_sharp(rgba, size, pct=80):
    a = rgba[..., 3:4].astype(np.float32) / 255; pm = np.clip(rgba[..., :3].astype(np.float32) * a, 0, 255).astype(np.uint8)
    up = lambda x: np.array(Image.fromarray(np.ascontiguousarray(x)).resize(size, Image.LANCZOS)).astype(np.float32)
    P = np.clip(np.dstack([up(pm[..., i]) for i in range(3)]), 0, 255); al = np.clip(up(rgba[..., 3]), 0, 255) / 255
    rgb = np.where(al[..., None] > .02, P / np.maximum(al[..., None], .02), 0)
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.0, percent=pct, threshold=2))
    return Image.fromarray(np.dstack([np.array(img), (np.clip((al - .15) / .7, 0, 1) * 255).astype(np.uint8)]))
a = np.array(Image.open(os.path.join(ART, 'manhole-art.png')).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
fg = ~((r - g > 60) & (b - g > 60) & (np.abs(r - b) < 90)); fg = ndimage.binary_opening(fg, iterations=1)
rgba = np.dstack([a, fg * 255]).astype(np.uint8); W = a.shape[1]; atlas = Image.new('RGBA', (CELL * 2, CELL))
for k, (x0, x1) in enumerate([(0, W // 2), (W // 2, W)]):
    m = fg[:, x0:x1]; ys, xs = np.where(m); bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    side = max(bx1 - bx0, by1 - by0); cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2; half = side / 2 + 4
    sq = np.zeros((int(2 * half), int(2 * half), 4), np.uint8); sx0, sy0 = int(cx - half), int(cy - half)
    src = rgba[:, x0:x1]; ya, yb, xa, xb = max(0, sy0), min(src.shape[0], sy0 + sq.shape[0]), max(0, sx0), min(src.shape[1], sx0 + sq.shape[1])
    sq[ya - sy0:yb - sy0, xa - sx0:xb - sx0] = src[ya:yb, xa:xb]
    atlas.alpha_composite(resize_sharp(sq, (CELL, CELL)), (k * CELL, 0)); print(['cover', 'hole'][k], 'from', side, 'px')
atlas.save(os.path.join(A, 'sprites', 'fx', 'manhole.webp'), quality=92, alpha_quality=95, method=6)
card = Image.open(os.path.join(ART, 'manhole-card.png')).convert('RGB').resize((152, 152), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.0, percent=60, threshold=2))
card.save(os.path.join(A, 'icons', 'card-manholeFrisbee.png')); print('card 152x152')
