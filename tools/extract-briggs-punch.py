# Briggs's R "BARE KNUCKLE" punch shockwave v2 (Nov 15): the user's two white punch-through sheets -> client/assets/sprites/fx/briggs-punch.webp
#   python3 tools/extract-briggs-punch.py
# Source: tools/art/briggs/punch/punch-white.png: a 2 x 4 sheet, 8 frames (magenta background), clean white force with no outline, a cone
# opening to the RIGHT from the middle of each frame's left edge (starburst + ring pop -> cone -> big double wavefront -> streaks -> specks).
# (Nov 15) The user first got two sheets; the outlined one with rocks + dust (punch-outlined.png) was the haymaker for a bit, then the user chose
# this clean one for every punch (the haymaker is just drawn bigger). White alone vanishes on snow / pale sand, so a SOFT dark halo goes under
# it (not a hard ink line: the clean look stays).
# Atlas: 8 cells in one row (CW x CH game px), every frame shifted so its tip (the middle of the burst's flat left edge) sits at (TX, TY). Keyed
# by "unmixing" the magenta (soft edges keep their see-through falloff, no pink fringe), shrunk with premultiplied Lanczos and sharpened twice.
# The client cross-fades the frames (eased timing) so the 8 frames play smooth.
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); P = os.path.join(here, 'art', 'briggs', 'punch'); A = os.path.join(here, '..', 'client', 'assets')
LEN = 228       # game px from the tip to the far edge of the big wavefront (frame 4) for the haymaker (it reaches 190px; the wave flies past it)
HALO = (5, 3.0, .5)   # the soft dark halo: grow by 5 src px, blur 3 src px, 50% strong (~2-3 game px of soft shadow round the white)
INK = np.array([16, 20, 30], np.float32)

def unmix(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    m = np.clip(np.minimum(r, b) - g, 0, 255); al = 1 - m / 255.0; al = np.where(m > 200, 0, al); al = np.clip((al - .04) / .96, 0, 1)
    M = np.array([255., 0, 255]); Fc = np.clip((rgb - (1 - al[..., None]) * M) / np.maximum(al[..., None], 1e-3), 0, 255)
    pur = (Fc[..., 0] - Fc[..., 1] > 14) & (Fc[..., 2] - Fc[..., 1] > 14)   # any purple cast left: cool grey (the art is white / grey / ink only)
    grey = Fc.mean(-1, keepdims=True); Fc = np.where(pur[..., None], np.concatenate([grey * .98, grey * .99, grey * 1.04], -1), Fc)
    return np.dstack([np.clip(Fc, 0, 255), al * 255])

def frames(name):
    a = np.array(Image.open(os.path.join(P, name)).convert('RGB')).astype(np.float32); H, W = a.shape[:2]; out = []
    REG = [0] + [round(j * W / 4) - 8 for j in (1, 2, 3)] + [W]   # the frames' x ranges in each row (each burst starts just right of its quarter line)
    for k in range(8):
        y0, y1 = (0, H // 2) if k < 4 else (H // 2, H); c = a[y0:y1, REG[k % 4]:REG[k % 4 + 1]]
        rgba = unmix(c); solid = ndimage.binary_opening(rgba[..., 3] > 40, iterations=1)
        ys, xs = np.where(solid); left = xs.min(); lm = xs <= left + 8; tip = (float(left), float(ys[lm].mean()))
        rgba[..., 3] *= ndimage.binary_dilation(solid, iterations=2)   # drop stray specks of background noise
        g, bl, st = HALO; yy, xx = np.mgrid[-g:g + 1, -g:g + 1]; disc = (xx * xx + yy * yy) <= g * g + 1
        ring = ndimage.gaussian_filter(ndimage.grey_dilation(rgba[..., 3], footprint=disc), bl) * st
        al = rgba[..., 3:4] / 255; ra = ring[..., None] / 255
        outA = al + ra * (1 - al); col = (rgba[..., :3] * al + INK * ra * (1 - al)) / np.maximum(outA, 1e-3)
        out.append((np.dstack([col, outA[..., 0] * 255]), tip))
    return out

def shrink(rgba, sc):
    h, w = rgba.shape[:2]; a = rgba[..., 3:4] / 255; size = (round(w * sc), round(h * sc))
    pm = np.dstack([np.clip(rgba[..., :3] * a, 0, 255), rgba[..., 3:4]]).astype(np.uint8)
    s = np.array(Image.fromarray(pm, 'RGBA').resize(size, Image.LANCZOS)).astype(np.float32); al = s[..., 3:4] / 255
    rgb = np.where(al > .02, s[..., :3] / np.maximum(al, .02), 0)
    im = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.6, percent=45, threshold=2)).filter(ImageFilter.UnsharpMask(radius=.7, percent=130, threshold=2))
    al = np.clip((al[..., 0] - .03) / .97, 0, 1)   # crisp edge: the faintest resample haze goes
    return Image.fromarray(np.dstack([np.array(im), (al * 255).astype(np.uint8)]), 'RGBA')

rows = [frames('punch-white.png')]
far = max(np.where(r[..., 3].max(0) > 40)[0].max() - t[0] for row in rows for r, t in [row[3]])   # frame 4: the big wavefront
SC = LEN / far
up = max(t[1] - np.where(r[..., 3].max(1) > 40)[0].min() for row in rows for r, t in row); dn = max(np.where(r[..., 3].max(1) > 40)[0].max() - t[1] for row in rows for r, t in row)
rt = max(np.where(r[..., 3].max(0) > 40)[0].max() - t[0] for row in rows for r, t in row)
TX = 4; CW = int(np.ceil((rt + 6) * SC)) + TX + 2; TY = int(np.ceil((up + 6) * SC)) + 1; CH = TY + int(np.ceil((dn + 6) * SC)) + 1
atlas = Image.new('RGBA', (CW * 8, CH * len(rows)))
for ri, row in enumerate(rows):
    for k, (rgba, (tx, ty)) in enumerate(row):
        s = shrink(rgba, SC); cell = Image.new('RGBA', (CW, CH)); cell.alpha_composite(s, (round(TX - tx * SC), round(TY - ty * SC)))
        atlas.alpha_composite(cell, (k * CW, ri * CH))
atlas.save(os.path.join(A, 'sprites', 'fx', 'briggs-punch.webp'), quality=95, alpha_quality=100, method=6)
print('punch atlas', atlas.size, 'cell', CW, CH, 'tip at', TX, TY, 'scale %.3f' % SC, 'far', far)
