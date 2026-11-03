# Sofea v2 art (Nov 2026, green-screen sheets) -> game assets. Afterwards quantize dir8/operator.png to 256 colours (preview size). Her body sheets go through extract-directions.py
# (PINK_HAIR=1 ... operator gun=ak.png%229x143.125 knife= bat= axe= radio=radio-even.png!4%260x200, radio-even.png from even-grid.py).
#   python3 tools/extract-sofea2.py tools/art/sofea2
# Writes:
#   sprites/zombies/dir8/sofea-tank.png   8 rows x 2 cols of 180x150 (col 0 hull + short turret, col 1 cannon pointing that way); pivot = cell centre
#   sprites/zombies/dir8/sofea-heli.png   8 rows x 4 rotor frames, 190x150 (same layout as before)
#   sprites/fx/sofea-fx.png               128px cells: 0 shell x6, 1 rocket x6, 2 muzzle big x3 + small x3, 3 big explosion x6, 4 small explosion x6, 5 dust x6 (kept)
#   assets/hero/operator.webp (lobby), portraits/operator.webp (face card, only if tools/art/faces/operator.png doesn't exist: extract-faces.py does that one), icons/card-steelConvoy.png / card-skyReign.png
import sys, os, glob
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
root = sys.argv[1] if len(sys.argv) > 1 else 'tools/art/sofea2'
here = os.path.dirname(os.path.abspath(__file__)); A = os.path.join(here, '..', 'client', 'assets')

