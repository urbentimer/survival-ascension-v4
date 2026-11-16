# Sienna's skill effects (Nov 16) -> client/assets/sprites/fx/sienna-*.webp
#   python3 tools/extract-sienna-fx.py   (run by tools/cut-sienna.sh)
# Sources (tools/art/sienna, magenta background, ChatGPT):
#   6-grenade-burst.png: 6 frames in a row: the canister (-> the thrown grenade), white starburst, crystals + frost ring, the big burst with
#     snow puffs, the frozen patch, the fading patch.            -> sienna-burst.webp (frames 1-5) + sienna-grenade.webp (the canister)
#   7-tower.png: 2 x 4: ice spreading, crystals shooting up, the tower rising, the full tower (sparkle), tower, cracking, breaking, rubble.
#                                                                -> sienna-tower.webp (8 frames; Q: she stands on its top)
#   8-shatter.png: 6 frames: a solid ice block (R: the decoy she leaves), glowing cracks, bursting apart, shards flying, the patch, fading.
#                                                                -> sienna-shatter.webp (6 frames)
# (Nov 16 v2: the user's "ultra realistic" redo of all three; the first set is in tools/art/sienna/old/*-v1.png.) Frames are cut along the
# emptiest lines near the even grid (soft glow haze joins them), keyed by
# "unmixing" the magenta (soft see-through edges, no pink fringe), shrunk premultiplied and sharpened. Every frame sits on a shared GROUND point
# (GX, GY in its cell) so the client draws it centred on the spot. Scales: the big burst = the 120px blast circle; the tower's top fits her
# feet; the ice block is a little bigger than her (57px tall). Prints each atlas's cell size, ground point and (tower) the top's height.
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(here, 'art', 'sienna'); FX = os.path.join(here, '..', 'client', 'assets', 'sprites', 'fx')

def unmix(rgb):   # key out the magenta. A pixel with no magenta in it (green >= min(red, blue)) is solid art; a tinted one (glow / haze / edge) is
    # "colour to alpha": the least alpha that explains it as some colour over #FF00FF, so cyan glow painted over magenta (lavender on the sheet)
    # comes back cyan, white glow white. Blended in over the first 20 levels of tint (no jump between the two).
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    cta = np.clip(np.maximum.reduce([(255 - r) / 255, g / 255, (255 - b) / 255]), 0, 1); cta = np.clip((cta - .05) / .85, 0, 1)
    tint = np.clip((np.minimum(r, b) - g) / 20, 0, 1); al = 1 - tint * (1 - cta)
    M = np.array([255., 0, 255]); Fc = np.clip(M + (rgb - M) / np.maximum(al[..., None], 1e-3), 0, 255)
    # no purple left: in every bluish pixel the red is pulled down to 0.8x the green (ice blue); whites and greys stay as they are
    r_, g_, b_ = Fc[..., 0], Fc[..., 1], Fc[..., 2]; t = np.clip((b_ - g_ - 20) / 40, 0, 1) * (r_ > g_ * .8)
    Fc[..., 0] = r_ * (1 - t) + g_ * .8 * t
    return np.dstack([Fc, al * 255])

def valley(prof, guess, span):   # the emptiest line near `guess` (where one frame's haze ends and the next begins)
    lo, hi = max(1, int(guess - span)), min(len(prof) - 1, int(guess + span)); return lo + int(np.argmin(prof[lo:hi]))

def frames(name, ncols, nrows=1):
    """the frames of an n x m sheet, left to right, top to bottom: [(rgba, (x0, y0))]. (Nov 16 v2, the user's realistic set: soft glow haze
    joins the frames, so each cut goes through the emptiest line near the even grid line, rows first, then each row's columns)"""
    a = np.array(Image.open(os.path.join(R, name)).convert('RGB')).astype(np.float32); rgba = unmix(a); al = ndimage.gaussian_filter(rgba[..., 3], 3); H, W = al.shape
    rc = [0] + [valley(al.sum(1), H * k / nrows, H / nrows * .3) for k in range(1, nrows)] + [H]; out = []
    for r in range(nrows):
        band = al[rc[r]:rc[r + 1]]; cc = [0] + [valley(band.sum(0), W * k / ncols, W / ncols * .35) for k in range(1, ncols)] + [W]
        for c in range(ncols):
            f = rgba[rc[r]:rc[r + 1], cc[c]:cc[c + 1]].copy(); m = f[..., 3] > 6; ys, xs = np.where(m)
            y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            out.append((f[y0:y1, x0:x1], (cc[c] + x0, rc[r] + y0)))
    return out

def box(f, thr=60):   # the solid part's bounding box inside a frame: x0, x1, y0, y1 (the faint haze doesn't count)
    ys, xs = np.where(ndimage.binary_opening(f[..., 3] > thr, iterations=1)); return xs.min(), xs.max() + 1, ys.min(), ys.max() + 1

