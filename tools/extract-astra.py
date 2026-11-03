# Cuts Astra's effects, skill cards and portrait (his / the police / doctor / worker body sheets go through extract-directions.py):
#   python3 tools/extract-astra.py tools/art/astra
# Writes sprites/fx/astra-wall-h.png  4 cells 112x56  (foundation, half-built, complete, dismantle) - one tile of a north/south wall
#        sprites/fx/astra-wall-v.png  4 cells 48x104  (same frames) - one tile of an east/west wall
#        sprites/fx/astra-fx.png      4 cols x 2 rows of 96x64 cells: row 0 deploy beacon, row 1 healing pulse (bottom-centred)
#        icons/card-medicTeam.png, card-policeBackup.png, card-safehouse.png, portraits/dispatcher.webp
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage
root = sys.argv[1] if len(sys.argv) > 1 else 'tools/art/astra'
here = os.path.dirname(os.path.abspath(__file__)); A = os.path.join(here, '..', 'client', 'assets')

def keyed(path):
    rgb = np.array(Image.open(os.path.join(root, path)).convert('RGB')).astype(int)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    bg = (r > 200) & (b > 200) & (g < 90)
    soft = (r > 120) & (b > 120) & (g < 140) & (abs(r - b) < 60)
    for _ in range(2): bg = bg | (ndimage.binary_dilation(bg) & soft)
    return np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), (~bg).astype(np.uint8) * 255])

def frames(path, n=4):   # each blob goes to the column its centre is in; every frame keeps the same bottom line
    a = keyed(path); W = a.shape[1]
    lab, k = ndimage.label(a[..., 3] > 0, np.ones((3, 3))); groups = [[] for _ in range(n)]
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if (lab[sl] == i + 1).sum() < 20: continue
        groups[min(n - 1, int(((sl[1].start + sl[1].stop) / 2) // (W / n)))].append(i + 1)
    out = []
    for g in groups:
        m = np.isin(lab, g); ys, xs = np.where(m); part = a.copy(); part[~m, 3] = 0
        out.append(Image.fromarray(part).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)))
    return out

def strip(fr, cw, ch, sc, anchor='bottom', rows=None):
    im = Image.new('RGBA', (cw * len(fr), ch))
    for c, f in enumerate(fr):
        f = f.resize((max(1, round(f.width * sc)), max(1, round(f.height * sc))), Image.NEAREST)
        y = ch - f.height if anchor == 'bottom' else (ch - f.height) // 2
        im.alpha_composite(f, (c * cw + (cw - f.width) // 2, max(0, y)))
    return im

fx = os.path.join(A, 'sprites', 'fx')
h = frames('effects/wall-horizontal.png'); sc = 112 / max(f.width for f in h); strip(h, 112, 56, sc).save(os.path.join(fx, 'astra-wall-h.png'), optimize=True)
v = frames('effects/wall-vertical.png'); sc = 104 / max(f.height for f in v); strip(v, 48, 104, sc).save(os.path.join(fx, 'astra-wall-v.png'), optimize=True)
atlas = Image.new('RGBA', (96 * 4, 64 * 2))
b = frames('effects/deploy-beacon.png'); atlas.alpha_composite(strip(b, 96, 64, 90 / max(f.width for f in b), 'center'), (0, 0))
p = frames('effects/healing-pulse.png'); atlas.alpha_composite(strip(p, 96, 64, 70 / max(f.width for f in p)), (0, 64))
atlas.save(os.path.join(fx, 'astra-fx.png'), optimize=True)

def grey_and_pack(path, grey=False):   # lavender wall panels -> neutral concrete like the front walls; 256 colours keeps the preview small
    a = np.array(Image.open(path).convert('RGBA')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    if grey:
        m = (a[..., 3] > 0) & (b > g + 6) & (r > g) & ((r + g + b) / 3 > 60) & (abs(r - b) < 60); v = (r + g + b) / 3
        for c in range(3): a[..., c][m] = np.clip(v[m] - (2 if c == 2 else 0), 0, 255)
    Image.fromarray(a.astype(np.uint8)).quantize(256, method=Image.FASTOCTREE, dither=Image.NONE).save(path, optimize=True)
for f in ['astra-wall-h.png', 'astra-wall-v.png']: grey_and_pack(os.path.join(fx, f), True)
grey_and_pack(os.path.join(fx, 'astra-fx.png'))

for src, name in [('card-E.png', 'medicTeam'), ('card-Q.png', 'policeBackup'), ('card-R.png', 'safehouse')]:
    Image.open(os.path.join(root, 'skill-cards', src)).convert('RGBA').resize((152, 152), Image.LANCZOS).save(os.path.join(A, 'icons', f'card-{name}.png'))

src = Image.open(os.path.join(root, 'portrait.png')).convert('RGB'); arr = np.array(src).astype(int)   # same dark-red backdrop as the other portraits
dark = arr.max(2) < 24; lab, _ = ndimage.label(dark); h2 = arr.shape[0] // 2; edge = set(np.unique(np.concatenate([lab[0], lab[:h2, 0], lab[:h2, -1]]))) - {0}   # seed from the top only: his dark coat touches the bottom
bgm = np.isin(lab, list(edge)) & ~ndimage.binary_fill_holes(ndimage.binary_closing(~dark, iterations=10)); H, W = bgm.shape; yy, xx = np.mgrid[0:H, 0:W]   # never inside his silhouette; yy, xx = np.mgrid[0:H, 0:W]
glow = np.clip(1 - np.hypot((xx - W * .5) / (W * .7), (yy - H * .15) / (H * .4)), 0, 1)
rng = np.random.default_rng(7); streak = ndimage.gaussian_filter(rng.random(((H + 7) // 8, (W + 7) // 8)), 2); streak = np.kron(streak, np.ones((8, 8)))[:H, :W]
back = np.dstack([18 + 110 * glow * (.6 + .8 * streak), 8 + 12 * glow, 10 + 12 * glow]); arr[bgm] = back[bgm].astype(int)
cw = int(W * .62); ch = int(cw / 1.483); x0 = (W - cw) // 2 - int(W * .02); y0 = int(H * .03)   # head and shoulders, like the others
Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).crop((x0, y0, x0 + cw, y0 + ch)).resize((264, 178), Image.LANCZOS).save(os.path.join(A, 'portraits', 'dispatcher.webp'), quality=92)
print('astra walls, fx, cards, portrait done')
# Body sheets: extract-directions.py dispatcher / astra-police / astra-doctor / astra-worker (see HANDOFF.md), then tools/depink.py on each atlas.
