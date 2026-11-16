# Sienna's skill effects (Nov 16) -> client/assets/sprites/fx/sienna-*.webp
#   python3 tools/extract-sienna-fx.py   (run by tools/cut-sienna.sh)
# Sources (tools/art/sienna, magenta background, ChatGPT):
#   6-grenade-burst.png: 6 frames in a row: the canister (-> the thrown grenade), white starburst, crystals + frost ring, the big burst with
#     snow puffs, the frozen patch, the fading patch.            -> sienna-burst.webp (frames 1-5) + sienna-grenade.webp (the canister)
#   7-tower.png: 2 x 4: ice spreading, crystals shooting up, the tower rising, the full tower (sparkle), tower, cracking, breaking, rubble.
#                                                                -> sienna-tower.webp (8 frames; Q: she stands on its top)
#   8-shatter.png: 6 frames: a solid ice block (R: the decoy she leaves), glowing cracks, bursting apart, shards flying, the patch, fading.
#                                                                -> sienna-shatter.webp (6 frames)
# Frames are found by grouping the art's pieces round each frame's centre (the burst's snow ring spills past an even grid), keyed by
# "unmixing" the magenta (soft see-through edges, no pink fringe), shrunk premultiplied and sharpened. Every frame sits on a shared GROUND point
# (GX, GY in its cell) so the client draws it centred on the spot. Scales: the big burst = the 120px blast circle; the tower's top fits her
# feet; the ice block is a little bigger than her (57px tall). Prints each atlas's cell size, ground point and (tower) the top's height.
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(here, 'art', 'sienna'); FX = os.path.join(here, '..', 'client', 'assets', 'sprites', 'fx')

def unmix(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    m = np.clip(np.minimum(r, b) - g, 0, 255); al = 1 - m / 255.0; al = np.where(m > 200, 0, al); al = np.clip((al - .04) / .96, 0, 1)
    M = np.array([255., 0, 255]); Fc = np.clip((rgb - (1 - al[..., None]) * M) / np.maximum(al[..., None], 1e-3), 0, 255)
    pur = (Fc[..., 0] - Fc[..., 1] > 14) & (Fc[..., 2] - Fc[..., 1] > 14)   # purple cast left in the ice: pale ice blue instead (nothing here is purple)
    lum = Fc.mean(-1, keepdims=True); Fc = np.where(pur[..., None], np.concatenate([lum * .86, lum * .97, np.minimum(255, lum * 1.1)], -1), Fc)
    return np.dstack([np.clip(Fc, 0, 255), al * 255])

def frames(name, centres, rows=None):
    """centres: [(x, y)] of each frame (source px); returns [(rgba, (x0, y0))] per frame, pieces grouped by the nearest centre"""
    a = np.array(Image.open(os.path.join(R, name)).convert('RGB')).astype(np.float32); rgba = unmix(a)
    solid = ndimage.binary_opening(rgba[..., 3] > 40, iterations=1); grown = ndimage.binary_dilation(solid, iterations=6)
    lab, n = ndimage.label(grown); C = np.array(centres, np.float32); owner = np.zeros(n + 1, int) - 1
    for i, sl in enumerate(ndimage.find_objects(lab)):
        ys, xs = np.where(lab[sl] == i + 1)
        if len(ys) < 40: continue
        cy, cx = ys.mean() + sl[0].start, xs.mean() + sl[1].start
        owner[i + 1] = int(np.argmin(np.hypot(C[:, 0] - cx, (C[:, 1] - cy) * 1.5)))
    out = []
    for k in range(len(centres)):
        m = np.isin(lab, np.where(owner == k)[0]) & (rgba[..., 3] > 0); ys, xs = np.where(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        f = rgba[y0:y1, x0:x1].copy(); f[..., 3] *= m[y0:y1, x0:x1]; out.append((f, (x0, y0)))
    return out

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

def foot(f, x0, y0, band):   # centre x of the frame's bottom band
    m = f[..., 3] > 60; ys, xs = np.where(m); yb = ys.max(); sel = ys > yb - band
    return x0 + xs[sel].mean()

# 1. Cryo grenade burst: the big burst (frame 3) is 240px across in game (the 120px blast radius); the ground point = the frost ring's centre
B = frames('6-grenade-burst.png', [(174, 360), (513, 362), (850, 380), (1235, 380), (1600, 390), (1969, 390)])
ring = B[3]; SCB = 240 / ring[0].shape[1]
GYB = 392   # the frost ring's middle line (frames 2-5 share it on the sheet)
atlas('sienna-burst.webp', B[1:], [(foot(f, x0, y0, 40), GYB) for f, (x0, y0) in B[1:]], SCB)
can, (cx0, cy0) = B[0]; m = can[..., 3] > 60; lab, n = ndimage.label(m); big = 1 + int(np.argmax(ndimage.sum(m, lab, range(1, n + 1))))
ys, xs = np.where(lab == big); can = can[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy(); can[..., 3] *= (lab == big)[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
g = shrink(can, 20 / can.shape[1]); cell = Image.new('RGBA', (24, 24)); cell.alpha_composite(g, ((24 - g.width) // 2, (24 - g.height) // 2))
cell.save(os.path.join(FX, 'sienna-grenade.webp'), quality=94, alpha_quality=100, method=6); print('sienna-grenade.webp: 24x24 (the canister, centred)')

# 2. Ice tower: its top platform ~54px across (frame 4's top is ~230 src px), the ground point = the base's middle (30 src px above the bottom)
T = frames('7-tower.png', [(165, 380), (464, 380), (770, 360), (1070, 330), (169, 880), (471, 880), (767, 880), (1072, 960)])
SCT = 54 / 230
gT = []
for k, (f, (x0, y0)) in enumerate(T):
    bottom = (484 if k < 4 else 1019); gT.append((foot(f, x0, y0, 50), bottom - 30))
CW, CH, GX, GY = atlas('sienna-tower.webp', T, gT, SCT, cols=8)
top = 762   # frame 4's top platform middle (source y)
print(f'  tower top: {round((1019 - 30 - top) * SCT)} game px above the ground point')

# 3. Ice block / shatter: the block (frame 0) ~62px tall (she is 57); ground point = the block's base (20 src px above the bottom)
Sh = frames('8-shatter.png', [(205, 350), (560, 350), (906, 340), (1261, 340), (1635, 350), (1985, 450)])
SCS = 62 / Sh[0][0].shape[0]
atlas('sienna-shatter.webp', Sh, [(foot(f, x0, y0, 40), 470) for f, (x0, y0) in Sh], SCS)