def shrink(rgba, sc):
    h, w = rgba.shape[:2]; a = rgba[..., 3:4] / 255; size = (max(1, round(w * sc)), max(1, round(h * sc)))
    pm = np.dstack([np.clip(rgba[..., :3] * a, 0, 255), rgba[..., 3:4]]).astype(np.uint8)
    s = np.array(Image.fromarray(pm, 'RGBA').resize(size, Image.LANCZOS)).astype(np.float32); al = s[..., 3:4] / 255
    rgb = np.where(al > .02, s[..., :3] / np.maximum(al, .02), 0)
    im = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.0, percent=90, threshold=2))
    al = np.clip((al[..., 0] - .04) / .96, 0, 1)
    return Image.fromarray(np.dstack([np.array(im), (al * 255).astype(np.uint8)]), 'RGBA')

def atlas(out, fr, ground, sc, cols=None):
    """ground: [(gx, gy)] source px per frame -> one row (or `cols` per row) of equal cells, each frame's ground point at (GX, GY)"""
    L = max(gx - x0 for (f, (x0, y0)), (gx, gy) in zip(fr, ground)); Rr = max(x0 + f.shape[1] - gx for (f, (x0, y0)), (gx, gy) in zip(fr, ground))
    U = max(gy - y0 for (f, (x0, y0)), (gx, gy) in zip(fr, ground)); D = max(y0 + f.shape[0] - gy for (f, (x0, y0)), (gx, gy) in zip(fr, ground))
    GX, GY = int(np.ceil(L * sc)) + 2, int(np.ceil(U * sc)) + 2; CW, CH = GX + int(np.ceil(Rr * sc)) + 2, GY + int(np.ceil(D * sc)) + 2
    cols = cols or len(fr); rows = (len(fr) + cols - 1) // cols; im = Image.new('RGBA', (CW * cols, CH * rows))
    for k, ((f, (x0, y0)), (gx, gy)) in enumerate(zip(fr, ground)):
        s = shrink(f, sc); r_, c_ = divmod(k, cols)
        im.alpha_composite(s, (c_ * CW + GX - round((gx - x0) * sc), r_ * CH + GY - round((gy - y0) * sc)))
    im.save(os.path.join(FX, out), quality=94, alpha_quality=100, method=6)
    print(f'{out}: {im.size[0]}x{im.size[1]}, cell {CW}x{CH}, ground at {GX},{GY}, scale {sc:.3f}')
    return CW, CH, GX, GY

def ground(f, x0, y0, up):   # a frame's ground point: the middle of its solid bottom band, `up` source px above its solid bottom
    bx0, bx1, by0, by1 = box(f); m = f[..., 3] > 60; ys, xs = np.where(m); sel = ys > by1 - max(12, (by1 - by0) * .18)
    return x0 + xs[sel].mean(), y0 + by1 - up

# 1. Cryo grenade burst: the big burst (frame 3) is 240px across in game (the 120px blast radius); the ground point = the middle of each frame's
#    frost ring / patch (its solid bottom less 13% of its width: the ring is a flat ellipse)
B = frames('6-grenade-burst.png', 6)
bw = lambda f: box(f)[1] - box(f)[0]
SCB = 240 / bw(B[3][0])
atlas('sienna-burst.webp', B[1:], [ground(f, x0, y0, bw(f) * .13) for f, (x0, y0) in B[1:]], SCB)
can = B[0][0]; m = can[..., 3] > 90; lab, n = ndimage.label(m); big = 1 + int(np.argmax(ndimage.sum(m, lab, range(1, n + 1))))
ys, xs = np.where(lab == big); keep = ndimage.binary_dilation(lab == big, iterations=2); can = can.copy(); can[..., 3] *= keep
can = can[max(0, ys.min() - 2):ys.max() + 3, max(0, xs.min() - 2):xs.max() + 3]
g = shrink(can, 20 / can.shape[1]); cell = Image.new('RGBA', (24, 24)); cell.alpha_composite(g, ((24 - g.width) // 2, (24 - g.height) // 2))
cell.save(os.path.join(FX, 'sienna-grenade.webp'), quality=94, alpha_quality=100, method=6); print('sienna-grenade.webp: 24x24 (the canister, centred)')

# 2. Ice tower: its top platform ~54px across, the ground point = the base's middle (30 src px above the solid bottom). TOP = how high she stands.
T = frames('7-tower.png', 4, 2)
f4, (x4, y4) = T[4]; bx0, bx1, by0, by1 = box(f4); al4 = f4[..., 3] > 60
cols = np.where(al4.any(0))[0]; plat = bx1 - bx0   # frame 4 (the full tower): its top is its widest part (the icicle rim)
SCT = 54 / plat
gT = [ground(f, x0, y0, 30) for f, (x0, y0) in T]
CW, CH, GX, GY = atlas('sienna-tower.webp', T, gT, SCT, cols=8)
rows = np.where(al4[:, (bx0 + bx1) // 2 - 20:(bx0 + bx1) // 2 + 20].any(1))[0]; top_y = y4 + rows.min() + (by1 - by0) * .07   # the platform's middle: a little below its top edge
print(f'  tower top: {round((gT[4][1] - top_y) * SCT)} game px above the ground point')

# 3. Ice block / shatter: the block (frame 0) ~62px tall (she is 57); ground point = the block's base (25 src px above the solid bottom)
Sh = frames('8-shatter.png', 6)
b0 = box(Sh[0][0]); SCS = 62 / (b0[3] - b0[2])
atlas('sienna-shatter.webp', Sh, [ground(f, x0, y0, 25) for f, (x0, y0) in Sh], SCS)
