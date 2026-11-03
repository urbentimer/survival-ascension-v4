# Cuts Sofea the Operator's vehicle/effect/card/portrait art (from her character kit) into game assets.
# Her walking sheets go through extract-directions.py (PINK_HAIR=1 python3 tools/extract-directions.py operator gun=... radio=...!4).
# Uses the kit's reference/frame-map.json (measured source rectangles) to find each frame.
#   python3 tools/extract-sofea.py tools/art/sofea
# Writes:
#   sprites/zombies/dir8/sofea-tank.png    8 rows x 4 hull frames | 4 turret frames (cells 150x140, pivot = cell centre)
#   sprites/zombies/dir8/sofea-heli.png    8 rows x 4 rotor frames (cells 190x150, pivot = cell centre)
#   sprites/fx/sofea-fx.png                rows: rocket x6, shell x4, explosion x6, dust x6 (cells 128x128, centred)
#   icons/card-steelConvoy.png, icons/card-skyReign.png, portraits/operator.webp
import sys, os, json
import numpy as np
from PIL import Image
from scipy import ndimage
root = sys.argv[1] if len(sys.argv) > 1 else 'tools/art/sofea'
here = os.path.dirname(os.path.abspath(__file__)); A = os.path.join(here, '..', 'client', 'assets')
fmap = json.load(open(os.path.join(root, 'reference', 'frame-map.json')))['sheets']

def mask_of(rgb):                       # magenta background, keyed tightly so pink hair survives
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    bg = (r > 190) & (b > 190) & (g < 90) & (abs(r - b) < 40)
    soft = (r > 120) & (b > 120) & (g < 120) & (abs(r - b) < 40)
    for _ in range(2): bg = bg | (ndimage.binary_dilation(bg) & soft)
    return ~bg

def frame(sheet, rect, img):
    x, y, w, h = rect; rgb = img[y:y + h, x:x + w]
    m = mask_of(rgb); lab, n = ndimage.label(m, np.ones((3, 3)))
    if n == 0: return None
    sizes = ndimage.sum(m, lab, range(1, n + 1)); big = sizes.max()
    keep = np.isin(lab, [i + 1 for i in range(n) if sizes[i] > max(20, big * .004)])
    ys, xs = np.where(keep); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub = keep[y0:y1, x0:x1]; col = rgb[y0:y1, x0:x1].copy()
    edge = sub & ~ndimage.binary_erosion(sub)
    pink = edge & (col[..., 0] > col[..., 1] + 60) & (col[..., 2] > col[..., 1] + 60) & (abs(col[..., 0].astype(int) - col[..., 2]) < 50)
    col[pink] = (col[pink] * .3).astype(np.uint8)
    rgba = np.dstack([col, (sub * 255).astype(np.uint8)])
    core = ndimage.binary_erosion(sub, iterations=6)          # drop thin parts (barrel, rotor blades) for the pivot
    if core.sum() < 50: core = sub
    cy, cx = ndimage.center_of_mass(core)
    return Image.fromarray(rgba), cx, cy

def cut(name):
    info = fmap[name]; img = np.array(Image.open(os.path.join(root, name)).convert('RGB'))
    out = {}
    for f in info['frames']:
        r = frame(name, f['source_rect_xywh'], img)
        if r: out[(f['row'], f['column'])] = r
    return out

def put(atlas, im, cx, cy, scale, cell, row, col, pivot=None):
    cw, ch = cell; px, py = pivot or (cw / 2, ch / 2)
    sw, sh = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    small = im.resize((sw, sh), Image.LANCZOS); a = np.array(small); a[..., 3] = (a[..., 3] > 110) * 255; small = Image.fromarray(a)
    x, y = round(col * cw + px - cx * scale), round(row * ch + py - cy * scale)
    box = Image.new('RGBA', atlas.size); box.alpha_composite(small, (max(0, x), max(0, y)), (max(0, -x), max(0, -y)))
    clipped = box.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))
    atlas.alpha_composite(clipped, (col * cw, row * ch))
    if sw > cw or sh > ch: print(f'    note: {sw}x{sh} frame clipped to {cw}x{ch} (row {row} col {col})')

def quantize(path):
    im = Image.open(path).convert('RGBA'); im.quantize(256, method=Image.FASTOCTREE, dither=Image.NONE).save(path, optimize=True)

