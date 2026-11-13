# Briggs's DEFLECT shockwave (Nov 13): the user's ring sheet -> client/assets/sprites/fx/briggs-shock.webp
#   python3 tools/extract-briggs-shock.py
# Source: tools/art/briggs/shock/shockwave-sheet.png (2 x 2 = 4 looks of one oval ring: blazing, thinner, breaking up + smoke, embers;
# magenta background). The sheet was picked over the user's GIF of the same thing: full colour (the GIF is 256 colours, dithered),
# outlined smoke and less pink fringe.
# - Keying: "unmix" against magenta: a pixel that's magenta mixed with something (the soft glow, the see-through smoke of the last look)
#   gets the alpha / colour that mix implies, so there's no pink or purple fringe and the smoke stays soft.
# - Every look is re-centred on its ring and its ring's middle line measured (RX, RY in the cell) so the game can draw them all at the
#   same ring size while it grows the ring out to 1000px.
# - Scaled up UP x (Lanczos, premultiplied) and sharpened: the game draws it up to ~2000px wide.
import os
import numpy as np
from PIL import Image, ImageFilter
here = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.join(here, 'art', 'briggs', 'shock', 'shockwave-sheet.png'); A = os.path.join(here, '..', 'client', 'assets')
UP = 1.25

def unmix(rgb):   # rgb float (h, w, 3) -> rgba float, magenta (255, 0, 255) taken out
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    m = np.clip(np.minimum(r, b) - g, 0, 255)   # how much magenta is mixed in
    al = 1 - m / 255.0
    al = np.where(m > 200, 0, al)   # plain background (incl. its noise)
    al = np.clip((al - .04) / .96, 0, 1)
    M = np.array([255., 0, 255])
    F = (rgb - (1 - al[..., None]) * M) / np.maximum(al[..., None], 1e-3)
    F = np.clip(F, 0, 255)
    sm = (al < .85) & (F[..., 0] > F[..., 1] + 40) & (F[..., 2] > F[..., 1] + 40)   # still purple: make it a dark smoky brown-grey
    grey = F.mean(-1, keepdims=True); F = np.where(sm[..., None], np.concatenate([grey * 1.05, grey * .95, grey * .85], -1), F)
    return np.dstack([F, al * 255])

def resize_sharp(rgba, sc, pct=90, rad=1.6):
    a = rgba[..., 3:4] / 255; pm = np.clip(rgba[..., :3] * a, 0, 255).astype(np.uint8)
    w, h = round(rgba.shape[1] * sc), round(rgba.shape[0] * sc)
    up = lambda x: np.array(Image.fromarray(np.ascontiguousarray(x)).resize((w, h), Image.LANCZOS)).astype(np.float32)
    P = np.clip(np.dstack([up(pm[..., i]) for i in range(3)]), 0, 255); al = np.clip(up(np.clip(rgba[..., 3], 0, 255).astype(np.uint8)), 0, 255) / 255
    rgb = np.where(al[..., None] > .02, P / np.maximum(al[..., None], .02), 0)
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=rad, percent=pct, threshold=2))
    return Image.fromarray(np.dstack([np.array(img), (np.clip(al, 0, 1) * 255).astype(np.uint8)]))

src = np.array(Image.open(SRC).convert('RGB')).astype(np.float32); H, W = src.shape[:2]; cw, ch = W // 2, H // 2
looks = []
for i in range(4):
    c = src[(i // 2) * ch:(i // 2 + 1) * ch, (i % 2) * cw:(i % 2 + 1) * cw]; rgba = unmix(c)
    # the ring's bright core: its middle line (centre + radii) from the hot pixels (white / yellow / orange, not the rocks or smoke)
    r, g, b = c[..., 0], c[..., 1], c[..., 2]; hot = (r > 230) & (g > 120) & (b < 200) & (rgba[..., 3] > 200)
    ys, xs = np.where(hot); cx, cy = (np.percentile(xs, 1) + np.percentile(xs, 99)) / 2, (np.percentile(ys, 1) + np.percentile(ys, 99)) / 2
    row = np.abs(ys - cy) < ch * .05; col = np.abs(xs - cx) < cw * .04   # the hot band crossing the middle row / column: its middle = the ring's middle line
    RX = ((cx - np.median(xs[row & (xs < cx - 40)])) + (np.median(xs[row & (xs > cx + 40)]) - cx)) / 2
    RY = ((cy - np.median(ys[col & (ys < cy - 20)])) + (np.median(ys[col & (ys > cy + 20)]) - cy)) / 2
    R = float(RX); looks.append((rgba, cx, cy, R)); print(f'look {i}: centre {cx:.0f},{cy:.0f}  ring middle radius {RX:.0f} (x) / {RY:.0f} (y)  ratio {RY / RX:.3f}')
pad = 30; CW = int(round((cw + 2 * pad) * UP)); CH = int(round((ch + 2 * pad) * UP)); atlas = Image.new('RGBA', (CW * 2, CH * 2)); rads = []
for i, (rgba, cx, cy, R) in enumerate(looks):
    big = np.zeros((ch + 2 * pad, cw + 2 * pad, 4), np.float32); dx, dy = int(round(cw / 2 - cx)), int(round(ch / 2 - cy))   # re-centred on its ring
    ys0, ys1 = max(0, pad + dy), min(ch + 2 * pad, pad + dy + ch); xs0, xs1 = max(0, pad + dx), min(cw + 2 * pad, pad + dx + cw)
    big[ys0:ys1, xs0:xs1] = rgba[ys0 - pad - dy:ys1 - pad - dy, xs0 - pad - dx:xs1 - pad - dx]
    im = resize_sharp(big, UP); atlas.alpha_composite(im.crop((0, 0, CW, CH)), ((i % 2) * CW, (i // 2) * CH)); rads.append(round(R * UP, 1))
atlas.save(os.path.join(A, 'sprites', 'fx', 'briggs-shock.webp'), quality=88, alpha_quality=90, method=6)
print('shock atlas', atlas.size, 'cell', CW, CH, 'centre', CW / 2, CH / 2, 'ring middle radius (x) per look', rads)
