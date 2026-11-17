# VEX v2 art (Nov 17 evening; prompts tools/art/vex/PROMPTS.md "VEX v2", realistic gas on PURE BLACK):
#   python3 tools/extract-vex-v2.py
#   v2-smoke.png  4 x 4 smoke kit (puffs, wisps, clumps / haze, bubbles / droplets / ground mist) -> client/assets/sprites/fx/vex-smoke.webp (+ rects)
#   v2-burst.png  1 x 6 Mutagen burst (glow, flash, blast, gas ring, thinning, wisps)               -> client/assets/sprites/fx/vex-burst.webp
#   v2-rise.png   1 x 6 Patient Zero rise (leak, ring, column, tallest, falling, wisps)             -> client/assets/sprites/fx/vex-rise.webp
#   card-syringe / card-trail / card-patientzero -> client/assets/icons/card-mutagenSyringe / card-poisonTrail / card-patientZero (152 x 152)
# Black is "unmixed": opacity = brightness (soft, see-through edges with no dark fringe); the colour is the pixel divided by its opacity.
# Prints the numbers the client needs (VEXFX in client.js).
import os, json
import numpy as np
from PIL import Image, ImageFilter
here = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(here, 'art', 'vex'); A = os.path.join(here, '..', 'client', 'assets')
for src, dst in (('card-syringe.png', 'card-mutagenSyringe'), ('card-trail.png', 'card-poisonTrail'), ('card-patientzero.png', 'card-patientZero')):
    Image.open(os.path.join(R, src)).convert('RGB').resize((152, 152), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.0, percent=70, threshold=2)).save(os.path.join(A, 'icons', dst + '.png'))

def unmix(path, floor=10, gain=1.25):   # black -> transparent; RGBA float array
    a = np.array(Image.open(os.path.join(R, path)).convert('RGB')).astype(float)
    m = a.max(axis=2); al = np.clip((m - floor) / (255 - floor) * gain, 0, 1)
    rgb = np.where(al[..., None] > 1e-3, np.clip((a - floor * (1 - al[..., None])) / np.maximum(al[..., None], 1e-3), 0, 255), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]; bad = (b > g) | (r > g * 1.05)   # keep it green (no pink / purple / blue)
    rgb[bad, 2] = np.minimum(b[bad], g[bad] * .6); rgb[..., 0] = np.minimum(r, np.maximum(g * 1.05, 0))
    return np.dstack([rgb, al * 255])
def box(al, t=8):
    ys, xs = np.where(al > t); return (xs.min(), xs.max() + 1, ys.min(), ys.max() + 1) if len(xs) else None
def save(arr, name): Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(A, 'sprites', 'fx', name), 'WEBP', quality=88, alpha_quality=90, method=6)
def scale(arr, k): im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA'); return np.array(im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)).astype(float)

# ---- the smoke kit: 16 pieces, cut per cell, packed in one row per kit row ----
S = unmix('v2-smoke.png'); H, W = S.shape[:2]; cw, ch = W / 4, H / 4; K = .5; pieces = []
for r in range(4):
    for c in range(4):
        cell = S[int(r * ch):int((r + 1) * ch), int(c * cw):int((c + 1) * cw)]; bx = box(cell[..., 3])
        x0, x1, y0, y1 = bx; x0, y0 = max(0, x0 - 4), max(0, y0 - 4); x1, y1 = min(cell.shape[1], x1 + 4), min(cell.shape[0], y1 + 4)
        pieces.append(scale(cell[y0:y1, x0:x1], K))
pad = 2; rows = [pieces[i * 4:(i + 1) * 4] for i in range(4)]; aw = max(sum(p.shape[1] + pad for p in row) for row in rows); ah = sum(max(p.shape[0] for p in row) + pad for row in rows)
atlas = np.zeros((ah, aw, 4)); rects = []; y = 0
for row in rows:
    x = 0; rh = max(p.shape[0] for p in row)
    for p in row: atlas[y:y + p.shape[0], x:x + p.shape[1]] = p; rects.append([x, y, p.shape[1], p.shape[0]]); x += p.shape[1] + pad
    y += rh + pad
save(atlas, 'vex-smoke.webp'); print('smoke atlas', atlas.shape[1], 'x', atlas.shape[0]); print('client VEXFX.smoke =', json.dumps(rects))