def green(path):   # RGBA with the green screen removed (and green spill pulled off the outline)
    a = np.array(Image.open(os.path.join(root, path)).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    core = (g > 170) & (g - np.maximum(r, b) > 90); soft = (g > 100) & (g - np.maximum(r, b) > 40)
    bg = core.copy()
    for _ in range(3): bg = ndimage.binary_dilation(bg) & (core | soft)
    bg |= core
    near = ndimage.binary_dilation(bg, iterations=2) & ~bg; mx = np.maximum(r, b); sp = near & (g > mx); a[..., 1][sp] = mx[sp]
    return np.dstack([np.clip(a, 0, 255), (~bg) * 255]).astype(np.uint8)

def magenta_unmix(path):   # effects drawn over magenta: see-through smoke becomes real see-through grey, not purple
    a = np.array(Image.open(os.path.join(root, path)).convert('RGB')).astype(float) / 255; r, g, b = a[..., 0], a[..., 1], a[..., 2]
    al = np.clip(1 - np.clip(np.minimum(r, b) - g, 0, 1) * 1.08, 0, 1)
    al[(r > .8) & (b > .8) & (g < .3)] = 0; al[al < .08] = 0
    col = np.clip((a - (1 - al)[..., None] * np.array([1, 0, 1])) / np.maximum(al, 1e-3)[..., None], 0, 1)
    col[..., 2] = np.minimum(col[..., 2], np.maximum(col[..., 1], col[..., 0] * .6))   # no purple left in smoke edges
    return np.dstack([col * 255, al * 255]).astype(np.uint8)

def cells(rgba, rows, cols):   # split on an even grid, each cell -> (image, bbox inside cell)
    H, W = rgba.shape[:2]; ph, pw = H / rows, W / cols; out = {}
    for r in range(rows):
        for c in range(cols):
            y0, y1, x0, x1 = round(r * ph), round((r + 1) * ph), round(c * pw), round((c + 1) * pw)
            cell = rgba[y0:y1, x0:x1]; m = cell[..., 3] > 40
            lab, n = ndimage.label(m, np.ones((3, 3)))
            if not n: continue
            sizes = ndimage.sum(m, lab, range(1, n + 1)); boxes = ndimage.find_objects(lab); mb = boxes[int(np.argmax(sizes))]
            near = lambda bx: bx[0].start < mb[0].stop + 12 and bx[0].stop > mb[0].start - 12 and bx[1].start < mb[1].stop + 40 and bx[1].stop > mb[1].start - 40
            keep = np.isin(lab, [i + 1 for i in range(n) if sizes[i] > max(15, sizes.max() * .003) and near(boxes[i])])   # no slivers from the next row
            ys, xs = np.where(keep); part = cell.copy(); part[~keep, 3] = 0
            out[(r, c)] = Image.fromarray(part[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    return out

def pivot(im, er=6):   # centre of the solid body (thin barrels / rotor blades ignored)
    m = np.array(im)[..., 3] > 110; core = ndimage.binary_erosion(m, iterations=er)
    if core.sum() < 50: core = m
    cy, cx = ndimage.center_of_mass(core); return cx, cy

def put(atlas, im, cx, cy, sc, cw, ch, row, col, px=None, py=None, hard=True):
    sw, sh = max(1, round(im.width * sc)), max(1, round(im.height * sc))
    small = im.resize((sw, sh), Image.LANCZOS)
    if hard: a = np.array(small); a[..., 3] = (a[..., 3] > 110) * 255; small = Image.fromarray(a)
    x, y = round(col * cw + (px if px is not None else cw / 2) - cx * sc), round(row * ch + (py if py is not None else ch / 2) - cy * sc)
    box = Image.new('RGBA', atlas.size); box.alpha_composite(small, (max(0, x), max(0, y)), (max(0, -x), max(0, -y)))
    atlas.alpha_composite(box.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch)), (col * cw, row * ch))

def save(img, path, q=True):
    img.save(path)
    if q: Image.open(path).convert('RGBA').quantize(256, method=Image.FASTOCTREE, dither=Image.NONE).save(path, optimize=True)

# --- tank: whole tank per direction (col 0 hull, col 1 cannon aimed). Side view body ~124px long.
t = cells(green('tank.png'), 8, 2); sc = 124 / t[(2, 0)].width
TW, TH = 180, 150; tank = Image.new('RGBA', (TW * 2, TH * 8))
for (r, c), im in t.items():
    cx, cy = pivot(t[(r, 0)])   # both columns pivot on the hull's body so the tank doesn't jump when the cannon shows
    if c == 1:   # line the hull of col 1 up with col 0 (match the bottom-left of the treads)
        b0 = np.array(t[(r, 0)])[..., 3] > 110; b1 = np.array(im)[..., 3] > 110
        cx, cy = pivot(im, 9)
    put(tank, im, cx, cy, sc, TW, TH, r, c)
save(tank, os.path.join(A, 'sprites', 'zombies', 'dir8', 'sofea-tank.png')); print('tank scale', round(sc, 3))

# --- helicopter: 8 directions x 4 rotor frames, side view ~150px long
h = cells(green('heli.png'), 8, 4); sc = 150 / np.median([h[(2, c)].width for c in range(4)])
HW, HH = 190, 150; heli = Image.new('RGBA', (HW * 4, HH * 8))
for (r, c), im in h.items():
    cx, cy = pivot(h[(r, 0)], 8); put(heli, im, cx + (im.width - h[(r, 0)].width) / 2, cy + (im.height - h[(r, 0)].height) / 2, sc, HW, HH, r, c)
save(heli, os.path.join(A, 'sprites', 'zombies', 'dir8', 'sofea-heli.png')); print('heli scale', round(sc, 3))

# --- effects (128px cells). Projectiles point RIGHT; the client rotates them.
F = 128; dust = Image.open(os.path.join(root, 'dust-row.png')).convert('RGBA')   # 6 dust puffs, 128px each (from her first kit)
fx = Image.new('RGBA', (F * 6, F * 6)); e = cells(magenta_unmix('effects.png'), 5, 6)
for row, size in [(0, 52), (1, 64)]:   # shell / rocket incl. trail, nose at the cell centre + 12px
    s = size / max(e[(row, c)].width for c in range(6))
    for c in range(6): im = e[(row, c)]; put(fx, im, im.width, im.height / 2, s, F, F, row, c, px=F / 2 + size / 2 - 6, hard=False)
s = 104 / max(e[(2, c)].width for c in range(3))   # muzzle: the blast starts at the cell centre (x = barrel tip)
for c in range(6): im = e[(2, c)]; put(fx, im, im.width * .3, im.height / 2, s, F, F, 2, c, hard=False)
s = 124 / max(max(e[(3, c)].width, e[(3, c)].height) for c in range(6))   # explosions: bottom-centre on the ground
for row in (3, 4):
    for c in range(6): im = e[(row, c)]; put(fx, im, im.width / 2, im.height, s, F, F, row, c, py=F - 6, hard=False)
fx.alpha_composite(dust, (0, F * 5))
save(fx, os.path.join(A, 'sprites', 'fx', 'sofea-fx.png'))   # 256 colours keeps the single-file preview under 16 MB

# --- lobby hero (440x660 like the others) + face card (shared backdrop, same as tools/extract-faces.py)
hero = green('hero.png'); al = Image.fromarray(hero[..., 3]).filter(ImageFilter.GaussianBlur(.6)); hero[..., 3] = np.array(al)
Image.fromarray(hero).resize((440, 660), Image.LANCZOS).save(os.path.join(A, 'hero', 'operator.webp'), quality=82, method=6)
import importlib.util
spec = importlib.util.spec_from_file_location('faces_bd', os.path.join(here, 'extract-faces.py'))
src = open(os.path.join(here, 'extract-faces.py')).read(); bd = src[src.index('def backdrop'):src.index('for f in sorted')]
ns = {'np': np, 'ndimage': ndimage}; exec(bd, ns)
fg = hero[..., 3] > 128; top = np.where(fg.any(1))[0][0]; band = fg[top:top + 380]; hx = int(np.where(band)[1].mean())
side = 900; x0 = hx - side // 2 + 30; y0 = max(0, top - int(side * .07))
fig = Image.fromarray(hero); canvas = Image.new('RGBA', (side, side)); canvas.alpha_composite(fig.crop((max(0, x0), y0, min(fig.width, x0 + side), min(fig.height, y0 + side))), (max(0, -x0), 0))
card = Image.fromarray(ns['backdrop'](side)); card.alpha_composite(canvas)
if not os.path.exists(os.path.join(here, 'art', 'faces', 'operator.png')): card.convert('RGB').resize((360, 360), Image.LANCZOS).save(os.path.join(A, 'portraits', 'operator.webp'), quality=86, method=6)

# --- skill cards (octagon cards on black)
for f, name in [('WhatsApp Image 2026-11-03 at 4.49.59 PM.jpeg', 'steelConvoy'), ('WhatsApp Image 2026-11-03 at 4.49.58 PM.jpeg', 'skyReign')]:
    im = Image.open(os.path.join(root, f)).convert('RGB'); a = np.array(im).max(2) > 40; ys, xs = np.where(a)
    im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)).resize((152, 152), Image.LANCZOS).save(os.path.join(A, 'icons', f'card-{name}.png'))
print('sofea v2: tank, heli, fx, hero, face card, cards done')
