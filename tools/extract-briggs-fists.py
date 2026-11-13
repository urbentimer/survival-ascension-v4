# Briggs's R "BARE KNUCKLE" (Nov 13): the punch cone GIF + the card.
#   python3 tools/extract-briggs-fists.py
# Sources (tools/art/briggs/fists): cone.gif (16 frames x 60ms, 539x177, a cone of force opening to the RIGHT, magenta background, its tip drifts
# left as it grows), card.png. (gauntlets.png / power.png are cut into the juggernaut atlas by tools/cut-briggs.sh.)
# Writes client/assets/sprites/fx/briggs-punch.webp: 16 frames in a column, every frame shifted so its TIP is at (TX, TY) in the cell, keyed by
# "unmixing" the magenta (soft smoke and glow keep their see-through edges, no pink fringe), shrunk with Lanczos to the size the game draws the
# haymaker at (SC) and sharpened twice; and client/assets/icons/card-bareKnuckle.png (152x152).
import os
import numpy as np
from PIL import Image, ImageSequence, ImageFilter
here = os.path.dirname(os.path.abspath(__file__)); F = os.path.join(here, 'art', 'briggs', 'fists'); A = os.path.join(here, '..', 'client', 'assets')
LEN = 230   # game px from the tip to the far end of the fire (the haymaker reaches 190px; dust flies a bit past it)

def unmix(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    m = np.clip(np.minimum(r, b) - g, 0, 255); al = 1 - m / 255.0; al = np.where(m > 200, 0, al); al = np.clip((al - .04) / .96, 0, 1)
    M = np.array([255., 0, 255]); Fc = np.clip((rgb - (1 - al[..., None]) * M) / np.maximum(al[..., None], 1e-3), 0, 255)
    sm = (al < .9) & (Fc[..., 0] > Fc[..., 1] + 35) & (Fc[..., 2] > Fc[..., 1] + 35)   # still purple (smoke over magenta): warm grey-brown dust
    grey = Fc.mean(-1, keepdims=True); Fc = np.where(sm[..., None], np.concatenate([grey * 1.08, grey * .96, grey * .84], -1), Fc)
    pk = (al < .97) & (Fc[..., 2] > Fc[..., 1] * .9)   # leftover pink cast in the soft glow / smoke: blue pulled down under green (warm, like the fire)
    Fc[..., 2] = np.where(pk, np.minimum(Fc[..., 2], Fc[..., 1] * .8), Fc[..., 2]); Fc[..., 0] = np.where(pk & (Fc[..., 0] < Fc[..., 1] * 1.05), Fc[..., 1] * 1.08, Fc[..., 0])
    return np.dstack([Fc, al * 255])

frames = [np.array(f.convert('RGB')).astype(np.float32) for f in ImageSequence.Iterator(Image.open(os.path.join(F, 'cone.gif')))]
H, W = frames[0].shape[:2]; tips = []
for i, f in enumerate(frames):   # the tip: the left end of the bright core near the cone's middle line
    lum = f.max(-1); r, g, b = f[..., 0], f[..., 1], f[..., 2]; bright = (lum > 215) & (g > 150) & ~((r - g > 60) & (b - g > 60))
    ys, xs = np.where(bright)
    if len(xs) > 15:
        k = xs <= np.percentile(xs, 2) + 3; tips.append((float(xs[k].mean()), float(ys[k].mean())))
    else: tips.append(tips[-1])
tips = [(x, y) if i < 7 else (min(x, tips[6][0] + 6), tips[6][1]) for i, (x, y) in enumerate(tips)]   # (the late frames are faint: keep the last good tip)
print('tips', [(round(x), round(y)) for x, y in tips])
X0 = min(t[0] for t in tips); far = W - X0; SC = LEN / (far * .92); pad = 24
CW, CH = int(round((W - X0 + pad) * SC)) + 4, int(round((H + 2 * pad) * SC)); TX, TY = round(pad * .5 * SC), CH / 2
sheet = Image.new('RGBA', (CW, CH * len(frames)))
for i, f in enumerate(frames):
    rgba = unmix(f); tx, ty = tips[i]
    big = np.zeros((H + 2 * pad, int(W - X0) + 2 * pad, 4), np.float32); dx, dy = int(round(pad * .5 - tx + X0 * 0)) , int(round((H + 2 * pad) / 2 - ty))
    ox = int(round(pad * .5 - tx)); sx0 = max(0, -ox); dx0 = max(0, ox); w = min(W - sx0, big.shape[1] - dx0)
    sy0 = max(0, -dy); dy0 = max(0, dy); h = min(H - sy0, big.shape[0] - dy0)
    big[dy0:dy0 + h, dx0:dx0 + w] = rgba[sy0:sy0 + h, sx0:sx0 + w]
    a = big[..., 3:4] / 255; pm = np.clip(big[..., :3] * a, 0, 255).astype(np.uint8); size = (int(round(big.shape[1] * SC)), int(round(big.shape[0] * SC)))
    up = lambda x: np.array(Image.fromarray(np.ascontiguousarray(x)).resize(size, Image.LANCZOS)).astype(np.float32)
    P = np.clip(np.dstack([up(pm[..., c]) for c in range(3)]), 0, 255); al = np.clip(up(np.clip(big[..., 3], 0, 255).astype(np.uint8)), 0, 255) / 255
    rgb = np.where(al[..., None] > .02, P / np.maximum(al[..., None], .02), 0)
    im = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.8, percent=50, threshold=2)).filter(ImageFilter.UnsharpMask(radius=0.8, percent=150, threshold=3))
    im = Image.fromarray(np.dstack([np.array(im), (al * 255).astype(np.uint8)]))
    sheet.alpha_composite(im.crop((0, 0, CW, CH)), (0, i * CH))
sheet.save(os.path.join(A, 'sprites', 'fx', 'briggs-punch.webp'), quality=95, alpha_quality=100, method=6)
print('punch cone', sheet.size, 'cell', CW, CH, 'tip at', TX, TY, 'scale %.3f' % SC)
card = Image.open(os.path.join(F, 'card.png')).convert('RGB').resize((152, 152), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.0, percent=70, threshold=2))
card.save(os.path.join(A, 'icons', 'card-bareKnuckle.png')); print('card 152x152')