# ---- 1 x 6 strips: frames split at the emptiest columns, every frame in one cell round a shared ground point ----
def strip(path, want, key, name, gy_of):
    F = unmix(path); al = F[..., 3]; col = al.sum(axis=0); W = F.shape[1]
    cuts = [0]
    for i in range(1, 6):   # the emptiest column near each sixth
        lo, hi = int(W * (i / 6 - .06)), int(W * (i / 6 + .06)); cuts.append(lo + int(np.argmin(col[lo:hi])))
    cuts.append(W); frames = []
    for i in range(6):
        seg = F[:, cuts[i]:cuts[i + 1]]; bx = box(seg[..., 3]); frames.append((seg, bx, cuts[i]))
    kb = frames[key][1]; k = want / (kb[1] - kb[0])
    cx = [ (bx[0] + bx[1]) / 2 for _, bx, _ in frames ]; kx = cx[key]   # each frame's own middle (they're drawn centred on one point)
    halfw = max(max(cx[i] - frames[i][1][0], frames[i][1][1] - cx[i]) for i in range(6)) + 4
    top = min(bx[2] for _, bx, _ in frames) - 4; bot = max(bx[3] for _, bx, _ in frames) + 4
    cells = []
    for i, (seg, bx, off) in enumerate(frames):
        c0 = int(round(cx[i] - halfw)); cell = np.zeros((bot - top, int(2 * halfw), 4)); s0 = max(0, c0); s1 = min(seg.shape[1], c0 + int(2 * halfw))
        cell[:, s0 - c0:s1 - c0] = seg[top:bot, s0:s1]; cells.append(scale(cell, k))
    cwid = max(c.shape[1] for c in cells); chei = max(c.shape[0] for c in cells); out = np.zeros((chei, cwid * 6, 4))
    for i, c in enumerate(cells): out[:c.shape[0], i * cwid:i * cwid + c.shape[1]] = c
    save(out, name); gy = (gy_of(frames) - top) * k
    print(name, {'cw': cwid, 'ch': chei, 'gx': round(halfw * k), 'gy': round(gy)}, 'key width', want)
# burst: the ground point = the middle of the gas ring (frame 4: halfway down its solid part); rise: the base ring (frame 2's lowest solid band)
strip('v2-burst.png', 300, 3, 'vex-burst.webp', lambda fr: (fr[3][1][2] + fr[3][1][3]) / 2)
strip('v2-rise.png', 110, 1, 'vex-rise.webp', lambda fr: fr[1][1][3] - (fr[1][1][3] - fr[1][1][2]) * .32)

# ---- the props (v2-props.png, pixel art on MAGENTA): 1 the syringe flying (needle right), 2 stuck in the ground (a miss), 3 the biohazard badge,
# 4 broken glass shards -> client/assets/sprites/fx/vex-props.webp at 2x their in-game size (drawn at half size, smoothed). Rects + anchors printed.
from scipy import ndimage
a = np.array(Image.open(os.path.join(R, 'v2-props.png')).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
bg = (r > 170) & (b > 170) & (g < 120); fg = ndimage.binary_opening(~bg, iterations=1); col = fg.sum(axis=0)
runs, inr = [], False
for x, c in enumerate(col):
    if c > 3 and not inr: s0, inr = x, True
    elif c <= 3 and inr: inr = False; runs.append((s0, x)) if x - s0 > 20 else None
want = [92, 84, 38, 56]   # 2x in-game widths: syringe 46px long, the stuck one 42px, badge 19px, shards 28px
out, rects, x = [], [], 0
for (x0, x1), W2 in zip(runs, want):
    m = ndimage.binary_fill_holes(fg[:, x0:x1]); ys, xs = np.where(m); y0, y1, c0, c1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub = m[y0:y1, c0:c1]; rgb = a[y0:y1, x0 + c0:x0 + c1].copy(); rr, gg, bb = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    pink = sub & (rr > gg + 40) & (bb > gg + 40); rgb[pink] = (rgb[pink] * .25).astype(int)   # magenta fringe -> outline dark
    im = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), sub * 255]).astype(np.uint8), 'RGBA'); k = W2 / im.width
    im = im.resize((W2, max(1, round(im.height * k))), Image.LANCZOS); out.append(im); rects.append([x, 0, im.width, im.height]); x += im.width + 2
atlas = Image.new('RGBA', (x, max(i.height for i in out)))
for im, rc in zip(out, rects): atlas.alpha_composite(im, (rc[0], 0))
atlas.save(os.path.join(A, 'sprites', 'fx', 'vex-props.webp'), 'WEBP', quality=92, alpha_quality=95, method=6)
print('client VEXFX.props =', json.dumps(rects), '(2x size: draw at half)')
