# Briggs's Q "UNBREAKABLE" v3 (Nov 13): the user's shield turnarounds -> one atlas.
#   python3 tools/extract-briggs-shield.py
# Sources (tools/art/briggs): shield-turn.png (normal), shield-turn-hot.png (overcharged): 3x3 grids, 9 views of ONE shield turning
# to the right on the spot (1 front face ... 5 side-on ... 9 back face), magenta background.
# Writes client/assets/sprites/fx/briggs-shield.webp: row 0 normal, row 1 overcharged, 9 cells each (CW x CH game px), every view anchored
# on its ground point (bottom centre of its bounding box) at (AX, AY) in the cell. All views share one scale (the art's views are
# drawn at the same scale: side views are taller because we see more of the top). Prints the per-view opaque width / height for the client.
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'briggs'); A = os.path.join(here, '..', 'client', 'assets')
SC = 0.18            # game px per art px: the front view's slab ~46 px wide (54 with its rocks), ~51 px tall
GRID = 418           # the sheets are 1254 x 1254 = 3 x 3 cells of 418

def load(name):
    a = np.array(Image.open(os.path.join(ART, name)).convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    fg = ~((r - g > 60) & (b - g > 60) & (np.abs(r - b) < 90))
    fg = ndimage.binary_opening(fg, iterations=1)
    lab, n = ndimage.label(fg); sz = ndimage.sum(fg, lab, range(1, n + 1)); fg = np.isin(lab, [i + 1 for i in range(n) if sz[i] >= 12])
    pink = fg & (r > g + 18) & (b > g + 18)   # glow over magenta: despill to fiery orange
    rgb = a.copy(); rgb[..., 2] = np.where(pink, np.minimum(b, (g * .55).astype(int)), b); rgb[..., 0] = np.where(pink, np.maximum(r, g + 40), r)
    return np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), (fg * 255).astype(np.uint8)])

def resize_sharp(rgba, sc, pct=70):   # premultiplied Lanczos (no magenta fringe), soft antialiased edge, unsharp mask on the colour
    a = rgba[..., 3:4].astype(np.float32) / 255; pm = np.clip(rgba[..., :3].astype(np.float32) * a, 0, 255).astype(np.uint8)
    w, h = max(1, round(rgba.shape[1] * sc)), max(1, round(rgba.shape[0] * sc))
    up = lambda x: np.array(Image.fromarray(np.ascontiguousarray(x)).resize((w, h), Image.LANCZOS)).astype(np.float32)
    P = np.clip(np.dstack([up(pm[..., i]) for i in range(3)]), 0, 255); al = np.clip(up(rgba[..., 3]), 0, 255) / 255
    rgb = np.where(al[..., None] > .02, P / np.maximum(al[..., None], .02), 0)
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.0, percent=pct, threshold=2))
    return Image.fromarray(np.dstack([np.array(img), (np.clip((al - .18) / .64, 0, 1) * 255).astype(np.uint8)]))

views = {}
for row, name in enumerate(['shield-turn.png', 'shield-turn-hot.png']):
    im = load(name)
    for k in range(9):
        c = im[(k // 3) * GRID:(k // 3 + 1) * GRID, (k % 3) * GRID:(k % 3 + 1) * GRID]; ys, xs = np.where(c[..., 3] > 0)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1; views[(row, k)] = (c[y0:y1, x0:x1], (x1 - x0), (y1 - y0))
W = max(v[1] for v in views.values()); H = max(v[2] for v in views.values())
CW, CH = int(np.ceil(W * SC)) + 6, int(np.ceil(H * SC)) + 4; AX, AY = CW / 2, CH - 2
atlas = Image.new('RGBA', (CW * 9, CH * 2)); ws, hs = [], []
for (row, k), (c, w, h) in sorted(views.items()):
    pad = 8; big = np.zeros((h + 2 * pad, w + 2 * pad, 4), np.uint8); big[pad:pad + h, pad:pad + w] = c   # (room for the resample to soften the edge)
    s = resize_sharp(big, SC); x = round(AX - s.width / 2); y = round(AY + pad * SC - s.height)
    atlas.alpha_composite(s, (k * CW + x, row * CH + y))
    if row == 0: ws.append(round(w * SC, 1)); hs.append(round(h * SC, 1))
atlas.save(os.path.join(A, 'sprites', 'fx', 'briggs-shield.webp'), quality=92, alpha_quality=95, method=6)
print('shield atlas', atlas.size, 'cell', CW, CH, 'anchor', AX, AY)
print('view widths', ws); print('view heights', hs)
