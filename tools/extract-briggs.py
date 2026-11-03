# Cuts Briggs's effect sheets + skill cards (his walking/skill-pose sheets go through extract-directions.py):
#   python3 tools/extract-briggs.py tools/art/briggs
# Writes sprites/fx/briggs-fx.png: 6 columns x 5 rows of 220x150 cells, every frame scaled the same within its row and
# kept where the artist put it inside its column, so the animation doesn't wobble:
#   row 0 dome forming (frames 0-2) + steady loop (3-5)      row 1 dome hit sparks (spark on the RIGHT side)
#   row 2 dome shatter                                        row 3 War Cry shockwave ring    row 4 rage aura loop
# and icons/card-ironBastion.png, icons/card-warCry.png (152x152).
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage
root = sys.argv[1] if len(sys.argv) > 1 else 'tools/art/briggs'
here = os.path.dirname(os.path.abspath(__file__)); A = os.path.join(here, '..', 'client', 'assets')
CW, CH = 220, 150

def keyed(path, deglass=False):
    rgb = np.array(Image.open(os.path.join(root, path)).convert('RGB')).astype(int)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    bg = (r > 200) & (b > 200) & (g < 90)
    soft = (r > 120) & (b > 120) & (g < 140) & (abs(r - b) < 60)
    for _ in range(2): bg = bg | (ndimage.binary_dilation(bg) & soft)
    alpha = (~bg).astype(np.uint8) * 255
    # semi-transparent glow drawn over magenta (dome glass, ring haze): pull the magenta out instead of keeping it pink
    pinkish = (~bg) & (r > 150) & (b > 150) & (g < 120) & (abs(r - b) < 70)
    alpha[pinkish] = 90; rgb[pinkish] = np.stack([np.full(pinkish.sum(), 255), 150 + g[pinkish] * .3, 70 + g[pinkish] * .2], -1)   # see-through glass: warm amber
    if deglass:   # the dome's glass was painted with the magenta showing through: make it smoky amber glass instead
        glass = (alpha > 0) & (b > g + 25) & (r > g + 25)
        lum = (r * .3 + g * .5 + b * .2)[glass]
        rgb[glass] = np.stack([np.minimum(255, lum * 1.25 + 20), lum * .78, lum * .42], -1); alpha[glass] = 175
    return np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), alpha])

def bands(rgba, n):
    occ = (rgba[..., 3] > 0).sum(1) > 3; ys = np.where(occ)[0]
    runs, a = [], ys[0]
    for i in range(1, len(ys)):
        if ys[i] - ys[i - 1] > 25: runs.append((a, ys[i - 1] + 1)); a = ys[i]
    runs.append((a, ys[-1] + 1))
    while len(runs) > n: i = int(np.argmin([runs[j + 1][0] - runs[j][1] for j in range(len(runs) - 1)])); runs[i:i + 2] = [(runs[i][0], runs[i + 1][1])]
    return runs

def put_row(atlas, rgba, y0, y1, row, anchor='bottom'):
    # every blob goes to the column its centre is in, so a big frame that spills past its column stays whole
    band = rgba[y0:y1]; W = band.shape[1]; pitch = W / 6
    lab, n = ndimage.label(band[..., 3] > 0, np.ones((3, 3)))
    frames = [np.zeros(band.shape[:2], bool) for _ in range(6)]
    for i, sl in enumerate(ndimage.find_objects(lab)):
        c = min(5, int(((sl[1].start + sl[1].stop) / 2) // pitch)); frames[c] |= lab == i + 1
    boxes = []
    for m in frames:
        ys, xs = np.where(m); boxes.append((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1) if len(xs) else None)
    t = min(b[1] for b in boxes if b); bt = max(b[3] for b in boxes if b); wmax = max(b[2] - b[0] for b in boxes if b)
    sc = min((CW - 8) / wmax, (CH - 8) / (bt - t))
    for c, (m, bx) in enumerate(zip(frames, boxes)):
        if not bx: continue
        part = band.copy(); part[~m, 3] = 0
        if anchor == 'center':   # rings: centre on the bright ring itself (smoke and rocks make the box lopsided)
            br = m & (band[..., :3].astype(int).sum(-1) > 560); ys, xs = np.where(br if br.sum() > 30 else m)
            cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
            x0, y0 = round(cx - wmax / 2), round(cy - (bt - t) / 2)
            im = Image.fromarray(part).crop((x0, y0, x0 + wmax, y0 + bt - t))
        else:   # domes: keep the artist's spot in the column
            x0 = round((c + .5) * pitch - wmax / 2)
            im = Image.fromarray(part).crop((x0, t, x0 + wmax, bt))
        im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
        ox = c * CW + (CW - im.width) // 2; oy = row * CH + (CH - 4 - im.height if anchor == 'bottom' else (CH - im.height) // 2)
        atlas.alpha_composite(im, (ox, oy))
    return sc

atlas = Image.new('RGBA', (CW * 6, CH * 5))
form = keyed('dome-form.png', True); (a, b), = bands(form, 1); put_row(atlas, form, a, b, 0)
hs = keyed('dome-hit-shatter.png', True); rows = bands(hs, 2); put_row(atlas, hs, *rows[0], 1); put_row(atlas, hs, *rows[1], 2)
wc = keyed('warcry-fx.png'); rows = bands(wc, 2); put_row(atlas, wc, *rows[0], 3, 'center'); put_row(atlas, wc, *rows[1], 4)
p = os.path.join(A, 'sprites', 'fx', 'briggs-fx.png'); atlas.save(p)
Image.open(p).quantize(256, method=Image.FASTOCTREE, dither=Image.NONE).save(p, optimize=True)

cards = np.array(Image.open(os.path.join(root, 'cards.png')).convert('RGB')).astype(int)
fg = ~((cards[..., 0] > 200) & (cards[..., 2] > 200) & (cards[..., 1] < 90))
lab, n = ndimage.label(ndimage.binary_opening(fg, iterations=3)); sizes = ndimage.sum(fg, lab, range(1, n + 1))
big = sorted([ndimage.find_objects(lab)[i] for i in np.argsort(sizes)[-2:]], key=lambda s: s[1].start)
for name, sl in zip(['ironBastion', 'warCry'], big):
    crop = cards[sl[0], sl[1]].astype(np.uint8); m = fg[sl[0], sl[1]]
    im = Image.fromarray(np.dstack([crop, (m * 255).astype(np.uint8)])).resize((152, 152), Image.LANCZOS)
    im.save(os.path.join(A, 'icons', f'card-{name}.png'))
print('briggs fx + cards done')