# --- tank: hull (cols 0-3) + turret (cols 4-7), same scale; hull length ~120px from the side view
hull, tur = cut('sprites/tank-hull.png'), cut('sprites/tank-turret.png')
side = np.median([hull[(2, c)][0].width for c in range(4) if (2, c) in hull]); ts = 120 / side
TC = (150, 140); tank = Image.new('RGBA', (TC[0] * 8, TC[1] * 8))
for (r, c), (im, cx, cy) in hull.items(): put(tank, im, cx, cy, ts, TC, r, c)
for (r, c), (im, cx, cy) in tur.items(): put(tank, im, cx, cy, ts, TC, r, c + 4)
p = os.path.join(A, 'sprites', 'zombies', 'dir8', 'sofea-tank.png'); tank.save(p); quantize(p); print('tank scale', round(ts, 3))

# --- helicopter: side view ~150px long
heli = cut('sprites/helicopter.png')
side = np.median([heli[(2, c)][0].width for c in range(4) if (2, c) in heli]); hs = 150 / side
HC = (190, 150); hat = Image.new('RGBA', (HC[0] * 4, HC[1] * 8))
for (r, c), (im, cx, cy) in heli.items(): put(hat, im, cx, cy, hs, HC, r, c)
p = os.path.join(A, 'sprites', 'zombies', 'dir8', 'sofea-heli.png'); hat.save(p); quantize(p); print('heli scale', round(hs, 3))

# --- effects: one row each, frames centred in 128px cells; sizes: rocket ~34px long, shell ~30px, explosion/dust up to ~124px
FC = (128, 128); fx = Image.new('RGBA', (FC[0] * 6, FC[1] * 4))
for row, (name, size, by) in enumerate([('effects/rocket.png', 34, 'w'), ('effects/cannon-shell.png', 30, 'w'), ('effects/explosion.png', 124, 'max'), ('effects/deployment-dust.png', 118, 'max')]):
    fr = cut(name); dims = [max(im.width, im.height) if by == 'max' else im.width for im, _, _ in fr.values()]
    sc = size / max(dims)
    for (_, c), (im, cx, cy) in fr.items():
        if by == 'max': cx, cy = im.width / 2, im.height / 2 if 'explosion' not in name else im.height * .6
        put(fx, im, cx, cy, sc, FC, row, c)
p = os.path.join(A, 'sprites', 'fx', 'sofea-fx.png'); fx.save(p); quantize(p)

# --- skill cards: two cards on black, side by side
cards = np.array(Image.open(os.path.join(root, 'skill-cards', 'skill-cards.png')).convert('RGB')).astype(int)
lit = cards.max(2) > 40; cols = np.where(lit.any(0))[0]; gaps = np.where(np.diff(cols) > 8)[0]
mid = (cols[gaps[0]] + cols[gaps[0] + 1]) // 2 if len(gaps) else cards.shape[1] // 2
for name, x0, x1 in [('steelConvoy', 0, mid), ('skyReign', mid, cards.shape[1])]:
    part = lit[:, x0:x1]; ys, xs = np.where(part); box = (x0 + xs.min(), ys.min(), x0 + xs.max() + 1, ys.max() + 1)
    Image.open(os.path.join(root, 'skill-cards', 'skill-cards.png')).convert('RGBA').crop(box).resize((152, 152), Image.LANCZOS).save(os.path.join(A, 'icons', f'card-{name}.png'))

# --- portrait: head + shoulders on a dark red painted backdrop, 264x178 like the others
src = Image.open(os.path.join(root, 'reference', 'portrait.png')).convert('RGB'); arr = np.array(src).astype(int)
dark = arr.max(2) < 28; lab, _ = ndimage.label(dark); edge_ids = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bgm = np.isin(lab, list(edge_ids))
H, W = bgm.shape; yy, xx = np.mgrid[0:H, 0:W]
glow = np.clip(1 - np.hypot((xx - W * .62) / (W * .7), (yy - H * .12) / (H * .35)), 0, 1)
rng = np.random.default_rng(3); streak = ndimage.gaussian_filter(rng.random((H // 8, W // 8)), 2); streak = np.kron(streak, np.ones((8, 8)))[:H, :W]
back = np.dstack([18 + 120 * glow * (.6 + .8 * streak), 8 + 14 * glow, 10 + 14 * glow])
arr[bgm] = back[bgm].astype(int)
crop = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).crop((170, 10, 170 + 640, 10 + 431)).resize((264, 178), Image.LANCZOS)
crop.save(os.path.join(A, 'portraits', 'operator.webp'), quality=92)
print('done: tank, heli, fx, cards, portrait')
