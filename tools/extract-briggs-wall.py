# Briggs's Q "UNBREAKABLE" (Nov 13): cuts the user's steel-wall sheets + the new Q card.
#   python3 tools/extract-briggs-wall.py
# Sources (tools/art/briggs): wall-rise.png, wall-heat.png, wall-blast.png (one row of 6 frames each, magenta),
# unbreakable-card-a.png (the Q card).
# Writes:
#   client/assets/sprites/fx/briggs-wall.webp  rows: 0 rise (6), 1 heat (6: cool A/B, hot A/B, overcharged A/B), 2 release blast (6)
#       every frame at SC of the art, anchored on the ring's ground centre (AX, AY in each cell), drawn 1:1 in game
#   client/assets/sprites/fx/briggs-slab.webp  the ring's front slab, one per heat frame (6 in a row), at TEX of the art:
#       the game builds the turning ring out of it (8 slabs on a cylinder, drawn in thin vertical strips)
#   client/assets/icons/card-unbreakable.png  152x152
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'briggs'); A = os.path.join(here, '..', 'client', 'assets')
SC, TEX = 0.4, 0.8
# the ring in the reference frame (wall-heat frame 0, column-relative art px): seams of the front slab at x 140 / 242, its ground line y 489,
# the back slabs' ground line ~y 340 -> centre (191, 414.5), radii 133 x 74.5 (seam circle), slab height 109 (incl. the top cap)
REF = dict(cx=191, gy=414.5, rx=133, ry=74.5, h=109, s0=141, s1=239, top=356, bot=492)   # s0..s1: the front slab's body only (its outline), seams are drawn by the game
CW, CH, AX, AY = 362, 400, 181, 262   # cell in art px (x 0..362 of the column, y 152..552), anchor = ring ground centre inside the cell

def load(name):
    a = np.array(Image.open(os.path.join(ART, name)).convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    fg = ~((r - g > 60) & (b - g > 60) & (np.abs(r - b) < 90))
    fg = ndimage.binary_opening(fg, iterations=1)
    lab, n = ndimage.label(fg); sz = ndimage.sum(fg, lab, range(1, n + 1)); fg = np.isin(lab, [i + 1 for i in range(n) if sz[i] >= 12])
    pink = fg & (r > g + 18) & (b > g + 18)   # glow over magenta: despill to fiery orange
    rgb = a.copy(); rgb[..., 2] = np.where(pink, np.minimum(b, (g * .55).astype(int)), b); rgb[..., 0] = np.where(pink, np.maximum(r, g + 40), r)
    return fg, np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), (fg * 255).astype(np.uint8)])

def steel(rgba):   # the slab bodies: dark, low-saturation pixels (not the glows) - used to line frames up
    a = rgba.astype(int); mx = a[..., :3].max(-1); mn = a[..., :3].min(-1)
    return (a[..., 3] > 0) & (mx < 150) & (mx - mn < 60)

def resize_sharp(rgba, sc, pct=65):   # premultiplied Lanczos (no magenta fringe), soft antialiased edge, unsharp mask on the colour
    a = rgba[..., 3:4].astype(np.float32) / 255; pm = np.clip(rgba[..., :3].astype(np.float32) * a, 0, 255).astype(np.uint8)
    w, h = max(1, round(rgba.shape[1] * sc)), max(1, round(rgba.shape[0] * sc))
    up = lambda x: np.array(Image.fromarray(np.ascontiguousarray(x)).resize((w, h), Image.LANCZOS)).astype(np.float32)
    P = np.clip(np.dstack([up(pm[..., i]) for i in range(3)]), 0, 255); al = np.clip(up(rgba[..., 3]), 0, 255) / 255
    rgb = np.where(al[..., None] > .02, P / np.maximum(al[..., None], .02), 0)
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.3 * max(1, sc), percent=pct, threshold=2))
    return Image.fromarray(np.dstack([np.array(img), (np.clip((al - .18) / .64, 0, 1) * 255).astype(np.uint8)]))

ref_rgba = None
def frames(name):
    fg, rgba = load(name); W = rgba.shape[1]; pitch = W / 6; out = []
    for i in range(6):
        x0 = int(round(i * pitch)); col = np.zeros((rgba.shape[0], CW, 4), np.uint8); w = min(CW, W - x0); col[:, :w] = rgba[:, x0:x0 + w]
        out.append(col)
    return out

def align(col, ref, search=(24, 18)):   # integer shift (dx, dy) of col that best lines its steel up with ref's
    a = steel(col)[150:560].astype(np.float32); b = steel(ref)[150:560].astype(np.float32)
    best = (-1, 0, 0)
    for dy in range(-search[1], search[1] + 1, 2):
        for dx in range(-search[0], search[0] + 1, 2):
            s = (np.roll(np.roll(a, dy, 0), dx, 1) * b).sum()
            if s > best[0]: best = (s, dx, dy)
    _, dx, dy = best   # refine to 1px
    for ddy in (-1, 0, 1):
        for ddx in (-1, 0, 1):
            s = (np.roll(np.roll(a, dy + ddy, 0), dx + ddx, 1) * b).sum()
            if s > best[0]: best = (s, dx + ddx, dy + ddy)
    return best[1], best[2]

heat = frames('wall-heat.png'); ref = heat[0]
def slab_dx(i):   # how far left frame i's front slab is drawn compared with frame 0 (vertical edges: rivets, outline, stripes)
    f = lambda c: np.abs(np.diff(c[380:490, 80:300, :3].astype(float).mean(-1), axis=1)); f0, fi = f(heat[0]), f(heat[i]); best = (-1, 0)
    for dx in range(-20, 21):
        v = (np.roll(fi, dx, 1)[:, 25:-25] * f0[:, 25:-25]).sum()
        if v > best[0]: best = (v, dx)
    return best[1]
sheets = {'rise': frames('wall-rise.png'), 'heat': heat, 'blast': frames('wall-blast.png')}
cw, ch = round(CW * SC), round(CH * SC); atlas = Image.new('RGBA', (cw * 6, ch * 3))
tw, th = round((REF['s1'] - REF['s0']) * TEX), round((REF['bot'] - REF['top']) * TEX); slabs = Image.new('RGBA', (tw * 6, th))
for row, key in enumerate(['rise', 'heat', 'blast']):
    for i, col in enumerate(sheets[key]):
        dx, dy = 0, 0   # (the artist kept each ring in its column; the rise ring sits ~10px left of the heat ring and a few px high: line it up)
        if key == 'rise':
            ys, xs = np.where(col[..., 3] > 0); k = max(i, 2); ys2, xs2 = np.where(sheets['rise'][k][..., 3] > 0)
            dx = round(REF['cx'] - (xs2.min() + xs2.max()) / 2); dy = 489 - ys2.max() if i >= 2 else 489 - 486
        col = np.roll(np.roll(col, dy, 0), dx, 1); print(f'{key} {i}: shift {dx},{dy}')
        cell = col[152:152 + CH]
        if key == 'blast':   # the explosion frames run into their column's edges in the art: fade them out before the cell border (no square cut)
            yy, xx = np.mgrid[0:CH, 0:CW]; d = np.maximum(np.abs(xx - AX) / (CW / 2), np.abs(yy - AY) / max(AY, CH - AY))
            cell = cell.copy(); cell[..., 3] = (cell[..., 3] * np.clip((1 - d) / .4, 0, 1) ** .7).astype(np.uint8)
        im = resize_sharp(cell, SC); atlas.alpha_composite(im.crop((0, 0, cw, ch)), (i * cw, row * ch))
        if key == 'heat':   # the front slab's body (the ring drifts a few px left frame by frame: follow it by matching edges)
            k = slab_dx(i); sl = col[REF['top']:REF['bot'], REF['s0'] - k:REF['s1'] - k]; print(f'   slab {i}: x -{k}')
            slabs.alpha_composite(resize_sharp(sl, TEX, 50), (i * tw, 0))
atlas.save(os.path.join(A, 'sprites', 'fx', 'briggs-wall.webp'), quality=90, alpha_quality=92, method=6)
slabs.save(os.path.join(A, 'sprites', 'fx', 'briggs-slab.webp'), quality=92, alpha_quality=95, method=6)
print('wall atlas', atlas.size, 'cell', cw, ch, 'anchor', round(AX * SC, 1), round(AY * SC, 1))
print('slab tex', tw, th, '(TEX %.2f) ground at y %.1f; ring rx %.1f ry %.1f h %.1f (game px)' % (TEX, (489 - REF['top']) * TEX, REF['rx'] * SC, REF['ry'] * SC, REF['h'] * SC))

# the Q card
c = np.array(Image.open(os.path.join(ART, 'unbreakable-card-a.png')).convert('RGB')).astype(int)
fg = ~((c[..., 0] > 200) & (c[..., 2] > 200) & (c[..., 1] < 90)); ys, xs = np.where(ndimage.binary_opening(fg, iterations=3))
card = np.dstack([c, fg * 255]).astype(np.uint8)[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
im = resize_sharp(card, 152 / max(card.shape[:2]), 55); out = Image.new('RGBA', (152, 152)); out.alpha_composite(im, ((152 - im.width) // 2, (152 - im.height) // 2))
out.save(os.path.join(A, 'icons', 'card-unbreakable.png')); print('card', im.size)
